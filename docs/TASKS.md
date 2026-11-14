# Prototype tasks

Branch: `codex/npm-risk-prototype`. Parallel implementation uses Terra agents with separate file ownership. The maintainer integrates and commits checkpoints.

| Task | Owner | Scope | State |
| --- | --- | --- | --- |
| P1: Deterministic scoring | scoring agent | Snapshot validation, unrestricted edit distance, numerical formula, replay digest, synthetic fixtures, tests | In progress |
| P2: npm evidence | npm_data agent | Strict identities, original seed corpus, npm metadata/download adapters, persistent cache and local leases, mocked tests | In progress |
| P3: API and interfaces | api_web agent | HTTP contract, replay endpoint, CLI, minimal web checker, OpenAPI, HTTP tests | In progress |
| P4: Integration and provenance | coordinator | Shared contracts, toolchain, README, licence attribution, CI, integration checks, Git checkpoints | In progress |

## First-step acceptance

- Deterministic numerical risk for supplied immutable npm observations, with an auditable formula and no probability language.
- Model, evidence and corpus identifiers returned; unknown data is distinct from zero downloads and nonexistent names.
- Anonymous local API returns measurements. Cloudsmith owns policy and blocking; no Cloudsmith credentials or mutations in this service.
- Live npm checks are bounded and cached for 24 hours on a single host, including concurrent duplicates. Cloud-distributed caching remains a later milestone.
- Seed corpus limitations are explicit; synthetic demo values are not presented as live registry facts.
- Offline CLI/replay works without registry access.
- Tests cover scoring, data acquisition/cache, HTTP contract and failure cases. Minimal page checked locally.
- Code reuse is pinned and attributed. Branch and meaningful checkpoints pushed to origin.

## Follow-on gates

Sustainable candidate corpus and recall evaluation; distributed cache backend; hard-capped hosting; browser-direct CORS validation; Cloudsmith adapter proof of concept; additional registries. None are claimed complete by this prototype.
