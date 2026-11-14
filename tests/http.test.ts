import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHandler } from '../src/http/handler.ts';
import { MODEL_VERSION } from '../src/core/scoring.ts';
import type { Snapshot } from '../src/types.ts';

const fixture = JSON.parse(await readFile(new URL('../fixtures/raect.json', import.meta.url), 'utf8')) as Snapshot;
function setup(options: { rateLimit?: number; fail?: boolean; unavailable?: boolean } = {}) {
  return createHandler({ rateLimit: options.rateLimit, service: { async snapshot() {
    if (options.fail) throw new Error('network or cache failure');
    if (options.unavailable) return { ...fixture, subject: { ...fixture.subject, exists: null, downloads: null } };
    return fixture;
  } } });
}
async function request(handler: ReturnType<typeof setup>, url: string, options: { method?: string; body?: string; contentType?: string } = {}) {
  const req = Readable.from(options.body === undefined ? [] : [options.body]) as IncomingMessage;
  Object.assign(req, { method: options.method ?? 'GET', url, headers: { ...(options.contentType ? { 'content-type': options.contentType } : {}), ...(options.body ? { 'content-length': String(Buffer.byteLength(options.body)) } : {}) }, socket: { remoteAddress: '127.0.0.1' } });
  let status = 0; let headers: Record<string, string> = {}; let body = '';
  const res = { headersSent: false, destroyed: false, writeHead(code: number, h: Record<string, string>) { status = code; headers = h; }, end(data: string | Buffer) { body = data?.toString() ?? ''; } } as unknown as ServerResponse;
  await handler(req, res);
  return { status, headers, body, json: () => JSON.parse(body) };
}
test('live check, validation, static page, and deterministic replay', async () => {
  const handler = setup();
  assert.equal((await request(handler, '/health')).status, 200);
  assert.match((await request(handler, '/')).body, /Squat Spotter/);
  const live = await request(handler, '/v1/check?name=raect'); assert.equal(live.status, 200);
  assert.equal(live.json().corpus.coverage, 'seed'); assert.equal(live.json().modelVersion, MODEL_VERSION);
  const replay = await request(handler, '/v1/assess?modelVersion=' + encodeURIComponent(MODEL_VERSION), { method: 'POST', contentType: 'application/json', body: JSON.stringify(fixture) });
  assert.equal(replay.status, 200); assert.deepEqual(replay.json(), live.json());
  for (const path of ['/v1/check', '/v1/check?name=bad%20name', '/v1/check?name=raect&registry=https://example.com', '/v1/check?name=raect&modelVersion=unknown', '/v1/check?name=raect&name=react']) assert.equal((await request(handler, path)).status, 400, path);
  assert.equal((await request(handler, '/v1/assess?modelVersion=unknown', { method: 'POST', contentType: 'application/json', body: JSON.stringify(fixture) })).status, 400);
  assert.equal((await request(handler, '/v1/assess?other=1', { method: 'POST', contentType: 'application/json', body: JSON.stringify(fixture) })).status, 400);
  assert.equal((await request(handler, '/v1/assess', { method: 'POST', body: '{}' })).status, 400);
  assert.equal((await request(handler, '/v1/assess', { method: 'POST', contentType: 'application/json', body: '{' })).status, 400);
  assert.equal((await request(handler, '/v1/assess', { method: 'POST', contentType: 'application/json', body: ' '.repeat(65537) })).status, 413);
  assert.equal((await request(handler, '/missing')).status, 404);
});
test('reports rate limiting and upstream unavailability separately', async () => {
  const limited = setup({ rateLimit: 1 }); assert.equal((await request(limited, '/health')).status, 200); const r = await request(limited, '/health'); assert.equal(r.status, 429); assert.ok(r.headers['retry-after']);
  const failed = await request(setup({ fail: true }), '/v1/check?name=raect'); assert.equal(failed.status, 503); assert.equal(failed.json().error.code, 'unavailable');
  const insufficient = await request(setup({ unavailable: true }), '/v1/check?name=raect'); assert.equal(insufficient.status, 503); assert.equal(insufficient.json().error.code, 'insufficient_data');
});
