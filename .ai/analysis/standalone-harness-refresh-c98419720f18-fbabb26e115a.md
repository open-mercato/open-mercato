# Standalone Harness Refresh

- Outcome: dry-run, no harness edits
- Local range: `c98419720f18..fbabb26e115a`
- Catalog before/after: 243 / 243
- External systems mutated during this audit: none

## Evidence and classification

| Candidate | Classes | Risk | Repository-relative evidence | Contract summary |
| --- | --- | --- | --- | --- |
| Sales workflow policy | Installed public contract, module surface, regression safety | Medium | packages/core/src/modules/sales/lib/documentWorkflowPolicy.ts; sales/di.ts; sales/data/validators.ts | Additive scoped DI service and optional activation; no changed discovery convention or existing required signature |
| Command enforcement | Module surface, regression safety | Medium | sales/commands/documents.ts; sales/commands/returns.ts; sales/commands/shipments.ts | Existing three creation commands enforce the opt-in policy under parent locks; scope and permissions unchanged |
| Return quantities | Installed public contract, regression safety | Medium | sales/lib/shipments/snapshots.ts | Optional additive shipment-status argument; omitted argument preserves behavior |
| Coverage and guidance | Testing, UI localization | Low | sales commands/lib unit tests; sales/__integration__/TC-SALES-058-document-workflow-guards.spec.ts; apps/docs/docs/framework/modules/sales/workflow-guards.mdx | No new generic authoring rule, generator, template registration or UI component contract |

## Deduplication

| Candidate | Disposition | Existing case | Rationale |
| --- | --- | --- | --- |
| Exact installed policy/service lookup | Covered by existing routing/context mechanism | OMH-003 | Generic module facts and bounded installed-source inspection already resolve exact DI and exported contracts; the additive business policy needs no new routing owner |
| Canonical action/status business rules | Evidence-only/no evaluation | Domain unit and HTTP regressions | These are sales application behavior, documented and tested in its owning module, without changing an agent-harness knowledge contract |
| Transaction and scope protections | Evidence-only/no evaluation | Existing module-data guides and domain regressions | No new protection mechanism or platform contract is introduced; guards consume the existing scoped order and locking helpers |

## Failure-first and owners

No harness knowledge owner changed. The implementation's command regressions fail on the original command implementations and pass with the policy integration. Existing integration-fixture cleanup and authoritative-command-guard lessons were consulted; no duplicate agent guidance was added.

## Synchronized surfaces

Catalog, schema, validator, release matrix, template, source-link inventory and knowledge-owner counts: unchanged. Module discovery generation ran successfully. Application-level policy docs are owned by the sales framework documentation.

## Validation

| Command or lane | Runner | Result | Reason |
| --- | --- | --- | --- |
| Local range and catalog semantic audit | Local read-only Git and catalog inspection | Complete | Ancestor range; additive business surface classified |
| Focused domain regression tests | Repository Jest | Passed | Thirty new policy, quantity and command cases; seven command cases fail before integration |
| Focused harness evaluation | Not run | Dry-run only | No harness owner or case edited |
| Deterministic harness catalog gate | Not run | Dry-run only | No catalog mutation; no new catalog pass claimed |
| Full standalone release suite | Not run | Dry-run only | No release or scaffold certification requested or claimed |

## Blockers or evidence-only decisions

No new harness case is proposed. This audit does not certify a fresh packed standalone release or a different model's portability lane. A full harness refresh is unnecessary for this additive, opt-in sales policy because the existing knowledge routes and source lookup contracts are unchanged.

## Sanitization attestation

No raw diff, private body, transcript, credential, runtime environment value, absolute path, remote URL or author identity is included.
