/** Shared prototype contract. Dates are UTC ISO strings; downloads use inclusive days. */
export interface Identity { ecosystem: 'npm'; registry: 'https://registry.npmjs.org'; name: string }
export interface Observation {
  name: string;
  exists: boolean | null;
  downloads: number | null;
  observedAt: string;
  expiresAt: string;
  error?: string;
}
export interface Snapshot {
  schemaVersion: '1';
  identity: Identity;
  assessmentTime: string;
  window: { start: string; end: string };
  corpus: { version: string; names: string[]; coverage: 'seed'; description: string };
  subject: Observation;
  candidates: Observation[];
}
export interface Alternative {
  name: string; downloads: number; distance: number; similarity: number;
  downloadRatio: number; riskScore: number;
  contributions: { similarity: number; downloadGap: number; targetPopularity: number };
}
export interface Assessment {
  schemaVersion: '1'; modelVersion: string; evidenceDigest: string;
  identity: Identity; assessmentTime: string;
  riskScore: number | null;
  status: 'assessed' | 'partial' | 'insufficient_data';
  exists: boolean | null;
  window: Snapshot['window']; corpus: Snapshot['corpus'];
  subject: Observation; alternatives: Alternative[];
  reasonCodes: string[];
  slopsquattingAssessment: 'not_assessed';
}
