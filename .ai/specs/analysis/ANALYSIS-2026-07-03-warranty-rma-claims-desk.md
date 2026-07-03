# Pre-Implementation Analysis: Warranty & RMA Claims Desk (`warranty_claims`)

Spec: `.ai/specs/2026-07-03-warranty-rma-claims-desk.md`
Analysis date: 2026-07-03
Analyst: om-pre-implement-spec skill run

## Executive Summary

The spec is a purely additive new core module built almost entirely from verified, existing platform mechanisms — every load-bearing primitive it names (CRUD factory, command optimistic lock, dictionary seeding, tab injection spot, portal page metadata, attachments convention, typed events with portal broadcast, notifications, AI tools, number-generator precedent, search/ce/setup/migrations conventions, per-module `__integration__` tests) exists in the repo with the claimed shape. No backward-compatibility violations were found. Verdict: **READY-WITH-AMENDMENTS** — six spec amendments are recommended (three Medium, three Low); none are architectural, all are precision fixes so implementation doesn't guess.

## Backward Compatibility

### Audit Against the 13 Contract Surfaces

| # | Surface | Finding | Severity |
|---|---------|---------|----------|
| 1 | Auto-discovery files | Only NEW convention files in a NEW module dir (`index.ts`, `di.ts`, `acl.ts`, `setup.ts`, `events.ts`, `search.ts`, `ce.ts`, `notifications.ts`, `ai-tools.ts`, `api/`, `backend/`, `frontend/`, `widgets/`, `migrations/`). Nothing renamed/removed. | None |
| 2 | Types & interfaces | No public type modified. Consumes existing types (`PageMetadata.requireCustomerAuth`, `ModuleInjectionTable`, `NotificationTypeDefinition`, `SearchModuleConfig`). | None |
| 3 | Function signatures | No existing signature changed. | None |
| 4 | Import paths | No moves. New cross-module imports are consumer-side only (dictionaries components, customer_accounts auth lib — see Gap 2). | None |
| 5 | Event IDs | All new (`warranty_claims.claim.*`), correct `module.entity.action` convention (singular entity, past-tense action). New FROZEN surfaces from day one — correctly declared in spec Migration & Compatibility. | None |
| 6 | Widget spot IDs | Consumes existing spot `sales.document.detail.order:tabs` (verified live at `packages/core/src/modules/sales/backend/sales/documents/[id]/page.tsx:3992`, template `sales.document.detail.${kind}:tabs`). Consumer-only; no spot contract change. | None |
| 7 | API routes | All new under `/api/warranty_claims/**`. No existing route touched. | None |
| 8 | DB schema | 4 new tables, no changes to sales/catalog/customers schemas. Additive migration + snapshot. | None |
| 9 | DI service names | New registrations only (`di.ts`). | None |
| 10 | ACL feature IDs | New ids `warranty_claims.{view,create,manage,delete,settings}` + `setup.ts` `defaultRoleFeatures`. | None |
| 11 | Notification type IDs | New ids only. | None |
| 12 | CLI commands | None touched. | None |
| 13 | Generated files | Standard `yarn generate` additions; no generated-export contract change. | None |

### Migration & Backward Compatibility Section

Present (spec Migration & Compatibility) and accurate: additive-only, new FROZEN surfaces enumerated, no deprecations. **No BC violations.**

## Verified Mechanisms (paths + symbols)

