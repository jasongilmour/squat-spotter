# Prototype scoring model 0.1.0

This is an uncalibrated heuristic, not a probability or an enforcement verdict. Similarity and popularity can occur between legitimate projects; a low score is not a safety guarantee. The checked-in fixture is synthetic, including its counts and existence states, and is not an allegation about real packages. The seed corpus is incomplete; every computable result is `partial`. No hallucination corpus, publication age or release history is evaluated: slopsquatting is `not_assessed`.

## Candidate and pair calculation

Names are canonical lowercase npm identities. Scoped and unscoped names are not compared; scoped names compare scope and basename separately, preserving both parts. Each component must be within its length-based unrestricted Damerau–Levenshtein threshold: max component length up to 4 permits one edit, 5–10 permits two, and longer permits three. These provisional thresholds have not been fitted to a benchmark. The full name determines the reported distance and similarity. An exact input identity is excluded from comparisons, but its presence in the corpus never exempts it from other comparisons. Only confirmed existing candidates with more downloads than the subject are scored.

For each such pair, with counts from the same stated inclusive window:

- `similarity = 1 - distance / max(full-name lengths)`.
- `ratio = (candidate downloads + 1) / (subject downloads + 1)`.
- `downloadGap = min(1, log10(ratio) / 6)`.
- `targetPopularity = min(1, log10(candidate downloads + 1) / 6)`.
- Pair risk = `similarity × downloadGap × targetPopularity`. The result is the highest pair risk; ties are sorted by name. With complete candidate observations and no higher-download match, it is zero within this seed corpus.

The computation uses unrounded features; displayed similarity, ratio, contributions and score are rounded to six decimal places using `Math.round((value + Number.EPSILON) * 1e6) / 1e6`. The returned score is the maximum rounded pair score. These constants are design choices, not empirically calibrated. A confirmed nonexistent subject uses zero only for the comparison; its distinct existence state and reason code remain visible. Unknown subject downloads or existence produce null. If relevant candidate observations are missing, a score from available comparisons is partial; if no positive comparison can be computed, the result is null. Missing unrelated corpus entries do not affect this assessment. Expired evidence is explicitly marked stale at `assessmentTime`, including for historical replay.

## Reproducibility and validation

The engine performs no I/O except local SHA-256 calculation and reads no clock. Assessment time and all observations are supplied by the caller. Validation rejects invalid timestamps and dates, future observations, expiry at or before observation, incomplete-day windows, duplicate or inconsistent identities, more than 256 corpus names or candidate observations, invalid counts and candidates absent from the corpus. Errors remain unknown, never confirmed missing. The evidence digest is lowercase SHA-256 of UTF-8 JSON generated from the validated snapshot: object keys sorted lexicographically recursively, arrays retaining order except corpus names and candidates, which are sorted by name because they are sets. JSON primitive serialization follows JavaScript `JSON.stringify`. Persist the snapshot, not only its digest, for replay. Schema and model versions are explicit.

## Provenance

The production scorer and unrestricted distance implementation are original work implementing a standard algorithm; no pkgguard production scorer is copied. The algorithm follows the unrestricted distance formulation described by [Lowrance and Wagner](https://doi.org/10.1145/321879.321880). The separate `pkgguard-osa.ts` is a TypeScript port of the optimal string alignment helper in [pkgguard scoring.py at commit 53dadd7](https://github.com/rxslice/pkgguard-API/blob/53dadd7ad16dcc99e5e19e135447f2ffb02e1df3/pkgguard/scoring.py), built by Blvkware and licensed Apache-2.0; see third-party notices. It is used as a reference baseline, not in scoring. OSA gives 3 for `CA` → `ABC`, whereas unrestricted distance gives 2; the distinction matters for metric indexes.
