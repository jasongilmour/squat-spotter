import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Identity, Observation, Snapshot } from '../types.ts';
import { distance, isSimilarName } from '../core/scoring.ts';

const REGISTRY = 'https://registry.npmjs.org' as const;
const SEED = ['react', 'react-dom', 'express', 'lodash', 'typescript', 'axios', 'webpack', 'vite', 'next', 'eslint', 'prettier', 'commander', 'chalk', '@types/node', '@angular/core', '@babel/core'];
const DAY = 86_400_000;
const ERROR_TTL = 60_000;
const LEASE = 180_000;
const MAX_BODY = 2_000_000;

type Window = Snapshot['window'];
type Raw = { state: 'ok' | 'missing' | 'error'; value: unknown; fetchedAt: string; expiresAt: string; error?: string };

/** Validate new npm package names without silently changing their identity. */
export function normalizeIdentity(name: string, registry: string = REGISTRY): Identity {
  if (registry !== REGISTRY && registry !== `${REGISTRY}/` && registry !== 'https://registry.npmjs.org:443' && registry !== 'https://registry.npmjs.org:443/') throw new Error('Unsupported registry');
  // npm new-package names are lowercase, URL-safe, and may not start with a dot or underscore.
  const part = '[a-z0-9~][a-z0-9._~-]*';
  if (typeof name !== 'string' || name === 'node_modules' || name === 'favicon.ico' || name.length > 214 || !new RegExp(`^(?:${part}|@${part}/${part})$`).test(name)) throw new Error('Invalid npm package name');
  return { ecosystem: 'npm', registry: REGISTRY, name };
}

function windowAt(date: Date): Window {
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - DAY;
  return { start: new Date(end - 29 * DAY).toISOString().slice(0, 10), end: new Date(end).toISOString().slice(0, 10) };
}

