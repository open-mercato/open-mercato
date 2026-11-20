# Standalone Harness Refresh

- Outcome: dry-run
- Local range: `a3763359b83d..10d60235d793`
- Catalog before/after: `240` / `240`
- External systems mutated by this refresh audit: none
- Harness catalog, knowledge owners, schemas, validators, and release matrix edited: none
- Primary live runner: not selected; portability runner: not requested

## Evidence and classification

| Candidate | Classes | Risk | Repository-relative evidence | Contract/ID summary |
|---|---|---|---|---|
| C1: encrypted custom fields in search build contexts | Module, installed public contract, regression/safety, documentation | High | `packages/search/src/{indexer,vector,lib,di.ts}`; `.ai/specs/2026-10-30-search-build-context-encrypted-custom-fields.md`; `BACKWARD_COMPATIBILITY.md`; `UPGRADE_NOTES.md` | `SearchIndexer` and the exported opt-in `VectorIndexService` now omit encrypted custom fields from source callbacks and callback query results; missing or failing definition resolution omits every custom field. |
| C2: resolver failure behavior | Regression/safety, observability | Medium | `packages/search/src/indexer/search-indexer.ts`; `packages/search/src/lib/debug.ts`; focused search tests | Resolver failures are memoized per operation and non-`Error` rejection values are normalized before telemetry or structured logging. |

## Deduplication

| Candidate | Disposition | Existing/new case | Rationale |
|---|---|---|---|
| C1 | Covered | OMH-017 | The existing search-index case already requires sensitive values to remain excluded and routes bulk writes through `SearchIndexer`; standalone module authors do not need a second model case for the internal resolver implementation. Direct indexer consumers receive the installed contract through framework docs and upgrade guidance. |
| C2 | Evidence only | None | Failure caching and telemetry normalization are runtime implementation details exercised by focused package tests, not a distinct standalone-agent routing or authoring decision. |

No distinct standalone routing, implementation, or writable-oracle failure was reproduced. The final `cases.json` is byte-identical to the base (`sha256 3b3ab05e82d959092ec5089446f563c3e8b364e852eed72f4c6d14aa7ec859d9`), so no harness knowledge owner or catalog surface changed.

## Failure-first and owners

| Case or surface | Sanitized before evidence | One primary owner | Result after change |
|---|---|---|---|
| Runtime callback privacy | Focused regressions show encrypted values reached source callbacks and the legacy vector path before the implementation fix. | Installed search runtime and its public framework documentation | Both indexers fail closed, including hydrated callback queries and metadata-like custom fields; existing OMH-017 remains the smallest standalone owner. |

This dry-run did not run a model against a base checkout or edit a harness owner. Runtime regression tests, not a fabricated model evaluation, are the failure-first evidence for this internal security repair.

## Synchronized surfaces

| Catalog/schema/matrix/spec/doc/test surface | Before | After |
|---|---|---|
| `cases.json` | 240 cases | 240 cases; byte-identical to base |
| Case schema, validators, release matrix | Existing source assets | Unchanged |
| Installed search contract | One production indexer filtered callback contexts; the exported opt-in vector path remained unsafe | Both indexers apply the same tenant-aware, fail-closed contract |
| Compatibility and upgrade guidance | Verbose waiver entry and incomplete legacy-path guidance | Compact end-of-file waiver plus client/operator remediation for both indexers |
| Runtime regression coverage | SearchIndexer paths | Adds failure-storm, non-`Error`, vector callbacks, callback-query, missing-resolver, and metadata-like-key coverage |

## Validation

| Command/lane | Runner/model/version | Result | Sanitized artifact or limitation |
|---|---|---|---|
| `node scripts/check-agents-md-budget.mjs` | Local | Pass | Root budget remains within its hard limit; the changed search instructions are shorter than the pull-request parent and place the security rule in the loaded prefix. |
| Focused vector security test, search package typecheck, and search package build | Local child worktree | Pass | 58 focused tests passed; typecheck exited zero; 103 entry points built. |
| Combined focused tests in coordinator worktree | Local | Unavailable | The nested worktree cannot resolve its Yarn node-modules state, and inherited Jest transform dependencies are version-skewed; no pass is claimed. |
| Deterministic `yarn harness:validate --all` | Not selected | Not run | Catalog and harness owners are unchanged; byte identity is recorded above. |
| Full `yarn harness:release --runner <runner> --prepare-targets <empty-target-directory> --acknowledge-writes` | Primary runner not selected; portability not requested | Not run | No catalog/owner change and no release certification is claimed. |

## Blockers or evidence-only decisions

- The runtime change does not justify duplicating OMH-017. A future reproduced standalone-agent failure involving direct indexer construction should expand that case through the full knowledge-change workflow.
- Existing indexed values and external provider copies require operator reindex/purge and retention remediation; the runtime fix cannot recall them.

## Sanitization attestation

No raw diff, commit or pull-request body, private prompt or transcript, credential, token, environment value, absolute path, remote URL, or author identity is included.
