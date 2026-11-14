import { readFile, writeFile } from 'node:fs/promises';
import { assess, validateSnapshot } from './core/scoring.ts';
import { createNpmService } from './npm/service.ts';

async function main(args: string[]) {
  let name: string | undefined; let fixture: string | undefined; let registry: string | undefined; let output: string | undefined; let json = false;
  if (args[0] === 'check') args.shift();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') json = true;
    else if (arg === '--fixture' || arg === '--registry' || arg === '--write-snapshot' || arg === '--ecosystem') {
      const value = args[++i]; if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      if (arg === '--fixture') fixture = value; else if (arg === '--registry') registry = value; else if (arg === '--write-snapshot') output = value; else if (value !== 'npm') throw new Error('Only npm is supported');
    } else if (arg.startsWith('-') || name) throw new Error(`Unexpected argument: ${arg}`);
    else name = arg;
  }
  if ((!name && !fixture) || (name && fixture)) throw new Error('Supply a package name or --fixture PATH');
  const snapshot = fixture ? validateSnapshot(JSON.parse(await readFile(fixture, 'utf8'))) : await createNpmService({}).snapshot(name!, registry);
  if (output) await writeFile(output, JSON.stringify(snapshot, null, 2) + '\n');
  const result = assess(snapshot);
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${result.identity.name}: ${result.riskScore === null ? 'score unavailable' : `heuristic risk ${result.riskScore}`} (${result.status})`);
    console.log(`Corpus: ${result.corpus.version} — seed coverage; ${result.corpus.description}`);
    console.log(`Downloads: ${result.subject.downloads ?? 'unknown'} (${result.window.start} to ${result.window.end})`);
    for (const alt of result.alternatives) console.log(`  ${alt.name}: ${alt.downloads} downloads, similarity ${alt.similarity}, risk ${alt.riskScore}`);
    console.log(`Reasons: ${result.reasonCodes.join(', ') || 'none'}. Slopsquatting: ${result.slopsquattingAssessment}.`);
    console.log('This heuristic is not a probability or a safety verdict.');
  }
  if (result.status === 'insufficient_data') process.exitCode = 2;
}
main(process.argv.slice(2)).catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Assessment failed'); process.exitCode = 1; });