| # | Spec claim | Verified reality |
|---|-----------|------------------|
| a | `makeCrudRoute` with `list.entityId` / `indexer.entityType` | `packages/shared/src/lib/crud/factory.ts:934` `export function makeCrudRoute`. Real usage with exactly the claimed shape: `packages/core/src/modules/customers/api/people/route.ts:77` — `makeCrudRoute({ …, indexer: { entityType: E.customers.customer_entity }, list: { entityId: E.customers.customer_entity, … } })`. Bare `api/route.ts` (→ `/api/warranty_claims`) precedent: `packages/core/src/modules/{attachments,dictionaries,integrations,messages,notifications}/api/route.ts`. Flat sub-resource `api/lines/route.ts` (→ `/api/warranty_claims/lines`) precedent: `packages/core/src/modules/customers/api/addresses/route.ts` and `api/comments/route.ts` (both `makeCrudRoute`). |
| b | `enforceCommandOptimisticLock` | `packages/shared/src/lib/crud/optimistic-lock-command.ts:166` `export function enforceCommandOptimisticLock`. Sales wrapper usage: `packages/core/src/modules/sales/commands/shared.ts`. DI seam `createCommandOptimisticLockGuardService` in the same file family (per root AGENTS.md). |
| c | Dictionary seeding + components | `packages/core/src/modules/sales/lib/dictionaries.ts:265` `export async function seedSalesStatusDictionaries(em: EntityManager, scope: SeedScope)` seeding per-kind via `seedSalesDictionary(em, scope, 'order-status', …)`. Components: `packages/core/src/modules/dictionaries/components/DictionaryForm.tsx`, `…/DictionaryTable.tsx`; cross-module consumption precedent: `packages/core/src/modules/sales/components/StatusSettings.tsx:19-25` imports both via `@open-mercato/core/modules/dictionaries/components/*` (also `customers/components/DictionarySettings.tsx`). |
| d | Tab injection spot | Spot consumed at `packages/core/src/modules/sales/backend/sales/documents/[id]/page.tsx:3992-3993` via `useInjectionWidgets` from `@open-mercato/ui/backend/injection/InjectionSpot`; widgets with `placement.kind === 'tab'` become tabs (uses `groupId`, `groupLabel` (i18n key), `priority`). Existing tab widget registration: `packages/core/src/modules/sales/widgets/injection-table.ts` → `'sales.document.detail.order:tabs': [{ widgetId: 'sales.injection.document-history', kind: 'tab', groupLabel: 'sales.documents.history.tabLabel', priority: 50 }]`, widget dir `sales/widgets/injection/document-history/`. Cross-module registration precedent: `packages/core/src/modules/workflows/widgets/injection-table.ts` registers into `'sales.document.detail.order:details'`. |
| e | Portal page + portal API auth | Page metadata: `packages/core/src/modules/portal/frontend/[orgSlug]/portal/dashboard/page.meta.ts` — `metadata: PageMetadata = { requireCustomerAuth: true, titleKey, nav: { labelKey, group: 'main', order } }`; flag defined at `packages/shared/src/modules/registry.ts:42`. Portal API guard pattern: `packages/core/src/modules/customer_accounts/api/portal/profile.ts` — route `metadata = { requireAuth: false }`, then `getCustomerAuthFromRequest(req)` (from `packages/core/src/modules/customer_accounts/lib/customerAuth.ts:83`; also `requireCustomerAuth` at `:144`, `requireCustomerFeature` at `:152`) with manual 401/404. `packages/shared/src/modules/customer-auth.ts` holds the shared TYPES only (`CustomerAuthContext` etc.), no functions. |
| f | Attachments by `(entityId, recordId)` | `packages/core/src/modules/attachments/data/entities.ts:52` `class Attachment` — `entityId` (`entity_id` text), `recordId` (`record_id` text, indexed), `partitionCode`, `organizationId`/`tenantId`. Components `AttachmentLibrary.tsx`, `AttachmentContentPreview.tsx`; consumer example: `packages/core/src/modules/messages/components/message-detail/panels/attachments-panel.tsx` (`MessageDetailAttachmentsSection`). `'warranty_claims:claim'` matches the `module:entity` id format used by `ce.ts`. |
| g | `createModuleEvents` + broadcast flags | `packages/core/src/modules/customers/events.ts:87` `export const eventsConfig = createModuleEvents({…})` (import from `@open-mercato/shared/modules/events`). `portalBroadcast?: boolean` at `packages/shared/src/modules/events/types.ts:38` + `isPortalBroadcast` helper in `…/events/factory.ts:113`; real `portalBroadcast` usage: `packages/core/src/modules/customer_accounts/events.ts`; `clientBroadcast` usage: `packages/core/src/modules/communication_channels/events.ts`. Portal SSE bridge: `packages/core/src/modules/customer_accounts/api/portal/events/stream.ts`. |
| h | Notifications + subscribers | `packages/core/src/modules/customers/notifications.ts` — `export const notificationTypes: NotificationTypeDefinition[]` (ids like `customers.deal.won`, `titleKey`/`bodyKey`/`actions`/`linkHref`). Subscribers: `packages/core/src/modules/customers/subscribers/deal-closure-notification.ts` et al. |
| i | AI tools + `prepareMutation` | `packages/core/src/modules/customers/ai-tools.ts` aggregates packs from `customers/ai-tools/*-pack.ts` (generator walks every module's top-level `ai-tools.ts`). `prepareMutation` defined at `packages/ai-assistant/src/modules/ai_assistant/lib/prepare-mutation.ts:363`, exported from `packages/ai-assistant/src/index.ts:160`. **Caveat**: all in-tree customers/catalog module tool packs are read-only; `prepareMutation` call sites live in the ai_assistant runtime (`lib/tool-test-runner.ts:206`) — mutation tools are declared via `defineAiTool` and flow through the pending-action contract rather than calling `prepareMutation` inside module `ai-tools.ts` (see Gap 4). |
| j | Number generator precedent | `packages/core/src/modules/sales/services/salesDocumentNumberGenerator.ts` — `export class SalesDocumentNumberGenerator`, per-kind sequences backed by `SalesDocumentSequence` entity, scope `{organizationId, tenantId}`, locked-row increment. `WarrantyClaimSequence` mirrors this. Note: sales places it in `services/` (DI-registered), spec says `lib/claimNumber.ts` (see Gap 6). |
| k | `search.ts` | `packages/core/src/modules/customers/search.ts` — `SearchModuleConfig` / `SearchBuildContext` / presenters from `@open-mercato/shared/modules/search`, tenant assertion pattern. |
| l | `ce.ts` | `packages/core/src/modules/customers/ce.ts` — `export const entities = [{ id: 'customers:customer_person_profile', label, description, labelField, showInSidebar, fields }]`. `'warranty_claims:claim'` follows the format. |
| m | `setup.ts` role features | `packages/core/src/modules/customers/setup.ts:84` `defaultRoleFeatures: {…}`. |
| n | Migrations layout | `packages/core/src/modules/customers/migrations/Migration<timestamp>[_customers].ts` + committed `.snapshot-open-mercato.json` (a legacy `.snapshot-openmercato.json` also exists; the canonical name per AGENTS.md is `.snapshot-open-mercato.json`). |
| — | Per-module integration tests | `packages/core/src/modules/customers/__integration__/TC-*.spec.ts` — convention confirmed (also attachments, translations, customer_accounts, ai_assistant). Spec's "module `__integration__/`" plan is correct. |
| — | Portal frontend auto-discovery from ANY module | Generic: `SCAN_CONFIGS.frontendPages = { folder: 'frontend', … }` at `packages/cli/src/lib/generators/scanner.ts:130`, applied per-module in `packages/cli/src/lib/generators/module-registry.ts:2870` (and `:3503`), emitted into `frontend-routes.generated.ts`. So `warranty_claims/frontend/[orgSlug]/portal/claims/**` will be discovered. **However** today ONLY the `portal` module ships `frontend/[orgSlug]/portal/**` pages — warranty_claims would be the first outside it (see Gap 3). Portal shell exists centrally: `packages/ui/src/portal/PortalShell.tsx`, `PortalLayoutShell.tsx`. |
| — | Name collision check | No existing `warranty` module/route/entity (only incidental matches: `warranty`-named custom-field examples in `resources/lib/seeds.ts`, a catalog integration fixture). Module id `warranty_claims` is free. |

## Spec Completeness

All required sections present: TLDR, Overview, Problem Statement, Proposed Solution (+ Design Decisions + Alternatives), User Stories, Architecture, Data Models, API Contracts, i18n, UI/UX, Configuration, Migration & Compatibility, Implementation Plan (6 phases), Testing Strategy, Integration Test Coverage (TC-WC-001…007 + UI path), Risks & Impact Review (with risk register), Final Compliance Report, Changelog.

### Incomplete Sections
| Section | Gap | Recommendation |
|---------|-----|---------------|
| Configuration | "Tenant config (module config defaults)" names no concrete mechanism — sales precedent uses its own settings entity (`SalesSettings`) | Name the mechanism: either a `WarrantyClaimSettings` entity (mirroring `SalesSettings`) or explicitly hard-code defaults in v1 and defer the settings surface |
| API Contracts (portal) | "mirrors `customer_accounts/api/portal/*` guard pattern" is under-specified — the actual pattern is a cross-module lib import + `metadata = { requireAuth: false }` | See Amendment 2 |
| Phase 6 | Guard-test updates not listed | See Amendment 1 |

## AGENTS.md Compliance

No violations found; the spec's Final Compliance Report claims hold up against the verified code. Notes:

| Rule | Status | Note |
|------|--------|------|
| Optimistic locking default ON, guard tests enforce coverage | Compliant in design, **incomplete in plan** | The two guard tests use hard-coded audit maps that MUST be extended (Gap 1) |
| Cross-module coupling via sanctioned mechanisms | Compliant | FK-id + snapshot, widget injection, events; dictionaries-components import matches the existing sales→dictionaries precedent |
| Portal RBAC (`requireCustomerAuth` in page.meta) | Compliant | Verified flag exists and is framework-handled |
| DS rules / i18n / dialogs | Compliant | Spec pre-commits to tokens, `StatusBadge` mapping, `Cmd+Enter`/`Escape`, 4 locale files |
| Encryption maps | Compliant (N/A) rationale accepted | No PII columns; serials/fault text are product data; comment bodies match sales `notes` unencrypted precedent. Defensible — but confirm during review that portal-authored comment bodies stay non-PII in practice |

## Risk Assessment

### Medium Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Portal SSE cross-customer visibility: `stream.ts` filters by tenant + organization + *optional recipient audience* (`packages/core/src/modules/customer_accounts/api/portal/events/stream.ts:69-70,224`). A `portalBroadcast` claim event without a recipient audience is visible to ALL portal customers of the org | Cross-customer information leak (claim numbers/status of other customers) | Amendment 5: require claim `portalBroadcast` events to set the recipient/customer audience fields; add an integration assertion to TC-WC-005 |
| Guard tests not updated → false red CI or, worse, unaudited entities | `optimistic-lock-editable-entities.test.ts` uses hard-coded `moduleEntities` + `makeCrudRouteByEntity` maps | Amendment 1 |

### Low Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| First module with portal pages outside `portal` module | Unknown-unknowns in portal shell/nav pickup | Discovery verified generic; add a portal-page render check to the Phase 4 verification step |
| First cross-module consumer of `customer_accounts/lib/customerAuth` | Static import couples warranty_claims to customer_accounts | Acceptable for core modules (both always present); document in spec coupling table |
| Timeline table growth | Bounded per claim | Index `(claim_id, created_at)` already specified |

## Gap Analysis

### Critical Gaps (Block Implementation)
None.

### Important Gaps (Should Address — spec amendments)
1. **[Medium] Optimistic-lock guard tests must be extended.** `packages/core/src/__tests__/optimistic-lock-editable-entities.test.ts` hard-codes `moduleEntities` and `makeCrudRouteByEntity`. Add `warranty_claims: ['WarrantyClaim', 'WarrantyClaimLine']` and map them to `warranty_claims/api/route.ts` / `warranty_claims/api/lines/route.ts` (both entities carry `deleted_at`, so reader case (a) holds). `WarrantyClaimEvent`/`WarrantyClaimSequence` fall under the documented exclusions (append-only / sequence rows). Also budget for `optimistic-lock-ui-coverage.test.ts` (file-level guard) on any raw mutating UI calls (action-bar transitions). Add to Phase 6.
2. **[Medium] Portal API auth mechanism must be named precisely.** Concrete pattern: import `getCustomerAuthFromRequest` (and `requireCustomerFeature` if portal features are used) from `@open-mercato/core/modules/customer_accounts/lib/customerAuth`, export route `metadata = { requireAuth: false }`, return 401 manually — exactly as `customer_accounts/api/portal/profile.ts`. warranty_claims is the FIRST module outside customer_accounts to do this; state it in the coupling table.
3. **[Low] Portal-pages novelty.** Note in the spec that warranty_claims is the first non-`portal` module shipping `frontend/[orgSlug]/portal/**` pages; discovery is generic (`SCAN_CONFIGS.frontendPages`, folder `'frontend'`) and the shell lives in `packages/ui/src/portal/PortalShell.tsx`, but Phase 4 verification should include a portal nav + page render smoke.
4. **[Low] AI mutation tool wording.** No in-tree module `ai-tools.ts` calls `prepareMutation` directly; mutation tools are declared via `defineAiTool` and gated through the pending-action contract (runtime calls `prepareMutation` — `packages/ai-assistant/src/modules/ai_assistant/lib/prepare-mutation.ts:363`). Rephrase `transition_claim` as "declared via `defineAiTool` with the mutation/pending-action contract per `packages/ai-assistant/AGENTS.md`".
5. **[Medium] Portal event audience.** Specify that `warranty_claims.claim.status_changed` / `.comment_added` portal-broadcast payloads set the recipient audience so only the claim's customer sees them; extend TC-WC-005 with a second-customer SSE/visibility assertion.
6. **[Low] Naming alignment.** (a) Dictionary kinds: sales precedent uses kebab-case kinds (`'order-status'`) — use `warranty-claim-fault-codes` etc. or justify snake_case. (b) Number generator: sales hosts it as a DI-registered class in `services/`; either move `WarrantyClaimNumberGenerator` to `services/` + register in `di.ts`, or justify `lib/`.

### Nice-to-Have Gaps
- Consider naming the exact `E.warranty_claims.*` generated entity ids the routes will reference (auto-produced by `yarn generate`).
- Snapshot file name: use `.snapshot-open-mercato.json` (canonical); ignore the legacy `.snapshot-openmercato.json` variant seen in customers.

## Remediation Plan

### Before Implementation (Must Do)
1. Apply Amendments 1, 2, 5 to the spec (guard-test additions, exact portal auth imports, portal event audience + TC-WC-005 extension).

### During Implementation (Add to Spec as Built)
1. Amendments 3, 4, 6 (portal-page novelty note, AI tool wording, naming alignment).
2. Pin the Configuration mechanism (settings entity vs hard-coded v1 defaults).

### Post-Implementation (Follow Up)
1. Move spec to `.ai/specs/implemented/` with changelog once phases complete; keep FROZEN-surface list in sync with shipped ids.

## Recommendation

**READY-WITH-AMENDMENTS** — implementation may start once Amendments 1, 2, and 5 are folded into the spec; the remaining amendments can land during implementation. No BC violations; every claimed mechanism exists with the claimed shape.
