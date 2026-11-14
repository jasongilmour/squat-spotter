import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { assess, MODEL_VERSION, validateSnapshot } from '../core/scoring.ts';
import type { Snapshot } from '../types.ts';
import { normalizeIdentity } from '../npm/service.ts';

export interface SnapshotService { snapshot(name: string, registry?: string): Promise<Snapshot> }
export interface HandlerOptions { service: SnapshotService; rateLimit?: number; maxConcurrent?: number; now?: () => number }

/** A bounded, process-local prototype limiter; it is not a distributed public-hosting control. */
export function createHandler({ service, rateLimit = 60, maxConcurrent = 16, now = Date.now }: HandlerOptions) {
  const clients = new Map<string, { count: number; until: number }>();
  let active = 0;
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const json = (status: number, value: unknown, headers: Record<string, string> = {}) => {
      if (res.headersSent || res.destroyed) return;
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
      res.end(JSON.stringify(value));
    };
    const fail = (status: number, code: string, message: string, headers?: Record<string, string>) => json(status, { error: { code, message } }, headers);
    const current = now();
    for (const [key, entry] of clients) if (entry.until <= current) clients.delete(key);
    const ip = req.socket.remoteAddress ?? 'unknown';
    let client = clients.get(ip);
    if (!client && clients.size >= 4096) { fail(429, 'rate_limited', 'Service rate limit reached.', { 'retry-after': '60' }); return; }
    if (!client) { client = { count: 0, until: current + 60_000 }; clients.set(ip, client); }
    if (++client.count > rateLimit) { fail(429, 'rate_limited', 'Too many requests.', { 'retry-after': String(Math.max(1, Math.ceil((client.until - current) / 1000))) }); return; }
    if (active >= maxConcurrent) { fail(503, 'busy', 'Service is busy; retry later.', { 'retry-after': '1' }); return; }
    active++;
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') { json(200, { status: 'ok', modelVersion: MODEL_VERSION }); return; }
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/app.js' || url.pathname === '/style.css')) {
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const data = await readFile(new URL(`../../public/${file}`, import.meta.url));
        res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8', 'x-content-type-options': 'nosniff' }); res.end(data); return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/check') {
        const allowed = new Set(['name', 'ecosystem', 'registry', 'modelVersion']);
        if ([...url.searchParams.keys()].some(k => !allowed.has(k) || url.searchParams.getAll(k).length !== 1)) { fail(400, 'invalid_request', 'Unknown or duplicate query parameter.'); return; }
        const name = url.searchParams.get('name');
        if (!name || (url.searchParams.get('ecosystem') ?? 'npm') !== 'npm') { fail(400, 'invalid_request', 'A name and the npm ecosystem are required.'); return; }
        const version = url.searchParams.get('modelVersion');
        if (version !== null && version !== MODEL_VERSION) { fail(400, 'unsupported_model', 'Unsupported model version.'); return; }
        try { normalizeIdentity(name, url.searchParams.get('registry') ?? undefined); }
        catch { fail(400, 'invalid_request', 'Invalid npm package name or unsupported registry.'); return; }
        const snapshot = await service.snapshot(name, url.searchParams.get('registry') ?? undefined);
        const result = assess(snapshot);
        if (result.status === 'insufficient_data') { json(503, { error: { code: 'insufficient_data', message: 'Insufficient usable evidence for a score.' }, assessment: result }, { 'retry-after': '60' }); return; }
        json(200, result); return;
      }
      if (req.method === 'POST' && url.pathname === '/v1/assess') {
        if ([...url.searchParams.keys()].some(k => k !== 'modelVersion' || url.searchParams.getAll(k).length !== 1)) { fail(400, 'invalid_request', 'Unknown or duplicate query parameter.'); req.resume(); return; }
        const version = url.searchParams.get('modelVersion');
        if (version !== null && version !== MODEL_VERSION) { fail(400, 'unsupported_model', 'Unsupported model version.'); req.resume(); return; }
        if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] ?? '')) { fail(400, 'invalid_content_type', 'Content-Type must be application/json.'); req.resume(); return; }
        const length = Number(req.headers['content-length'] ?? 0);
        if (length > 65536) { fail(413, 'body_too_large', 'Request body exceeds 64 KiB.'); req.resume(); return; }
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > 65536) { fail(413, 'body_too_large', 'Request body exceeds 64 KiB.'); req.resume(); return; } chunks.push(buffer); }
        let snapshot: Snapshot;
        try { snapshot = validateSnapshot(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { fail(400, 'invalid_snapshot', 'Invalid JSON or snapshot.'); return; }
        json(200, assess(snapshot)); return;
      }
      fail(404, 'not_found', 'Route not found.');
    } catch (error) {
      const e = error as { status?: number; statusCode?: number; code?: string; message?: string };
      const status = e.status ?? e.statusCode;
      if (status === 400 || e instanceof TypeError || e.code === 'INVALID_INPUT') fail(400, 'invalid_request', e.message ?? 'Invalid request.');
      else if (status === 429 || e.code === 'RATE_LIMITED') fail(429, 'rate_limited', 'Request budget exhausted.', { 'retry-after': '60' });
      else fail(503, 'unavailable', 'Evidence is temporarily unavailable.', { 'retry-after': '60' });
    } finally { active--; }
  };
}
