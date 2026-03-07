# Pre-Implementation Analysis: SPEC-045 / 045a / 045b / 045c (Integration Marketplace)

## Executive Summary
The spec set is directionally strong, but it is **not implementation-ready** yet. The biggest blockers are backward-compatibility gaps (especially around `IntegrationDefinition` shape and payment credential migration), plus missing contract details in SPEC-045c (API, tests, risk, migration plan). Current codebase state is also far behind the target architecture, so implementation requires explicit phased bridges to avoid regressions.

## Backward Compatibility

### Violations Found
| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | Type definitions & interfaces (#2) | SPEC-045a expands `IntegrationDefinition` from current minimal shape (`id`, `title`, optional icon/url builder) toward much richer required metadata. Making new fields required would break existing callers of `registerIntegration(...)` (already used in example module). | Critical | Keep existing fields and make all new fields optional in v1; introduce `IntegrationDefinitionV2` or runtime validation profile for marketplace-only fields. |
| 2 | Function/API behavior (#7) | SPEC-045c moves payment API keys from `SalesPaymentMethod.providerSettings` to `IntegrationCredentials` without a defined dual-read/dual-write bridge. Existing payment methods may fail at runtime after rollout. | Critical | Add migration bridge phase: read from `IntegrationCredentials` first, fallback to `providerSettings`; write to both for one minor release; add backfill migration + release notes. |
| 3 | Database schema (#8) | SPEC-045b models `SyncExternalIdMapping` under `data_sync`, but table/class already exists in `integrations` (`sync_external_id_mappings`). Spec does not define ownership migration/duplication strategy. | Critical | Keep single source of truth table/entity (prefer current `integrations`), and reference it from `data_sync` services. Do not create duplicate table/entity contracts. |
| 4 | Generated file contracts (#13) | SPEC-045a requires generator support for `integration.ts` and bundles but does not define generated contract shape/versioning expectations. | Warning | Define generated file contract explicitly (new generated file names/exports additive only; no changes to existing required exports). |
| 5 | Event IDs (#5) | New event sets are introduced, but no deprecation/dual-emit strategy is described for any overlapping future rename scenarios (e.g., if payment/status events evolve from SPEC-044 alignment). | Warning | Add event lifecycle rules section in each phase: immutable IDs, additive payload fields only, dual-emit for deprecation. |

### Missing BC Section
A dedicated **"Migration & Backward Compatibility"** section is missing in all four target specs. This is required for contract-surface changes.

## Spec Completeness

### Missing Sections
| Section | Impact | Recommendation |
|---------|--------|---------------|
| Migration & Backward Compatibility (all specs) | High risk of breaking external modules and tenant data during rollout | Add explicit bridges per surface (types, routes, events, schema, ACL IDs, generated files). |
| Final Compliance Report (045a/045b/045c) | No explicit AGENTS/backward contract check traceability per phase | Add phase-level compliance matrix (not only parent spec-level summary). |
| Changelog (045a/045b/045c) | Hard to track post-review contract changes over iterations | Add changelog blocks to each phase spec. |
| Risks & Impact Review (045c) | Shipping/payment alignment has external API and financial risk with no documented mitigations | Add risk matrix for auth failures, duplicate charges, webhook replay, and shipment-state drift. |
| API contracts detail (045c) | Endpoint names exist, but request/response/error contracts are underspecified | Add schemas, auth requirements, failure codes, and idempotency behavior. |
| Integration test matrix (045c) | "Add tests" is too broad for high-risk payment/shipping behavior | Add concrete API + UI scenarios with setup/teardown and tenant-isolation checks. |

### Incomplete Sections
| Section | Gap | Recommendation |
|---------|-----|---------------|
| SPEC-045a implementation plan | Strong list, but no explicit bridge sequencing for current `@open-mercato/shared/modules/integrations/types` consumers | Add Phase 0 compatibility bridge before introducing stricter integration metadata. |
| SPEC-045b architecture | Very detailed, but ownership conflict of external ID mapping vs existing `integrations` module not resolved | Add explicit module ownership decision and reference model. |
| SPEC-045c payment alignment | References SPEC-044 summary but lacks concrete migration/backfill protocol | Add legacy-read/write window, data migration script, rollback strategy. |

## AGENTS.md Compliance

### Violations
| Rule | Location | Fix |
|------|----------|-----|
| Spec must include integration coverage for affected API + key UI paths | SPEC-045c (only high-level step list) | Add route-level and UI-path test cases for payment + shipping flows. |
| Write operations should be command-pattern based | SPEC-045b/045c APIs that create/cancel/retry runs/shipments are not mapped to commands | Add command design for state-changing operations or explicitly justify exceptions. |
| setup.ts must mirror features from acl.ts via defaultRoleFeatures | 045c references `acl.ts` but does not enumerate feature IDs/default roles | Define ACL features and setup defaults for `shipping_carriers` and provider modules. |
| API routes must export openApi | 045c route list lacks openApi contract expectations | Add explicit requirement that each route exports `openApi` + auth metadata. |

## Risk Assessment

### High Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Breaking existing integration registry consumers by tightening `IntegrationDefinition` | Compile/runtime failures in current modules and examples | Add non-breaking type evolution plan (optional fields + runtime validator profiles). |
| Payment credential migration without dual-read bridge | Payment failures and transaction drop after rollout | Implement dual-read/write bridge + backfill + rollback toggles. |
| Duplicate/fragmented external ID mapping ownership | Data inconsistency and parallel logic in integrations vs data_sync | Keep one canonical entity/service and share via DI. |
| Generator contract drift when adding `integration.ts` discovery | Bootstrap/runtime generation regressions | Add generator tests for single integration + bundle exports and snapshot generated outputs. |

### Medium Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Missing module enablement plan (`integrations`, `data_sync`, `shipping_carriers`, providers) | Features built but inactive in app | Add explicit enablement checklist in implementation phase and QA plan. |
| Scheduler/progress integration complexity in 045b | Orphaned jobs or stale progress states | Define cancellation and retry invariants + integration tests around worker restarts. |
| Webhook endpoint contract ambiguity in 045c | Replay/signature verification bugs | Specify idempotency key strategy and signature validation API contract per provider. |

### Low Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Section numbering/order inconsistencies in 045a | Reviewer confusion | Normalize section order before implementation kickoff. |
| Incomplete i18n planning in 045c | Minor UX inconsistencies | Add i18n key plan for all new backend pages/widgets. |

## Gap Analysis

### Critical Gaps (Block Implementation)
- `IntegrationDefinition` compatibility plan missing: current shared type is already used with minimal payload; spec must define additive migration.
- Payment credential migration protocol missing: no dual-read/write, no backfill/rollback.
- External ID mapping ownership conflict unresolved between existing `integrations` code and proposed `data_sync` model.
- SPEC-045c lacks concrete API contract + test matrix for payment/shipping safety-critical flows.

### Important Gaps (Should Address)
- Phase-level BC section absent in 045a/045b/045c.
- Command-pattern mapping for state-changing endpoints not documented.
- ACL + `defaultRoleFeatures` definitions incomplete in 045c.
- Generated file contract and scanner expectations not codified in spec text.

### Nice-to-Have Gaps
- Unified naming/glossary for "provider", "integration", "bundle integration" across all phase specs.
- Explicit performance budgets/SLOs for sync throughput and webhook latency.

## Repository Readiness (Current Code vs Spec Scope)
Current workspace has only a partial foundation:

- Present:
  - `integrations` module exists but only includes ACL/setup + external-id enrichment/widget.
  - Shared registry/type file exists at `packages/shared/src/modules/integrations/types.ts` (minimal shape).
- Missing relative to 045a/045b/045c:
  - `integrations`: no `api/`, `di.ts`, `events.ts`, credentials/state/log entities, workers, admin pages.
  - No `data_sync` module.
  - No `shipping_carriers` module.
  - No provider modules (`gateway_stripe`, `gateway_payu`, `gateway_przelewy24`, `carrier_inpost`, `sync_medusa`) in `packages/core/src/modules/`.
  - CLI scanner currently does not include `integration.ts` convention discovery.
  - Target modules are not enabled in `apps/mercato/src/modules.ts`.

## Remediation Plan

### Before Implementation (Must Do)
1. Add a shared "Migration & Backward Compatibility" section to 045/045a/045b/045c with explicit bridges.
2. Freeze `IntegrationDefinition` evolution strategy (optional additive fields only in existing type).
3. Decide and document canonical ownership of `sync_external_id_mappings`.
4. Expand SPEC-045c with full API schemas, auth, error handling, and integration test matrix.

### During Implementation (Add to Spec)
1. Implement payment credential dual-read/write bridge and data backfill migration script.
2. Add generator contract tests for `integration.ts` single + bundle discovery.
3. Document command-pattern usage for all write routes in `integrations`, `data_sync`, and `shipping_carriers`.
4. Add per-phase compliance report/changelog updates.

### Post-Implementation (Follow Up)
1. Remove compatibility bridge paths only after one minor release and release-note deprecation window.
2. Add regression integration tests for tenant isolation and cross-module injection compatibility.
3. Audit create-app template parity if bootstrap/generated wiring changes.

## Recommendation
**Needs spec updates first** before implementation starts. After the blockers above are addressed, implementation can proceed in phased order (045a → 045b → 045c) with controlled compatibility bridges.
