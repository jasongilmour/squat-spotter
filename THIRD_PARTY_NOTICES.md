# Third-party code and research

Squat Spotter's original code is licensed under [MIT](LICENSE). The following adapted code retains its upstream Apache-2.0 obligations; the repository is not an assertion that third-party code is MIT-only.

## pkgguard

- Project: [rxslice/pkgguard-API](https://github.com/rxslice/pkgguard-API), built by Blvkware (https://blvkware.dev).
- Inspected/pinned revision: [`53dadd7ad16dcc99e5e19e135447f2ffb02e1df3`](https://github.com/rxslice/pkgguard-API/tree/53dadd7ad16dcc99e5e19e135447f2ffb02e1df3).
- Licence: [Apache License 2.0](licenses/pkgguard-Apache-2.0.txt).
- Adapted code: `src/core/pkgguard-osa.ts` ports the `levenshtein` function from [pkgguard/scoring.py](https://github.com/rxslice/pkgguard-API/blob/53dadd7ad16dcc99e5e19e135447f2ffb02e1df3/pkgguard/scoring.py) to TypeScript as a reference baseline. Changes: language/types, explicit optimal-string-alignment naming, exported function. File-level notices identify the adaptation. This baseline is not the production scoring distance.
- We inspected [registries.py](https://github.com/rxslice/pkgguard-API/blob/53dadd7ad16dcc99e5e19e135447f2ffb02e1df3/pkgguard/registries.py) and [service.py](https://github.com/rxslice/pkgguard-API/blob/53dadd7ad16dcc99e5e19e135447f2ffb02e1df3/pkgguard/service.py) as design references. Our npm acquisition, caching and scoring orchestration are original implementations, not a copy of those files.
- No upstream corpus is bundled. The prototype seed list is independently specified and explicitly incomplete. Demo download counts are synthetic.
- No top-level upstream NOTICE file was present in the inspected revision. This document records provenance; it does not imply endorsement by pkgguard or Blvkware.

## Research and specifications (references, not bundled code)

- [SpellBound / TypoGard paper](https://arxiv.org/abs/2003.03471) and [implementation](https://github.com/mt3443/typogard): name transformations and popularity as package-confusion signals.
- [ConfuGuard](https://arxiv.org/abs/2502.20528): metadata and benign explanations for similar package names.
- [Package hallucination research](https://arxiv.org/abs/2406.10279): why spelling similarity alone does not cover slopsquatting.
- [npm registry API](https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md) and [download-count API](https://github.com/npm/registry/blob/main/docs/download-counts.md): public registry observations.

Reusing a standard mathematical algorithm does not make our independently written implementation an upstream code port. Any further imported code or data must be recorded here with its source revision and applicable terms.
