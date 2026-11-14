import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createNpmService, normalizeIdentity } from '../src/npm/service.ts';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'squat-npm-test-'));
  let time = new Date('2026-11-14T23:59:00Z');
  const calls: string[] = [];
  let status = 200;
  const fetcher: typeof fetch = async input => {
    const url = String(input); calls.push(url);
    if (status !== 200) return new Response('', { status });
    const parsed = new URL(url);
    if (parsed.hostname === 'registry.npmjs.org') return Response.json({ name: decodeURIComponent(parsed.pathname.slice(1).replace(/\/latest$/, '')) });
    const parts = parsed.pathname.split('/'); const [start, end] = parts[3].split(':');
    return Response.json({ package: decodeURIComponent(parts[4]), start, end, downloads: 42 });
  };
  return { dir, calls, fetcher, now: () => time, setTime: (value: string) => { time = new Date(value); }, setStatus: (value: number) => { status = value; }, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('warm and concurrent snapshots share raw requests and preserve the window at midnight', async () => {
  const s = await setup(); try {
    const service = createNpmService({ cacheDir: s.dir, fetch: s.fetcher, now: s.now });
    const [a, b] = await Promise.all([service.snapshot('unique-test-name'), service.snapshot('unique-test-name')]);
    assert.deepEqual(a, b); assert.equal(s.calls.length, 2);
    assert.deepEqual(a.window, { start: '2026-10-15', end: '2026-11-13' });
    s.setTime('2026-11-15T00:01:00Z');
    assert.deepEqual((await createNpmService({ cacheDir: s.dir, fetch: s.fetcher, now: s.now }).snapshot('unique-test-name')).window, a.window);
    assert.equal(s.calls.length, 2);
    s.setTime('2026-11-16T00:01:00Z');
    assert.deepEqual((await service.snapshot('unique-test-name')).window, { start: '2026-10-17', end: '2026-11-15' });
    assert.equal(s.calls.length, 4);
  } finally { await s.cleanup(); }
});

test('confirmed missing and upstream error remain distinct and cached', async () => {
  const s = await setup(); try {
    const service = createNpmService({ cacheDir: s.dir, fetch: s.fetcher, now: s.now });
    s.setStatus(404); const missing = await service.snapshot('unique-missing-name');
    assert.equal(missing.subject.exists, false); assert.equal(missing.subject.downloads, null);
    assert.equal(s.calls.length, 2); await service.snapshot('unique-missing-name'); assert.equal(s.calls.length, 2);
    s.setStatus(503); const failed = await service.snapshot('unique-error-name');
    assert.equal(failed.subject.exists, null); assert.equal(failed.subject.downloads, null);
  } finally { await s.cleanup(); }
});

test('scope encoding, registry allowlist, budget and cache failure', async () => {
  const s = await setup(); try {
    const service = createNpmService({ cacheDir: s.dir, fetch: s.fetcher, now: s.now, upstreamBudget: 2 });
    await service.snapshot('@sample/example');
    assert.match(s.calls[0], /%40sample%2Fexample/i); assert.match(s.calls[1], /%40sample%2Fexample/i);
    assert.equal((await service.snapshot('unique-other-name')).subject.exists, null);
    assert.throws(() => normalizeIdentity('foo', 'https://registry.npmjs.org.evil.com'));
    for (const name of ['React', 'foo/bar', '@foo/', '.bad', 'a'.repeat(215), 'bad%2fname']) assert.throws(() => normalizeIdentity(name));
    const blocked = join(s.dir, 'file'); await writeFile(blocked, 'x');
    await assert.rejects(createNpmService({ cacheDir: blocked, fetch: s.fetcher }).snapshot('something'));
    assert.equal(s.calls.length, 2);
  } finally { await s.cleanup(); }
});

test('separate instances coalesce cold misses through the lease', async () => {
  const s = await setup(); try {
    const one = createNpmService({ cacheDir: s.dir, fetch: s.fetcher, now: s.now });
    const two = createNpmService({ cacheDir: s.dir, fetch: s.fetcher, now: s.now });
    await Promise.all([one.snapshot('unique-race-name'), two.snapshot('unique-race-name')]);
    assert.equal(s.calls.length, 2);
  } finally { await s.cleanup(); }
});

test('slow concurrent services coalesce and reuse a popular target across checks', async () => {
  const s = await setup(); try {
    const slowFetch: typeof fetch = async (...args) => { await new Promise(resolve => setTimeout(resolve, 60)); return s.fetcher(...args); };
    const one = createNpmService({ cacheDir: s.dir, fetch: slowFetch, now: s.now });
    const two = createNpmService({ cacheDir: s.dir, fetch: slowFetch, now: s.now });
    await Promise.all([one.snapshot('raect'), two.snapshot('raect')]);
    assert.equal(s.calls.filter(url => url.includes('/react')).length, 2);
    await two.snapshot('reaact');
    assert.equal(s.calls.filter(url => url.includes('/react')).length, 2);
  } finally { await s.cleanup(); }
});


test('missing latest tag falls back to package identity without declaring absence', async () => {
  const s = await setup(); try {
    const fetcher: typeof fetch = async (input, init) => String(input).endsWith('/latest') ? new Response('', { status: 404 }) : s.fetcher(input, init);
    const result = await createNpmService({ cacheDir: s.dir, fetch: fetcher, now: s.now }).snapshot('unique-no-latest');
    assert.equal(result.subject.exists, true);
    assert.equal(result.subject.downloads, 42);
  } finally { await s.cleanup(); }
});
