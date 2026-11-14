import { createHash } from 'node:crypto';
import type { Alternative, Assessment, Observation, Snapshot } from '../types.ts';

export const MODEL_VERSION = '0.1.0';

/** Unrestricted Damerau–Levenshtein distance, operating on Unicode code points. */
export function distance(a: string, b: string): number {
  const x = Array.from(a), y = Array.from(b);
  const max = x.length + y.length;
  const d = Array.from({ length: x.length + 2 }, () => Array<number>(y.length + 2).fill(0));
  d[0][0] = max;
  for (let i = 0; i <= x.length; i++) { d[i + 1][0] = max; d[i + 1][1] = i; }
  for (let j = 0; j <= y.length; j++) { d[0][j + 1] = max; d[1][j + 1] = j; }
  const last = new Map<string, number>();
  for (let i = 1; i <= x.length; i++) {
    let match = 0;
    for (let j = 1; j <= y.length; j++) {
      const i1 = last.get(y[j - 1]) ?? 0, j1 = match;
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      if (cost === 0) match = j;
      d[i + 1][j + 1] = Math.min(d[i][j] + cost, d[i + 1][j] + 1, d[i][j + 1] + 1,
        d[i1][j1] + (i - i1 - 1) + 1 + (j - j1 - 1));
    }
    last.set(x[i - 1], i);
  }
  return d[x.length + 1][y.length + 1];
}

function fail(message: string): never { throw new Error(`Invalid snapshot: ${message}`); }
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a nonempty string`);
  return value;
}
function name(value: unknown, label: string): string {
  const s = text(value, label);
  if (s.length > 214 || s === 'node_modules' || s === 'favicon.ico' || !/^(?:@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*$/.test(s)) fail(`${label} must be a canonical npm package name`);
  return s;
}
function date(value: unknown, label: string): string {
  const s = text(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00.000Z`)) || new Date(`${s}T00:00:00.000Z`).toISOString().slice(0, 10) !== s) fail(`${label} must be a valid UTC date`);
  return s;
}
function timestamp(value: unknown, label: string): string {
  const s = text(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s) || Number.isNaN(Date.parse(s)) || new Date(s).toISOString() !== s.replace(/Z$/, s.includes('.') ? 'Z' : '.000Z')) fail(`${label} must be a valid UTC timestamp`);
  return s;
}
function observation(value: unknown, label: string, assessment: string): Observation {
  const o = object(value, label);
  const n = name(o.name, `${label}.name`);
  if (o.exists !== true && o.exists !== false && o.exists !== null) fail(`${label}.exists must be boolean or null`);
  if (o.downloads !== null && (typeof o.downloads !== 'number' || !Number.isSafeInteger(o.downloads) || o.downloads < 0)) fail(`${label}.downloads must be a nonnegative safe integer or null`);
  if (o.exists !== true && o.downloads !== null) fail(`${label}.downloads requires confirmed existence`);
  const observedAt = timestamp(o.observedAt, `${label}.observedAt`), expiresAt = timestamp(o.expiresAt, `${label}.expiresAt`);
  if (Date.parse(observedAt) > Date.parse(assessment)) fail(`${label} observed after assessment`);
  if (Date.parse(expiresAt) <= Date.parse(observedAt)) fail(`${label} expiry must follow observation`);
  if (o.error !== undefined && (typeof o.error !== 'string' || !o.error)) fail(`${label}.error must be a nonempty string`);
  if (o.error !== undefined && (o.exists === false || o.downloads !== null)) fail(`${label}.error requires unknown downloads and no confirmed nonexistence`);
  return { name: n, exists: o.exists as boolean | null, downloads: o.downloads as number | null, observedAt, expiresAt, ...(o.error === undefined ? {} : { error: o.error as string }) };
}