export function createNpmService(options: { cacheDir?: string; fetch?: typeof globalThis.fetch; now?: () => Date; upstreamBudget?: number } = {}) {
  const dir = options.cacheDir ?? join(process.cwd(), '.cache', 'npm');
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  let remaining = Math.max(0, options.upstreamBudget ?? 100);
  let active = 0;
  const inflight = new Map<string, Promise<unknown>>();
  const pathFor = (key: string) => join(dir, createHash('sha256').update(key).digest('hex') + '.json');
  async function read<T>(path: string): Promise<T | null> {
    try { return JSON.parse(await readFile(path, 'utf8')) as T; }
    catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null; throw err; }
  }
  async function write(path: string, value: unknown) {
    const temp = `${path}.${randomUUID()}.tmp`;
    try { await open(temp, 'wx').then(async f => { try { await f.writeFile(JSON.stringify(value)); } finally { await f.close(); } }); await rename(temp, path); }
    finally { await unlink(temp).catch(() => {}); }
  }
  async function cached<T extends { expiresAt: string }>(key: string, produce: () => Promise<T>): Promise<T> {
    const existing = inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const work = (async () => {
      await mkdir(dir, { recursive: true }); // Fail closed when coordination is unavailable.
      const path = pathFor(key), lock = path + '.lock';
      for (let attempt = 0; attempt < 200; attempt++) {
        const hit = await read<T>(path);
        if (hit && Date.parse(hit.expiresAt) > now().getTime()) return hit;
        const token = randomUUID();
        let handle;
        try { handle = await open(lock, 'wx'); }
        catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
          // Lease expiry uses wall time, independent of injected observation clock.
          const lease = await read<{ token: string; until: number }>(lock).catch(error => { if (error instanceof SyntaxError) return null; throw error; });
          if (!lease) {
            const info = await stat(lock).catch(() => null);
            if (info && info.mtimeMs + LEASE < Date.now()) await unlink(lock).catch(() => {});
          }
          if (lease && lease.until < Date.now()) {
            const check = await read<{ token: string; until: number }>(lock);
            if (check?.token === lease.token && check.until === lease.until) await unlink(lock).catch(() => {});
          }
          await new Promise(resolve => setTimeout(resolve, 25));
          continue;
        }
        try {
          await handle.writeFile(JSON.stringify({ token, until: Date.now() + LEASE }));
          await handle.close();
          const recheck = await read<T>(path);
          if (recheck && Date.parse(recheck.expiresAt) > now().getTime()) return recheck;
          const value = await produce();
          await write(path, value);
          return value;
        } finally {
          await handle.close().catch(() => {});
          const lease = await read<{ token: string }>(lock).catch(() => null);
          if (lease?.token === token) await unlink(lock).catch(() => {});
        }
      }
      throw new Error('Cache lease unavailable');
    })();
    inflight.set(key, work);
    try { return await work; } finally { inflight.delete(key); }
  }
  async function request(url: string): Promise<{ status: number; data?: unknown; error?: string; retryAfter?: number }> {
    if (remaining <= 0 || active >= 4) return { status: 0, error: 'upstream budget or concurrency exhausted' };
    remaining--; active++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetcher(url, { redirect: 'manual', signal: controller.signal, headers: { accept: url.startsWith(REGISTRY) ? 'application/vnd.npm.install-v1+json' : 'application/json' } });
      if (response.status === 404) { await response.body?.cancel(); return { status: 404 }; }
      if (!response.ok) {
        const header = response.headers.get('retry-after');
        await response.body?.cancel();
        const seconds = header && /^\d+$/.test(header) ? Number(header) : header ? (Date.parse(header) - now().getTime()) / 1000 : 0;
        return { status: response.status, error: `upstream HTTP ${response.status}`, retryAfter: Number.isFinite(seconds) ? Math.max(0, Math.min(seconds * 1000, DAY)) : 0 };
      }
      const length = Number(response.headers.get('content-length'));
      if (length > MAX_BODY || !response.body) throw new Error('upstream response too large or empty');
      const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
      while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > MAX_BODY) { await reader.cancel(); throw new Error('upstream response too large'); } chunks.push(item.value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return { status: response.status, data: JSON.parse(new TextDecoder().decode(bytes)) };
    } catch (error) { return { status: 0, error: error instanceof SyntaxError ? 'invalid upstream JSON' : error instanceof Error && error.message.startsWith('upstream response') ? error.message : controller.signal.aborted ? 'upstream timeout' : 'upstream request failed' }; }
    finally { clearTimeout(timer); active--; }
  }
  async function raw(name: string, kind: 'metadata' | 'downloads', window: Window): Promise<Raw> {
    const key = `${REGISTRY}|${name}|${kind}|${kind === 'downloads' ? `${window.start}:${window.end}` : ''}`;
    return cached(key, async () => {
      const encoded = encodeURIComponent(name);
      const url = kind === 'metadata' ? `${REGISTRY}/${encoded}/latest` : `https://api.npmjs.org/downloads/point/${window.start}:${window.end}/${encoded}`;
      let result = await request(url);
      // A missing latest tag does not mean the package identity is absent.
      if (kind === 'metadata' && result.status === 404) result = await request(`${REGISTRY}/${encoded}`);
      const timestamp = now();
      let state: Raw['state'] = result.status === 404 && kind === 'metadata' ? 'missing' : result.status === 200 ? 'ok' : 'error';
      const data = result.data as Record<string, unknown> | undefined;
      if (state === 'ok' && (kind === 'metadata' ? !data || typeof data !== 'object' || data.name !== name : !data || !Number.isSafeInteger(data.downloads) || (data.downloads as number) < 0 || data.start !== window.start || data.end !== window.end || data.package !== name)) state = 'error';
      return { state, value: state === 'ok' ? (kind === 'downloads' ? data!.downloads : true) : null, fetchedAt: timestamp.toISOString(), expiresAt: new Date(timestamp.getTime() + (state === 'error' ? Math.max(ERROR_TTL, result.retryAfter ?? 0) : DAY)).toISOString(), ...(state === 'error' ? { error: result.error ?? 'invalid upstream response' } : {}) };
    });
  }
  async function observation(name: string, window: Window): Promise<Observation> {
    const metadata = await raw(name, 'metadata', window);
    const downloads = metadata.state === 'ok' ? await raw(name, 'downloads', window) : null;
    const errors = [metadata.error, downloads?.error].filter(Boolean).join('; ');
    return { name, exists: metadata.state === 'ok' ? true : metadata.state === 'missing' ? false : null, downloads: metadata.state === 'missing' ? null : downloads?.state === 'ok' ? downloads.value as number : null, observedAt: downloads && downloads.fetchedAt < metadata.fetchedAt ? downloads.fetchedAt : metadata.fetchedAt, expiresAt: downloads && downloads.expiresAt < metadata.expiresAt ? downloads.expiresAt : metadata.expiresAt, ...(errors ? { error: errors } : {}) };
  }
  async function snapshot(name: string, registry?: string): Promise<Snapshot> {
    const identity = normalizeIdentity(name, registry);
    const result = await cached(`snapshot|1|seed-1|${identity.name}`, async () => {
      const timestamp = now(), window = windowAt(timestamp);
      const names = SEED.filter(candidate => candidate !== name).map(candidate => ({ candidate, d: distance(name, candidate) })).filter(item => isSimilarName(name, item.candidate)).sort((a, b) => a.d - b.d || a.candidate.localeCompare(b.candidate)).slice(0, 5).map(item => item.candidate);
      const subject = await observation(name, window);
      // Sequential enrichment keeps one assessment within the concurrency ceiling.
      const candidates: Observation[] = []; for (const candidate of names) candidates.push(await observation(candidate, window));
      const snapshot: Snapshot = { schemaVersion: '1', identity, assessmentTime: now().toISOString(), window, corpus: { version: 'seed-1', names: [...SEED], coverage: 'seed', description: 'Small original development seed; not representative of npm and not exhaustive.' }, subject, candidates };
      const expiresAt = [subject, ...candidates].reduce((earliest, item) => item.expiresAt < earliest ? item.expiresAt : earliest, new Date(timestamp.getTime() + DAY).toISOString());
      return { snapshot, expiresAt };
    });
    return result.snapshot;
  }
  return { snapshot };
}
