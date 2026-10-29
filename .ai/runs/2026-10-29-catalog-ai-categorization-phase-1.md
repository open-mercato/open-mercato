# Execution plan — catalog AI product categorization, spec Phase 1

**Source doc:** `.ai/specs/2026-10-28-catalog-ai-product-categorization.md`
**Spec PR:** adeptofvoltron/open-mercato#17 (design only). This plan's PR is the separate **implementation PR**, so the spec-only guard of `om-auto-continue-pr` does not apply to it.
**Branch:** `feat/catalog-ai-categorization-phase-1` · stacked on `spec/catalog-ai-categorization`
**Prepared:** 2026-10-29, against upstream `main` at `9d41ec411` (#7553 merged).

## Goal

Ship spec Phase 1 (MVP): the tenant setting with the platform and tenant gates, an AI category suggestion for one product from its page, and undoable accept / reject.

## Scope

Spec § Implementation Plan → Phase 1, steps 1–11. Read the spec's Decisions D1–D11, Tree walk, Data Model, API Contracts, UI/UX and Edge Cases before Step 1.1; they are the source of truth, and this plan only orders them and records what was verified.

## Non-goals

- Spec Phases 2–4: queue worker, bulk route and bulk actions, review page, `auto_apply`, the on-create subscriber, the `apps/docs` page.
- Any change in `packages/ai-assistant` or `packages/shared` (spec D8).
- Any edit to `.github/workflows/*` (pipeline change → maintainer approval; see Step 4.2).
- `applyMode`, `autoApplyThreshold` and `autoSuggestOnCreate` get no behavior. They exist only in the settings schema (spec: full schema ships in Phase 1).

## Verified facts (2026-10-29)

| Fact | Where |
|---|---|
| `decisionModelService` is registered by `ai-assistant` DI | `packages/ai-assistant/src/modules/ai_assistant/di.ts` |
| Service API: `getAvailability({ moduleId })` → `{ available, provider?, model?, reason? }`; `decide({ request, moduleId?, timeoutMs?, signal? })` → `{ ok: true, result } \| { ok: false, error: { code, message, httpStatus? } }`; never throws | `ai_assistant/lib/decision-model-service.ts` |
| Unavailable reasons: `not_configured`, `unknown_provider`, `credentials_missing`, `model_missing`, `fixture_disabled` | `ai_assistant/lib/decision-model-registry.ts` |
| Request limits: 1–8 questions, 2–64 options, key `^[A-Za-z0-9_-]{1,64}$`, `criteria` ≤ 500, `instructions` ≤ 4000 | `ai_assistant/lib/decision-model-schemas.ts` |
| Per-module model env `OM_DECISION_CATALOG_MODEL` (`decisionModuleModelEnvKey('catalog')`) | `decision-model-registry.ts` |
| Shared types only: `DecisionRequest`, `DecisionQuestion`, `DecisionResult`, `DecisionAnswer`, `DecisionErrorCode`. The service types are **not** in `shared` → catalog declares its own structural type | `packages/shared/src/lib/ai/decision-model.ts` |
| Fixture adapter: first option (in order) whose key is a whole word in `JSON.stringify(state)` gets p = 1; no match → first option, p = 1/n | `ai_assistant/lib/decision-adapters/fixture.ts` |
| `tryResolve` pattern | `packages/core/src/modules/inbox_ops/subscribers/extractionWorker.ts` (`function tryResolve`) |
| Settings pattern: `moduleConfigService` + `validateCrudMutationGuard` | `catalog/api/settings/route.ts`, `catalog/lib/settings.ts` |
| Settings page sections: `PriceKindSettings`, `UnitPriceDisplaySettings`, `OmnibusSettings` | `catalog/backend/config/catalog/page.tsx` |
| `syncCategoryAssignments` filters by org/tenant, not `deletedAt` / `isActive` | `catalog/commands/products.ts` (`async function syncCategoryAssignments`) |
| Category tree helper `computeHierarchyForCategories` | `catalog/lib/categoryHierarchy.ts` |
| Product page section | `catalog/components/products/ProductCategorizeSection.tsx` (+ existing test) |
| Admin role gets `catalog.*` | `catalog/setup.ts` |
| Catalog locales: `en`, `de`, `es`, `ko`, `pl` | `catalog/i18n/` |
| Last catalog integration id: `TC-CAT-042` | `catalog/__integration__/` |
| `enforceCommandOptimisticLock` is not used in catalog yet | reference: `packages/shared/src/lib/crud/optimistic-lock-command.ts` + root `AGENTS.md` Task Router row on optimistic locking |

## Run rules

- Read root `AGENTS.md`, `packages/core/AGENTS.md`, `packages/core/src/modules/catalog/AGENTS.md`, `packages/ui/AGENTS.md`, `BACKWARD_COMPATIBILITY.md` first. Every new contract surface (table, ACL feature, events, command ids, routes) is additive.
- Validation runner: choose Docker vs local once, per root `AGENTS.md` § Validation Commands, and record it in the PR.
- Migrations: `yarn db:generate`, keep only the catalog migration for the new table plus the updated `.snapshot-open-mercato.json`. Never run `yarn db:migrate` against the developer database without asking. Integration tests use the ephemeral environment.
- Run `yarn generate` after adding auto-discovered files (routes, `acl.ts`, `events.ts`, entities, widgets).
- Never import from `@open-mercato/ai-assistant` inside `packages/core`. `packages/core/src/__tests__/module-decoupling.test.ts` must stay green.
- All user-facing strings go through i18n in all five catalog locales. Only DS tokens; no hardcoded status colors.
- The PR description keeps a **Security impact** section: a new ACL feature, and product data sent to the decision-model provider once a tenant enables the feature.

## Implementation Plan

### Phase 1: Settings and availability gate

**1.1 Settings contract and helper** (spec step 1). `aiCategorizationSettingsSchema` in `catalog/data/validators.ts` (exact shape from spec § Data Model), `AI_CATEGORIZATION_CONFIG_NAME = 'ai_categorization'`, read/write helper `catalog/lib/aiCategorizationSettings.ts` modeled on `lib/settings.ts`. Missing or invalid row → defaults (off). Unit tests.

**1.2 Port type and categorization service status** (spec step 2). `catalog/lib/aiCategorization/decisionModelPort.ts`: a structural `CatalogDecisionModelPort` type (`getAvailability`, `decide`) built from the shared types, with `reason` / `code` as open strings. `catalogCategorizationService` registered in `catalog/di.ts`, with `getStatus(scope)` → `{ available, reason?, enabled, effective, settings }`. Resolve `decisionModelService` with a local `tryResolve`. Missing → `reason: 'not_installed'`. Always pass `moduleId: 'catalog'`. Unit tests: not installed, each port reason, enabled-but-unavailable → `effective: false`.

**1.3 Settings API and settings UI** (spec step 3). `GET/PUT /api/catalog/ai-categorization/settings` with OpenAPI, the ACL features from spec § API Contracts, the 422 `decision_model_unavailable` rule (disabling always allowed), and `validateCrudMutationGuard` as in `api/settings/route.ts`. `components/AiCategorizationSettings.tsx` as the fourth section on `backend/config/catalog/page.tsx`: an info `Alert` with a reason-specific hint (the six known reasons + a generic fallback), a switch that is disabled (not hidden) when unavailable, and the D6/D9 field disclosure with the Akeneo re-sync caveat. Route unit tests, including PUT `enabled: true` with a stub service returning `available: false` → 422.

### Phase 2: Suggestion engine and persistence

**2.1 Product state builder** (spec step 4). `buildProductState(product)`: D6 fields, D9 exclusions (`configJson.encrypted` custom fields, `EncryptionMap` columns for `catalog:catalog_product`), products loaded with `findWithDecryption`, trimming (description 4 000, custom field value 500, max 50 fields). Unit tests.

**2.2 Tree walk with batched tournament** (spec step 5). Implement spec § Tree walk exactly: org-scoped live and active categories, sorting by name (`localeCompare`, `en`) then id, sentinel last, 0.35 stop, joint confidence, `MAX_DEPTH = 6`, near-equal chunks of ≤ 63 without a sentinel, plus a final question with the sentinel; `level_too_wide` above 504. Inline budget: one 15 s `AbortSignal`, each call `timeoutMs = min(5000, remaining)`. Fixed English instructions and `CATEGORIZATION_PROMPT_VERSION`. Map every port error code to `{ outcome: 'error', code }` (`aborted` from the budget → `timeout`, unknown codes kept). Unit tests with a stub port: deep path, early stop, root `no_match`, 127 children (43/42/42 + final), > 504, the final picking the sentinel, every error code, no categories → `no_match` without a call.

**2.3 Suggestion entity, migration and persistence** (spec step 6). `CatalogProductCategorySuggestion` / `catalog_product_category_suggestions` with the columns and indexes from spec § Data Model, including the partial unique `(product_id) WHERE status = 'pending'` and `updated_at`. Persistence: in one transaction, `SELECT … FOR UPDATE` on the product, supersede the old pending row, insert the new one. A unique violation maps to 409 `suggestion_in_progress`. A port error writes nothing. Migration via `yarn db:generate` (keep only this migration). Unit tests for supersede rules.

### Phase 3: Accept / reject

**3.1 Extract the category assignment helper** (spec step 7). Move the assignment-writing core of `syncCategoryAssignments` into an exported helper with identical behavior and position semantics. Existing product command tests must stay green unchanged.

**3.2 Accept / reject commands, events and ACL** (spec step 8). Commands `catalog.category_suggestions.accept` / `.reject` per spec § Commands: liveness + org check (422 `category_unavailable`), D5 merge with `makeMain`, `emitCrudSideEffects` for the product update, category-only undo, the superseded-on-undo rule, `enforceCommandOptimisticLock` on the suggestion's `updatedAt`. Events `catalog.category_suggestion.created|accepted|rejected` (`clientBroadcast: true`, payload without product text). ACL `catalog.ai_categorization.use` (`dependsOn: ['catalog.products.view']`, not granted to `employee`). Unit tests: empty product → only category; existing → appended last; `makeMain` → first; undo restores exactly `before.categoryIds` and no other product field.

**3.3 API routes** (spec step 9). `POST /api/catalog/products/{id}/category-suggestion` (inline, 15 s), `GET /api/catalog/category-suggestions` (`makeCrudRoute` list, read-only; filters `status`, `productId`, `ids`, `minConfidence`; `pageSize ≤ 100`; returns `updatedAt` and `categoryLive`; hides suggestions of soft-deleted products), `POST …/{id}/accept`, `POST …/{id}/reject`. Every route except settings GET returns 409 `ai_categorization_unavailable` when `effective` is false. Zod in `data/validators.ts`, OpenAPI on all routes. Route unit tests for gates and status codes.

### Phase 4: Product page and verification

**4.1 Product page suggestion card** (spec step 10). In `ProductCategorizeSection`, rendered only when `effective` and the user has `catalog.ai_categorization.use`. "Suggest category" with `Spinner`; pending card (path breadcrumb, confidence %, up to 3 alternatives; Accept + "Make it the main category" only when the product has categories; Use parent instead; Reject). Writes through `useGuardedMutation` + `buildOptimisticLockHeader(suggestion.updatedAt)`; conflicts via `surfaceRecordConflict`. After accept, set both form `categoryIds` and `updatedAt` from the response. Accept is disabled while the categories field is dirty. `categoryLive: false` → Reject only; `no_match` → neutral message; port errors → `flash` with i18n keys. Confidence badge with DS status tokens. Extend `__tests__/ProductCategorizeSection.test.tsx`. Run `om-ds-guardian` on touched UI files.

**4.2 Integration tests** (spec step 11). Folder `catalog/__integration__/ai-categorization/` with `meta.ts` declaring `requiredEnvVars: ['OM_DECISION_PROVIDER', 'OM_DECISION_MODEL', 'OM_DECISION_FIXTURE_ENABLED']`. Each test skips unless `OM_DECISION_PROVIDER === 'fixture'`. Ids from `TC-CAT-043`, one `.spec.ts` per case, API fixtures with cleanup in `finally`, no reliance on demo data. Cases are listed in spec step 11. Run locally with `OM_DECISION_PROVIDER=fixture OM_DECISION_MODEL=fixture OM_DECISION_FIXTURE_ENABLED=1` and confirm that the ephemeral app process receives these variables. In the PR description, propose adding them to the `ci.yml` integration job for maintainer approval; do not edit `ci.yml`.

**4.3 Spec sync and full gate.** Add a spec changelog entry "Phase 1 implemented" with a short summary of anything that diverged. Run `yarn i18n:check-sync`, `yarn i18n:check-usage`, then every command of `validation.commands` in `.ai/agentic.config.json`, in order.

## Risks

- Product data leaves the system once a tenant enables the feature. Mitigated by default off, the two gates, D9 exclusions and the settings disclosure (spec § Risks).
- The port is `@experimental` (`/alpha/` endpoint). Keep default branches on reasons, error codes and answer types.
- Extracting the category helper touches product writes. It must be a pure extraction, covered by existing tests.
- The integration tests are skipped in CI until maintainers add the fixture env to the integration job.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Settings and availability gate

- [ ] 1.1 Settings contract and helper
- [ ] 1.2 Port type and categorization service status
- [ ] 1.3 Settings API and settings UI

### Phase 2: Suggestion engine and persistence

- [ ] 2.1 Product state builder
- [ ] 2.2 Tree walk with batched tournament
- [ ] 2.3 Suggestion entity, migration and persistence

### Phase 3: Accept / reject

- [ ] 3.1 Extract the category assignment helper
- [ ] 3.2 Accept / reject commands, events and ACL
- [ ] 3.3 API routes

### Phase 4: Product page and verification

- [ ] 4.1 Product page suggestion card
- [ ] 4.2 Integration tests
- [ ] 4.3 Spec sync and full gate
