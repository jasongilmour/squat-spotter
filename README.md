# Squat Spotter

Deterministic numerical package-name risk assessments for centralised supply-chain policies. Start with npm; return a score from **0 to 1**, the comparable packages and the evidence behind it. The consuming policy system—such as Cloudsmith—owns thresholds, exceptions and blocking.

**Prototype:** local API, minimally styled web checker, CLI and offline replay. The candidate corpus is a small, explicitly labelled seed list, so assessments have `partial` coverage. This is not a malware scanner or a safety verdict. Dedicated slopsquatting analysis is not implemented yet; an AI-invented name with no close match can be missed.

## Run locally

Requires Node.js **24+** and npm. There are no runtime dependencies. TypeScript and Node type definitions are local development dependencies; no global CLI, account, API key or MCP is required.

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run demo
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The web form calls the local backend, which calls npm. Browser-direct registry requests are a later feature. `PORT` and `HOST` can override the local bind address; this prototype is not hardened for public deployment.

`npm run demo` is offline. Its `raect` fixture contains **synthetic** download counts and existence states, not facts or an allegation about real packages. Live checks make a bounded number of registry metadata/download requests and never install or execute packages.

## HTTP API

```sh
curl --get 'http://127.0.0.1:3000/v1/check' \
  --data-urlencode 'name=raect' \
  --data-urlencode 'ecosystem=npm' \
  --data-urlencode 'modelVersion=0.1.0'
```

The default upstream is `https://registry.npmjs.org`; arbitrary registry URLs are rejected. npm scoped names are supported and retain their scope identity. Other ecosystems are not implemented in this prototype.

Responses include:

- `riskScore`: numerical risk, or `null` when evidence is insufficient.
- `status`, `reasonCodes`, `exists`: coverage and evidence limitations, distinct from risk.
- `alternatives`: similar higher-download names, edit distances, similarity, download ratios and score contributions.
- `subject`, `window`: input observations and the explicit inclusive download interval.
- `modelVersion`, `corpus`, `evidenceDigest`, `assessmentTime`: identifiers for audit and replay.
- `slopsquattingAssessment: "not_assessed"`: no broad slopsquatting detection claim.

Invalid inputs return 400, oversized replay bodies 413, client rate limits 429, and unavailable/insufficient live evidence 503. A live 503 can include a structured `assessment` with unknown data. A successful check has HTTP 200 even when risk is high: the API does not enforce policy. See [OpenAPI](docs/openapi.json).

## CLI and reproducible replay

```sh
# Live npm evidence, optionally saved for replay
node src/cli.ts check raect --json --write-snapshot /tmp/raect-evidence.json

# Recompute from exactly those observations, without registry access
node src/cli.ts --fixture /tmp/raect-evidence.json --json

# Replay the supplied synthetic fixture over HTTP
curl 'http://127.0.0.1:3000/v1/assess?modelVersion=0.1.0' \
  -H 'Content-Type: application/json' \
  --data-binary @fixtures/raect.json
```

The same validated snapshot and model version produce the same result. Evidence changes legitimately change the live score. Save the snapshot as well as its digest: a hash alone cannot reproduce an assessment. The replay endpoint accepts caller-supplied evidence; it is **not an attestation that the observations came from npm**. Policy integrations must control the evidence source and trust boundary.

## Calculation

The prototype combines unrestricted Damerau–Levenshtein name similarity, a log-scaled recent-download ratio and absolute target popularity. It scores each eligible pair and returns the maximum. Constants and cutoffs are provisional, not benchmark-validated. The exact formula, rounding, scope rules, unknown-data behaviour and digest format are documented in [SCORING.md](docs/SCORING.md).

We compare against a small port of pkgguard's optimal-string-alignment distance helper. That reference baseline is distinct from the unrestricted distance used by this scorer. It demonstrates an important edge case and gives us an attributed starting point for reuse without inheriting pkgguard's enforcement decisions.

## Caching and operational boundaries

Live checks use persistent files in `.cache/npm`, a 24-hour lifetime for successful/missing observations, short error backoff and local exclusive leases to coalesce concurrent requests. Download intervals remain pinned while cached. Popular target observations are reusable between checks. No cache files are committed.

The prototype bounds requests, response size, timeouts and candidate enrichment. These are **single-host controls**, not a distributed production guarantee. Request budgets are process-local and restarting resets them. See [NPM-DATA.md](docs/NPM-DATA.md) for details and limitations. A production API needs a shared durable cache/coordinator, deployment-wide upstream budgets and a validated candidate dataset before public launch.

Hosting has not been deployed. The project has a **hard £10/month total hosting ceiling**; alerts and delayed paid-usage cutoffs do not satisfy it. We will validate genuinely bounded hosting before deployment.

## Central policy integration

The intended flow is a trusted organisation-operated integration calling this API, recording the score and evidence identifiers against a package, and letting Cloudsmith evaluate policy and perform blocking. No Cloudsmith credentials, policy evaluation or package-state changes belong in the anonymous public scoring service. Cloudsmith integration is planned, not implemented here.

## Code and research credits

- [pkgguard](https://github.com/rxslice/pkgguard-API/tree/53dadd7ad16dcc99e5e19e135447f2ffb02e1df3): pinned reference implementation. The OSA helper is adapted under Apache-2.0; its broader scoring and registry code informed the design. It already supports npm, PyPI and crates.io.
- [SpellBound / TypoGard](https://arxiv.org/abs/2003.03471) and [code](https://github.com/mt3443/typogard): lexical transformations and popularity as detection signals.
- [ConfuGuard](https://arxiv.org/abs/2502.20528): metadata-informed package-confusion assessment.
- [Package hallucination research](https://arxiv.org/abs/2406.10279): slopsquatting scope and limits.
- npm's [registry API](https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md) and [download API](https://github.com/npm/registry/blob/main/docs/download-counts.md).

Original code is [MIT-licensed](LICENSE). Adapted third-party code carries its upstream terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the bundled [Apache-2.0 licence](licenses/pkgguard-Apache-2.0.txt). No upstream package corpus is redistributed.

See [PLAN.md](PLAN.md) for the roadmap and [TASKS.md](docs/TASKS.md) for parallel prototype tasks and acceptance gates.