/** Validate and normalize a complete, replayable snapshot. Throws for invalid input. */
export function validateSnapshot(input: unknown): Snapshot {
  const s = object(input, 'snapshot');
  if (s.schemaVersion !== '1') fail('unsupported schemaVersion');
  const id = object(s.identity, 'identity');
  if (id.ecosystem !== 'npm' || id.registry !== 'https://registry.npmjs.org') fail('unsupported ecosystem or registry');
  const identity = { ecosystem: 'npm' as const, registry: 'https://registry.npmjs.org' as const, name: name(id.name, 'identity.name') };
  const assessmentTime = timestamp(s.assessmentTime, 'assessmentTime');
  const w = object(s.window, 'window'), start = date(w.start, 'window.start'), end = date(w.end, 'window.end');
  if (start > end || end >= assessmentTime.slice(0, 10)) fail('window must contain complete UTC days before assessment');
  const c = object(s.corpus, 'corpus');
  if (c.coverage !== 'seed') fail('unsupported corpus coverage');
  if (!Array.isArray(c.names) || c.names.length > 256) fail('corpus.names must be an array of at most 256 names');
  const names = c.names.map((n, i) => name(n, `corpus.names[${i}]`));
  if (new Set(names).size !== names.length) fail('duplicate corpus name');
  const corpus = { version: text(c.version, 'corpus.version'), names, coverage: 'seed' as const, description: text(c.description, 'corpus.description') };
  const subject = observation(s.subject, 'subject', assessmentTime);
  if (subject.name !== identity.name) fail('subject identity mismatch');
  if (!Array.isArray(s.candidates) || s.candidates.length > 256) fail('candidates must be an array of at most 256 observations');
  const candidates = s.candidates.map((v, i) => observation(v, `candidates[${i}]`, assessmentTime));
  if (new Set(candidates.map(v => v.name)).size !== candidates.length) fail('duplicate candidate');
  if (candidates.some(v => !names.includes(v.name))) fail('candidate is absent from corpus');
  return { schemaVersion: '1', identity, assessmentTime, window: { start, end }, corpus, subject, candidates };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function parts(n: string): [string | null, string] {
  if (!n.startsWith('@')) return [null, n];
  const [scope, base] = n.slice(1).split('/');
  return [scope, base];
}
function threshold(n: number): number { return n <= 4 ? 1 : n <= 10 ? 2 : 3; }
export function isSimilarName(a: string, b: string): boolean {
  const [as, ab] = parts(a), [bs, bb] = parts(b);
  if ((as === null) !== (bs === null)) return false;
  if (as !== null && bs !== null && distance(as, bs) > threshold(Math.max(as.length, bs.length))) return false;
  return distance(ab, bb) <= threshold(Math.max(ab.length, bb.length));
}

/** Assess only the supplied observations. No network, clock, or policy decisions. */
export function assess(input: Snapshot): Assessment {
  const s = validateSnapshot(input);
  // Sets have no intrinsic order; canonicalize them before hashing and returning.
  s.corpus.names.sort();
  s.candidates.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const evidenceDigest = createHash('sha256').update(canonical(s)).digest('hex');
  const reasons = new Set<string>(['LIMITED_CORPUS_COVERAGE', 'SLOPSQUATTING_NOT_ASSESSED']);
  const observations = new Map(s.candidates.map(c => [c.name, c]));
  const relevant = s.corpus.names.filter(n => n !== s.identity.name && isSimilarName(s.identity.name, n));
  const missing = relevant.some(n => { const c = observations.get(n); return !c || c.exists === null || (c.exists && c.downloads === null); });
  if (missing) reasons.add('MISSING_CANDIDATE_DATA');
  if (Date.parse(s.subject.expiresAt) <= Date.parse(s.assessmentTime) || relevant.some(n => { const c = observations.get(n); return c && Date.parse(c.expiresAt) <= Date.parse(s.assessmentTime); })) reasons.add('STALE_EVIDENCE');
  const inputDownloads = s.subject.exists === false ? 0 : s.subject.downloads;
  if (s.subject.exists === false) reasons.add('SUBJECT_CONFIRMED_NONEXISTENT');
  if (s.subject.exists === null || (s.subject.exists && inputDownloads === null)) reasons.add('MISSING_SUBJECT_DATA');
  const alternatives: Alternative[] = [];
  if (inputDownloads !== null && s.subject.exists !== null) {
    for (const n of relevant) {
      const c = observations.get(n);
      if (!c || c.exists !== true || c.downloads === null || c.downloads <= inputDownloads) continue;
      const d = distance(s.identity.name, n);
      const similarity = 1 - d / Math.max(Array.from(s.identity.name).length, Array.from(n).length);
      const ratio = (c.downloads + 1) / (inputDownloads + 1);
      const gap = Math.min(1, Math.log10(ratio) / 6);
      const popularity = Math.min(1, Math.log10(c.downloads + 1) / 6);
      alternatives.push({ name: n, downloads: c.downloads, distance: d, similarity: round(similarity), downloadRatio: round(ratio), riskScore: round(similarity * gap * popularity), contributions: { similarity: round(similarity), downloadGap: round(gap), targetPopularity: round(popularity) } });
    }
  }
  alternatives.sort((a, b) => b.riskScore - a.riskScore || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const unavailable = s.subject.exists === null || inputDownloads === null || (missing && alternatives.length === 0);
  return { schemaVersion: '1', modelVersion: MODEL_VERSION, evidenceDigest, identity: s.identity, assessmentTime: s.assessmentTime, riskScore: unavailable ? null : (alternatives[0]?.riskScore ?? 0), status: unavailable ? 'insufficient_data' : 'partial', exists: s.subject.exists, window: s.window, corpus: s.corpus, subject: s.subject, alternatives, reasonCodes: [...reasons].sort(), slopsquattingAssessment: 'not_assessed' };
}
