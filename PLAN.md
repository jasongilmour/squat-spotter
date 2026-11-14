# Squat Spotter product plan

Plan updated 14 November 2026. A local npm prototype is now implemented; see README.md and docs/TASKS.md for delivered scope. No hosting deployment yet.

## Product and scope

An open-source deterministic package-risk assessment service intended primarily for centralised policy enforcement (for example, Cloudsmith). The service measures risk; the consuming organisation owns thresholds, exceptions and enforcement. Three interfaces share the same scoring engine:

- A JSON HTTP API for integrations and curl.
- A standalone CLI that can query registries directly, with its own persistent cache.
- A minimally styled page explaining the concept and checking one name. Prefer browser-direct registry requests where CORS permits them.

Start with npm's public registry, including scoped names. Retain the repository's MIT licence. Do not install or execute packages to assess them.

Return a 0–1 **typosquatting risk score**, evidence, comparable alternatives and data freshness. The score is a documented heuristic risk measure. Do not describe it as a probability or percentage chance of malicious intent. Low downloads and similar names also occur in legitimate projects; low risk does not establish package safety.

Slopsquatting exploits AI-hallucinated package names, which need not resemble existing packages. The npm MVP can flag nonexistent names and suspicious similarities, but cannot identify all slopsquatting from a name and download counts. Include initial slopsquatting-related signals: confirmed nonexistence, publication age and release history, and weak adoption. Evaluate token blends and a sourced known-hallucination corpus as follow-on features. Return these separately from typo similarity; a new or unpopular package alone does not establish squatting. Keep `slopsquattingAssessment: "limited"` or `"not_assessed"` explicit according to evidence actually checked. Name-only inputs cannot establish that AI hallucination motivated a registration. See [package hallucination research](https://arxiv.org/abs/2406.10279).

## Architecture and where requests originate

Provisional language choice: TypeScript for a portable scoring library, registry adapters, browser client and thin HTTP handler. Revisit this during the pkgguard reuse spike: retaining Python avoids a port; TypeScript supports browser-direct execution and the proposed edge runtime. Prefer a selective attributed port if the measured reuse scope is small; do not maintain two independently evolving scorers. Keep storage and networking outside the pure scoring engine. A small workspace is sufficient; the page needs no large UI framework.

| Interface | Registry request origin | Cache | Intended use |
| --- | --- | --- | --- |
| Hosted API | Our backend | Shared persistent cache | curl, integrations |
| Browser-direct checker | Visitor's browser | IndexedDB, 24-hour expiry | Interactive demo |
| Standalone CLI | User's machine/CI | Local persistent cache | Independent and private workflows |
| Self-hosted API | User's deployment | Their shared cache | Higher-volume teams |

Browser-direct mode is conditional on an actual CORS test of both npm metadata and download endpoints, including scoped names and error responses. It removes demo registry traffic from our server, but does not reduce total registry traffic across visitors. Browsers cannot bypass CORS. If needed, show an explicit hosted-API fallback rather than silently claiming requests stay local.

The shared 24-hour guarantee applies to the hosted API. Browser and CLI caches guarantee reuse only within their own installation; unrelated browsers cannot share a cache without shared infrastructure. Ship the candidate index as a versioned static artifact, so clients need not search the whole registry themselves.

## npm data and candidate discovery

Use the [npm registry metadata API](https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md) and [npm downloads API](https://github.com/npm/registry/blob/main/docs/download-counts.md). Fetch all-version package download totals for a fixed recent date interval; initially use 30 complete UTC days. Return exact start/end dates. Add a seven-day view later if it improves evaluation.

Bulk download queries support up to 128 unscoped packages. Scoped packages need individual requests. Limit enrichment to a small shortlist, initially five alternatives. Prefer fresh stored counts for alternatives; do not repeatedly fetch popular targets for every misspelled query.

The main research gate is the candidate corpus. npm's full-text search is not a complete nearest-name index, and its popularity ranking is not an exact download count. Do not promise exhaustive npm coverage based on search results.

1. Prototype with a small checked-in fixture corpus, clearly marked as development data.
2. Investigate a maintained, redistributable package-name snapshot or an approved registry enumeration/replication source. Verify access, licence, freshness, update cost and scoped-name coverage before selecting it.
3. Build a bounded popular-target index from that source and measured download counts. Publish its source, package count, date, inclusion rule and known exclusions. A seed list is acceptable for an alpha only if coverage is visibly limited.
4. Generate candidates locally using an indexed edit-distance search; measure retrieval recall against brute force on fixtures. Benchmark a BK-tree with true Damerau–Levenshtein distance, or another verified retrieval index. Avoid an unbounded all-package scan on every edge request.
5. Refresh the corpus in a separate bounded job. Do not refresh the whole registry in an HTTP request. Preserve the previous valid snapshot if refresh fails.

Choose corpus size after measuring recall, memory, CPU and refresh budget. If a sustainable source cannot be obtained, explicitly narrow the initial product to a published target list rather than implying registry-wide detection.

## Similarity and score

Start with **Damerau–Levenshtein distance**: insertions, deletions, substitutions and adjacent transpositions. `raect` → `react` is one transposition. Preserve both the raw edit count and normalized similarity:

`similarity(a,b) = 1 - distance(a,b) / max(length(a), length(b))`

For this example, normalized similarity is 0.8. It is not the final risk score. Ensure the implementation uses the intended distance variant; optimal string alignment and unrestricted Damerau–Levenshtein are not interchangeable for all inputs or metric indexes.

[SpellBound](https://arxiv.org/abs/2003.03471) is a directly relevant baseline: it combines lexical similarity and popularity for npm and PyPI. [ConfuGuard](https://arxiv.org/abs/2502.20528) motivates using metadata to distinguish benign related packages. Read their full methods and inspect dataset/code licensing during the scoring spike before adopting rules.

For each distinct candidate with more downloads, compute:

- Raw edit distance, normalized similarity and edit type; use name-length-aware candidate thresholds.
- Download gap, ratio `(candidateDownloads + 1) / (inputDownloads + 1)`, and its logarithm.
- Absolute candidate popularity, so a 10-to-0 gap is weaker evidence than a 1,000,000-to-0 gap.
- Evidence quality: missing data, incomplete candidate coverage, stale data and recent package creation.

A provisional explainable model can multiply a bounded typo-pattern feature, bounded log-download-gap feature and bounded target-popularity feature, then take the maximum pair score. Exact functions and thresholds must be fitted or selected on evaluation data and published with a model version; do not invent a percentage interpretation. Treat unknown download counts as unknown, never as zero. A confirmed nonexistent name is a separate state from an existing zero-download package.

Keep npm scopes as identity-bearing components. Compare scope and basename separately as well as the complete name. Never flatten `@owner/pkg` into `pkg`. Future adapters must use their registry's own canonicalization rules.

Evaluate token/separator changes, keyboard-neighbour substitutions and visual confusables as later features. Shared maintainers, legitimate forks, plugins, migrations and package families can explain similarity. A self-declared repository URL alone must not establish trust. An exact match in the target corpus must not automatically bypass comparisons against other targets.

## API and CLI contract

Proposed request (placeholder hostname):

```sh
curl --get 'https://API_HOST/v1/check' \
  --data-urlencode 'name=raect' \
  --data-urlencode 'ecosystem=npm' \
  --data-urlencode 'registry=https://registry.npmjs.org'
```

Default ecosystem and registry to npm. Accept known upstream URL aliases but map them to an allowlisted registry ID; do not fetch arbitrary user-supplied URLs. This avoids turning the hosted service into an open proxy or an SSRF endpoint. Custom registries can later be operator-configured for self-hosting.

Response fields:

- Canonical input identity and `exists: true | false | null`.
- `riskScore: number | null`, `scoreKind: "heuristic"`, model version.
- `status: "assessed" | "partial" | "insufficient_data"`.
- Input downloads and their interval; alternatives with their counts, similarity, edit distance, ratio and pair score.
- Human-readable reasons and stable reason codes.
- Corpus version/coverage and observation times, cache age, expiry and stale flag.
- Explicit slopsquatting assessment status.

Use null when data is insufficient to compute the score; never return zero to represent an upstream outage. A completed nonexistent-name assessment is a normal result, not an API routing 404. Use 400 for invalid input, 429 with Retry-After for service rate limits, and 503 when unavailable without usable cached evidence. Document partial responses in OpenAPI.

Proposed CLI: `squat-spotter check raect --ecosystem npm --json`. Default to local execution using a downloaded index and direct registry requests. Add `--api`, `--offline` and an optional `--fail-on-risk` threshold. Offline mode uses the stored snapshot and clearly marks stale or missing evidence. Distinguish threshold failures from operational failures in exit codes. The proposed CLI name is not a claim that its npm name is available.

## Caching and registry protection

Use a shared durable store for raw observations as well as final responses. In-memory or regional CDN caching alone cannot satisfy the cross-request guarantee.

- Key raw data by canonical registry, package identity, data kind and date interval. Record `fetchedAt`, `expiresAt` and response state.
- Reuse successful metadata/download observations for 24 hours after retrieval, including when the package appears as an alternative to another query.
- Cache confirmed missing packages for 24 hours too; expose the resulting publication-detection delay.
- Keep raw observations separate from model/corpus versions, allowing rescoring without refetching. Pin a cached assessment's date interval for its lifetime so a midnight rollover does not trigger unnecessary requests.
- Use an atomic shared lease per data key to coalesce concurrent cold misses across instances. A single lease owner fetches; others wait briefly, use stale evidence or receive a retryable response. Leases need expiry and recovery after crashes.
- Do not treat errors as negative existence results. Apply separate short error backoff; respect upstream Retry-After. When the cache/coordinator fails, fail closed rather than letting every request hit npm.
- Add global upstream request and concurrency budgets, per-client limits, short timeouts, response-size caps and a circuit breaker. Bound retries and candidate fan-out.
- A random stream of unique package names defeats ordinary caching: stop cold lookups at the global budget while continuing to serve available cached results.
- Use identifiable contact-bearing requests where runtime rules permit; browsers restrict some request headers. Never fetch tarballs for scoring.

A database-backed atomic lease is the initial design candidate; verify correctness on the chosen backend. CDN caches can accelerate completed responses but are not the coordination authority. There is no paid bypass or refresh query parameter in the public MVP.

## Hosting recommendation

Research checked 14 November 2026; recheck before deployment.

| Option | Fit | Limits and tradeoffs |
| --- | --- | --- |
| Cloudflare Workers Free + D1 + static assets | Recommended initial API and page | Free Workers currently allows 100,000 requests/day and 10 ms CPU per HTTP request; benchmark indexed scoring. D1 stops queries at its free daily limits. Exhaustion sacrifices availability. |
| Vercel Hobby + durable external cache | Familiar alternative | Suitable if within personal/non-commercial terms; quotas can pause service. External storage needs independent cost limits and coordination. |
| GitHub Pages + separate API | Good OSS documentation/demo host | Static hosting cannot run the dynamic API. Browser-direct mode may work after CORS validation. Pages has limits and excludes commercial SaaS hosting use. |
| Local CLI / self-hosted server | Essential durable fallback | Users run the same logic independently; no dependency on our public API's uptime. |

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 free-limit behaviour](https://developers.cloudflare.com/d1/reference/faq/), [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Vercel quota pausing](https://vercel.com/changelog/spend-management-now-pauses-production-deployments-by-default), [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

The user has set a hard total hosting ceiling of £10 per month. Include applicable tax, currency conversion, storage, refresh jobs and logging in that ceiling. Start on free plans with no automatic paid upgrades. Paid infrastructure is eligible only if its total charge is genuinely bounded within the ceiling; alerts and delayed usage cutoffs do not qualify. A fixed-price or prepaid service with disabled overages is an alternative to investigate if the free tier becomes inadequate. Account quotas can be shared with other projects. Define our own lower upstream budget regardless of hosting allowances. A free-plan shutdown controls cost but cannot guarantee availability under attack. Corpus storage, refresh jobs and logging must also fit their own limits.

Cloudflare now documents paid Workers spending controls, but explicitly says these are not an exact maximum bill: metering/blocking can lag, subscription fees are excluded, and other products bill separately. Do not use them as proof of compliance with the £10 cap. See [Workers spending limits](https://developers.cloudflare.com/workers/platform/spend-management/).

The user's request-origin clarification replaces requester-paid billing: investigate browser-direct mode; do not build payments, metering for billing or a paid gateway.

## Ecosystem roadmap

An adapter declares supported identity rules, metadata access, candidate source, download metric/window, freshness and limits. Compare popularity only within the same ecosystem/upstream and comparable time windows.

| Ecosystem/upstream | Evidence available and proposed treatment |
| --- | --- |
| npm / npm public registry | First implementation. npm, pnpm, Yarn and Bun using this registry share the same adapter. |
| Python / PyPI | Next candidate. [Official BigQuery download dataset](https://docs.pypi.org/api/bigquery/) supports aggregation; [PyPI Stats](https://pypistats.org/api/) supports limited cached lookups, explicitly discourages bulk crawling. Validate sustainable index/count aggregation first. |
| Rust / crates.io | Strong next candidate. [Published database dumps](https://github.com/rust-lang/crates.io/blob/main/docs/ARCHITECTURE.md) support bulk analysis. Validate current dump schema, recent-count windows and access policy. |
| PHP / Packagist | Strong next candidate: [API](https://packagist.org/apidoc) exposes monthly/daily download counts. Preserve vendor namespaces. |
| Ruby / RubyGems | [API](https://guides.rubygems.org/rubygems-org-api/) provides cumulative downloads. Validate a recent-count source or accumulate dated snapshots before claiming equivalent recent-window scoring. |
| .NET / NuGet | [Search API](https://learn.microsoft.com/en-us/nuget/api/search-query-service-resource) provides cumulative downloads. Recent counts require a validated source or historical snapshots. |
| Java / Maven Central; Go modules; other registries | Research backlog. Public comparable recent-download feeds were not established in this research. Do not substitute stars or dependent counts while labelling them downloads. Go also requires host/path-aware identity handling. |

Where only cumulative counts exist, offer a separately labelled reduced-evidence model or wait for sufficient snapshots. Do not promise the same numeric interpretation across ecosystems without evaluation.

## Delivery sequence and acceptance gates

1. **Feasibility spike:** validate npm endpoint behaviour, scoped names, missing-package semantics and real browser CORS; select a lawful sustainable corpus; measure index CPU/storage and refresh request budget. Deliver findings and fixtures. Corpus feasibility is a launch gate.
2. **Core and API contract:** audit/reuse selected pkgguard components, implement parsing, retrieval, deterministic distance/features and versioned JSON assessments. Separate data acquisition from scoring and scoring from enforcement. Establish replay fixtures before adding interfaces.
3. **Hosted API:** implement adapter, shared 24-hour cache, atomic leases, bounded upstream budgets, OpenAPI and self-hosting instructions. Prove concurrent identical requests produce one upstream fetch per data key, and repeated comparisons reuse target counts.
4. **Policy integration and supporting interfaces:** validate a Cloudsmith enrichment/policy proof of concept; add the independent CLI with local cache and offline snapshots. **Minimal webpage:** semantic HTML, system font, simple form, score/evidence table, freshness, coverage, caveats and copyable curl example. Add browser-direct execution after CORS passes, with clear execution mode. Leave visual design for the user.
5. **Evaluation and public alpha:** test known cases, synthetic typos and legitimate near-name pairs; publish coverage and limitations. Deploy only after cost and load protections are demonstrated.
6. **Expansion:** add the next adapter based on data feasibility; improve metadata explanations, scoring calibration and dedicated slopsquatting evidence separately.

Validation must include transpositions, short names, scopes, legitimate package families, unavailable counts, 404 versus 429/5xx, cache rollover, expired leases, concurrent misses, coordinator outage and unique-name floods. Use mocked registry/load tests rather than hammering npm. Ensure parity between CLI, browser and API for the same observations and model version.

Evaluate candidate-retrieval recall separately from score quality. Use known malicious cases and reviewed benign near-name packages, with target-family and time-separated evaluation splits. Synthetic typos test spelling coverage, not malicious intent. Report precision/recall, false positives, requests per cold/warm check and latency. Keep risk terminology throughout; choose any suggested CI threshold from measured results.

## Confirmed decisions

- Use a risk measure throughout, avoiding probability terminology.
- Include limited slopsquatting-related evidence, clearly separating it from spelling similarity and exposing unassessed cases.
- Hard total hosting ceiling: £10 per month. Free hosting remains the starting recommendation; no unbounded paid metering.
- Launch with tightly limited anonymous API access. CLI and self-hosting support heavier usage.
- npm first; MIT open source; minimally styled page; independent CLI; 24-hour shared API cache; investigate browser-origin requests instead of requester billing.

## Existing tools and useful differentiation

Research checked 14 November 2026. SpellBound was renamed TypoGard: the [author's README](https://github.com/mt3443/typogard) explicitly connects the names. It offers a client-side npm checker, a supplied popular-name list and a proof-of-concept modified npm installer. Public documentation establishes availability, but does not establish current widespread deployment, a maintained hosted API or current user numbers. Do not infer abandonment or adoption from this absence of evidence.

The [published TypoGard paper](https://ldklab.github.io/assets/papers/nss20-typogard.pdf) uses specific typo transformations and a popular/unpopular threshold. Plain edit distance is therefore a baseline to benchmark, not a reproduction of its full method. Include its transformation rules in the comparison before fixing the feature set.

Related projects to evaluate before implementation:

- [Rust Foundation Typomania](https://github.com/rustfoundation/typomania): reusable package-name detection primitives derived from TypoGard.
- [andrew/typosquatting](https://github.com/andrew/typosquatting): cross-ecosystem name transformations, CLI/SBOM checking and registry metadata through ecosyste.ms.
- [pkgguard](https://github.com/rxslice/pkgguard-API): particularly close overlap. Its README documents an API, CLI, npm/PyPI/crates.io support, download-gap scoring, age/existence signals and hallucination/conflation checks. These are documented capabilities, not independently validated accuracy or adoption claims.

The opportunity is a small, easy-to-integrate public service with reproducible continuous risk scores, explicit evidence and freshness, well-measured false positives, dependable candidate coverage, browser/local parity and conservative registry traffic. API plus CLI alone is not a unique feature. Compare existing implementations on a shared labelled benchmark and consider reusing compatible components or contributing upstream where that serves the product better. Do not claim technical novelty or superior accuracy before measuring it.


## pkgguard reuse assessment and centralised policies

Inspected upstream commit `53dadd7ad16dcc99e5e19e135447f2ffb02e1df3` on 14 November 2026. The prototype now includes an attributed TypeScript port of the OSA distance helper as a reference baseline; see THIRD_PARTY_NOTICES.md. Production scoring, registry acquisition and caching are original implementations.

### Reusable foundations

The actual [registry adapters](https://github.com/rxslice/pkgguard-API/blob/53dadd7ad16dcc99e5e19e135447f2ffb02e1df3/pkgguard/registries.py) include `fetch_npm`, `fetch_pypi` and `fetch_crates`. npm metadata and downloads support already exists. [Scoring](https://github.com/rxslice/pkgguard-API/blob/53dadd7ad16dcc99e5e19e135447f2ffb02e1df3/pkgguard/scoring.py) is numerical too: additive integer weights with a 0–100 result and built-in verdict thresholds. Our contribution must go beyond dividing that score by 100.

Candidates for selective reuse: registry parsing and normalized facts, typo transformations/distance routines after correctness checks, conflation analysis, and applicable test fixtures. Corpus files and refresh scripts require separate provenance, coverage, freshness and redistribution checks. Review the conflation implementation and tests before importing them; they were identified but not fully audited in this pass.

Required changes based on the inspected implementation:

- Replace the five-minute local file cache and process-only target-download cache with shared persistent 24-hour observations and distributed request coalescing.
- Separate registry errors from confirmed nonexistence. Upstream records `exists=False` plus an error and returns an arbitrary score of 50 for registry failure; our contract uses unknown existence and insufficient-data status rather than manufacturing a risk value.
- Supply a complete immutable evidence snapshot to the scorer. Upstream's scoring callback can fetch target downloads; our pure scorer must perform no network access. Package age must derive from an explicit assessment timestamp, not the wall clock during replay.
- Return multiple ranked targets with deterministic tie-breaking. Upstream's search stops at the first distance-one match and bypasses names in its popular corpus; do not inherit those shortcuts without evaluation.
- Its edit routine is optimal string alignment. Do not insert it into a BK-tree requiring metric properties without proving retrieval correctness; use unrestricted distance or a compatible retrieval strategy.
- Retain explicit download window dates and metric definitions per ecosystem; do not assume a field called recent downloads always represents one month.
- Keep measurement independent of organisation-specific allow/review/block policy. Missing information and service availability are separate from risk.

### Attribution and licence

Upstream is [Apache-2.0](https://github.com/rxslice/pkgguard-API/blob/53dadd7ad16dcc99e5e19e135447f2ffb02e1df3/LICENSE). Copying or porting selected code is permitted subject to its terms. Include the licence, preserve applicable attribution/copyright notices, mark modified files and retain any applicable NOTICE material. The inspected tree has no top-level NOTICE file. Record the upstream commit and each reused file in THIRD_PARTY_NOTICES when importing. Original Squat Spotter code can retain MIT terms; imported/derived portions must remain clearly identified with their Apache obligations. Do not describe all bundled code as MIT-only. See [Apache licence text](https://www.apache.org/licenses/LICENSE-2.0).

### Deterministic policy contract

Define scoring as `score(canonicalIdentity, evidenceSnapshot, corpusSnapshot, modelVersion, assessmentTime)` with no randomness or hidden network inputs. The same inputs produce the same result. Live results can legitimately change when observations or corpus versions change.

Return model version, evidence digest, corpus version, assessment timestamp, observed download intervals, feature contributions, score precision/rounding and stable reason codes. Persist or export the evidence needed for replay; a digest alone cannot reproduce a result. Policy clients can pin a model version and apply their own thresholds and exceptions. Use an explicit schema version and reject unavailable pinned versions rather than silently falling forward.

The public API reports measurements, not a universal enforcement verdict. Add bounded batch assessment for repository events after single-name semantics are stable. The CLI is a diagnostic/automation surface and fallback, not the primary enforcement point. The web app explains assessments and makes individual checks easy.

### Cloudsmith integration hypothesis

Cloudsmith documents [custom metadata usable by policy matching](https://cloudsmith.com/changelog/enrich-packages-with-custom-metadata), a [metadata API](https://docs.cloudsmith.com/artifact-management/custom-metadata-api), and [repository webhooks](https://docs.cloudsmith.com/api/webhooks/create). Proposed flow:

1. A repository event reaches an organisation-operated integration worker.
2. The worker derives canonical public upstream identity and calls Squat Spotter.
3. It stores the assessment, model/evidence identifiers and freshness as package metadata.
4. The organisation's Rego policy evaluates the assessment and decides whether to quarantine/release or request review.

This is a design to validate, not a tested integration. Do not assume Cloudsmith Rego permits arbitrary HTTP calls. Verify entitlement (custom metadata is currently documented as early access for Ultra/Enterprise), metadata schema visibility to policy, event authenticity, re-evaluation after updates, duplicate/out-of-order event handling and permissions. Keep Cloudsmith credentials in the organisation's integration worker, out of the anonymous scoring API.

A post-ingestion webhook alone cannot guarantee prevention of the first download. Validate default quarantine or a staging/promote workflow, with release only after a complete assessment. Define explicit policy for missing, stale and failed assessments; never silently allow during an API outage. Bind metadata to the Cloudsmith artifact identity as well as the public upstream name, and ensure only the trusted integration can provide policy-authoritative results. Refresh on evidence expiry and model updates using bounded jobs.

First implementation milestone: selective-reuse spike plus a replayable npm assessment and policy-consumable JSON contract. Next: shared caching, public API, then Cloudsmith proof of concept and minimal web UI. These changes retain the hard £10/month hosting ceiling and anonymous public reads.
