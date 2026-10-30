# Coding harness contract recovery

## TLDR
Correct demonstrated source-delivery, seeded-entrypoint and executable-oracle mismatches from a stopped local Qwen experiment. Keep genuine model/type/safety failures visible. Use four existing runtime owners plus one optional Pi delivery hook rather than adding case-specific prose across skills.

## Overview and problem
The analysis at `.ai/analysis/2026-10-30-qwen27b-coding-failures.md` accounts for thirteen completed failures and one interruption. Models invent imports and APIs after legitimate linked examples are denied, guess replacement files while the real seeded seam remains broken, and encounter structural predicates inconsistent with the installed API. Some required context closures cannot fit their declared bounds.

Recovery exposed an additional transport defect: the installed Pi CLI middle-truncates MCP text above 20 KiB. Successful 47,378-byte and 20,970-byte reads reach the model as roughly 20 KiB plus a warning. The saved full-output pointer is inaccessible through the restricted tool set. Harness read success alone therefore does not prove complete model delivery. This defect is reproduced against the actual installed bundle; its causation of a particular coding error remains unproven.

Related intent: `2026-07-24-standalone-ai-development-harness`, `2026-08-01-standalone-harness-example-read-policy`, `2026-08-01-standalone-harness-knowledge-governance`, `2026-08-14-standalone-harness-optimizations` and canonical-list UI enforcement. This change preserves their safety and source-first contracts.

## Proposed solution and architecture
- Case catalog: declare the exact existing readable example capabilities/facts required by each affected branch. Permit only necessary exact registry writes. Calibrate bounds from mandatory closure measurements; do not widen them to hide optional or unrelated reads.
- Evaluator: distinguish coding from read-only routing prompts, disclose bounded safe seeded source paths, require preserving and repairing their ABI, and make instruction/fact selectedContext accounting unambiguous. Resolve declared source references into exact instruction-owner/source/access metadata and disclose the immutable baseline app's test script, bounded and hashed. Metadata neither grants access nor substitutes for observed tool reads. Read-only prompts retain their behavior.
- Prepared installed context: admit exact manifests/searches and bounded relevant production sources. Reject unsafe, QA-only or infeasible mandatory evidence before launching inference. Preserve version/source provenance and all real successful-read requirements.
- Structural oracle: follow bounded reachable UI components and recognize real exported enricher/contribution/override/interceptor/agent/workflow shapes. Reuse existing helpers and behavioral probes; reject orphan/dead/comment-only and wrong-scope substitutes.
- Fixture seed: express a deliberately incorrect behavior through the current typed interceptor contract rather than teaching an obsolete API. The before-fail requirement remains.
- Cached delivery: declare the exact external knowledge inputs copied by the CLI builder, retaining caching and the existing create-app dependency edge. A normal cached build must deliver the same harness bytes as the authoritative sources.
- Optional Pi delivery: ship one portable shared extension using Pi's supported `tool_result` hook. For the exact successful harness read identity, restore the original single text block from structured MCP content in memory, bounded by the canonical server's 256 KiB limit. Preserve errors and unrelated tools; malformed or oversized successful-read envelopes become explicit delivery errors. Add no filesystem recovery, tools, read grants, provider dependencies or official runner registration.

Each independent assertion has one primary owner. Case declarations select existing source capabilities; implementation checks belong to the oracle; trusted seed disclosure and prepared-context bounds belong to the evaluator. The optional Pi extension owns client-side complete-text delivery, and existing recursive copying ships it. The build-input declaration owns cached packaging of the knowledge owners. Tests and inventory/doc synchronization support them.

## Data models and API contracts
No production data model or application HTTP API changes. Existing case metadata and source-reference inventories remain authoritative; avoid introducing parallel schemas or provider-specific preconfiguration. Preserve result statuses, oracle IDs, trace safety, first-attempt provenance and stopped/interrupted distinctions. Any optional internal helper export is additive and testable.

## Coverage and integration
- Failure-first tests for exact readable examples versus unrelated/QA/unsafe sources and mandatory closure bounds.
- Exact seed hints for OMH-012/045/054/057/060, no directory discovery or oracle leakage; unchanged sidecars still fail behavior.
- Positive current-API structural controls and negative orphan/comment/dead helper/unregistered/wrong-scope controls for OMH-014/026/027/029/031/049/054.
- Prepared-context synthetic packages with production and QA matches, oversized instructions, unsafe evidence and byte-budget preflight.
- Coding-only source metadata with exact capability checks, writable registry versus read-only example roles, no expected routing answers, safe baseline script extraction, and byte-identical read-only prompt controls.
- Fresh coherent classic/codex scaffold and applicable packed/Verdaccio surface; emitted/source/link/hash parity; deterministic catalog and knowledge-change controller.
- Real Turbo cache restoration before and after a copied-authority mutation, unchanged-input cache-hit controls, and transitive create-app hash/output freshness.
- Semantic clipped-result regressions for the Pi hook, including multibyte byte limits, exact identity/success checks, malformed/resource/foreign/write/error negatives, actual installed converter-to-hook evidence without model calls, and emitted extension parity through both scaffold generators.
- Separate fresh local Qwen attempts for all fourteen observed tasks. Run target generate/typecheck/lint/build, smallest generated tests and isolated judgment for eligible results. Full release certification requires the supported runner and platform lanes; explicitly report unavailable gates.

## Migration and backward compatibility
No published runtime import, CLI, event, database, ACL, DI or widget contract is removed or narrowed. Harness prompts and acceptance logic change only to match existing executable contracts and bounded task knowledge. Existing historical scores remain immutable. No model-specific answer hints or grader exemptions.

## Risks and impact
| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Grader becomes easier while hiding invalid output | High | Type/behavior gates remain; positive and negative semantic fixtures, fixed target entrypoints | Qwen can still fail valid checks |
| Source grants or closure become broad | High | Existing exact inventories, QA-only/unsafe negatives, preflight byte bounds | Installed versions can change measured closure |
| Seed or AST differs from runtime ABI | High | Typed current-contract controls and actual behavior probes | Supported alternate implementations need bounded coverage |
| Local model result mistaken for release certification | High | Separate provenance, supported-lane reports, no implied pass | macOS/experimental transport cannot certify Linux lanes |
| Existing Node26/macOS sandbox failures block repository gate | Medium | Reproduce baseline; preserve confinement and report blocker | Draft may require compatible validation environment |

## Implementation and final compliance
Execution: `.ai/runs/2026-10-30-qwen-coding-harness-recovery.md`. Analysis and shared implementation complete; fresh-model, knowledge/release and final validation evidence pending. Follow the knowledge-contract nine-step process and authoritative review before declaring completion.

## Changelog
- 2026-10-30: Recorded stopped-run evidence, smallest-owner repair design, protected checks and before/after validation requirements.
