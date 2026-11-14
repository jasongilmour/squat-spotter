import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assess, distance, validateSnapshot } from '../src/core/scoring.ts';
import { optimalStringAlignmentDistance } from '../src/core/pkgguard-osa.ts';
import type { Snapshot } from '../src/types.ts';

const fixture = (): Snapshot => JSON.parse(readFileSync(new URL('../fixtures/raect.json', import.meta.url), 'utf8')) as Snapshot;

test('unrestricted distance handles edits and differs from OSA', () => {
  assert.equal(distance('raect', 'react'), 1);
  assert.equal(optimalStringAlignmentDistance('raect', 'react'), 1);
  assert.equal(distance('CA', 'ABC'), 2);
  assert.equal(optimalStringAlignmentDistance('CA', 'ABC'), 3);
  assert.equal(distance('', 'abc'), 3);
  assert.equal(distance('kitten', 'sitting'), 3);
});
test('fixture replays with transposition and stable digest across key and set order', () => {
  const s = fixture(), a = assess(s), reordered = fixture();
  reordered.candidates.reverse(); reordered.corpus.names.reverse();
  const reverseKeys = JSON.parse(JSON.stringify(reordered), (_k, v: unknown) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v) as Snapshot;
  assert.deepEqual(assess(reverseKeys), a);
  assert.equal(a.alternatives[0].name, 'react');
  assert.equal(a.alternatives[0].distance, 1);
  assert.equal(a.alternatives[0].similarity, 0.8);
  assert.equal(a.status, 'partial');
  assert.match(a.evidenceDigest, /^[0-9a-f]{64}$/);
  assert.equal(a.slopsquattingAssessment, 'not_assessed');
});
test('score grows with download gap and target popularity', () => {
  const s = fixture(); s.corpus.names = ['react']; s.candidates = [s.candidates[0]];
  s.subject.downloads = 0; s.candidates[0].downloads = 10;
  const small = assess(s).riskScore!;
  s.candidates[0].downloads = 1_000_000;
  const large = assess(s).riskScore!;
  s.subject.downloads = 10_000;
  const smallerGap = assess(s).riskScore!;
  assert.ok(large > small); assert.ok(large > smallerGap);
});
test('nonexistence, unknown, zero and stale observations are distinct', () => {
  const s = fixture(); s.subject.exists = false; s.subject.downloads = null;
  const nonexistent = assess(s);
  assert.ok(nonexistent.reasonCodes.includes('SUBJECT_CONFIRMED_NONEXISTENT'));
  assert.ok(nonexistent.riskScore! > 0);
  s.subject.exists = true; s.subject.downloads = 0;
  assert.equal(assess(s).riskScore, nonexistent.riskScore);
  assert.ok(!assess(s).reasonCodes.includes('SUBJECT_CONFIRMED_NONEXISTENT'));
  s.subject.exists = null; s.subject.downloads = null;
  assert.equal(assess(s).riskScore, null);
  s.subject.exists = true; s.subject.downloads = 0;
  s.assessmentTime = '2026-11-16T12:00:00.000Z';
  assert.ok(assess(s).reasonCodes.includes('STALE_EVIDENCE'));
});
test('missing candidate count never fabricates a zero score', () => {
  const s = fixture(); s.corpus.names = ['react']; s.candidates[0].downloads = null; s.candidates = [s.candidates[0]];
  assert.equal(assess(s).riskScore, null);
  assert.ok(assess(s).reasonCodes.includes('MISSING_CANDIDATE_DATA'));
});
test('scope is identity bearing and exact input is not exempt', () => {
  const s = fixture(); s.identity.name = '@owner/pkg'; s.subject.name = s.identity.name; s.subject.downloads = 1;
  s.corpus.names = ['@owner/pkg', '@ownef/pkg', 'pkg', '@faraway/pkg'];
  s.candidates = s.corpus.names.map((name, i) => ({ ...s.candidates[0], name, downloads: 1000000 + i }));
  const names = assess(s).alternatives.map(a => a.name);
  assert.deepEqual(names, ['@ownef/pkg']);
});
test('malformed snapshots are rejected', () => {
  const mutations: ((s: Snapshot) => void)[] = [
    s => { s.subject.downloads = -1; }, s => { s.subject.downloads = Infinity; },
    s => { s.window.start = '2026-02-30'; }, s => { s.window.end = '2026-11-14'; },
    s => { s.subject.name = 'other'; }, s => { s.corpus.names.push(s.corpus.names[0]); },
    s => { s.candidates.push(s.candidates[0]); }, s => { s.subject.observedAt = '2026-11-15T00:00:00Z'; },
    s => { s.subject.expiresAt = s.subject.observedAt; }, s => { s.subject.exists = false; },
    s => { s.corpus.names = Array.from({ length: 257 }, (_, i) => `name${i}`); },
    s => { s.identity.name = 'node_modules'; s.subject.name = 'node_modules'; },
  ];
  for (const mutate of mutations) { const s = fixture(); mutate(s); assert.throws(() => validateSnapshot(s), /Invalid snapshot/); }
});
