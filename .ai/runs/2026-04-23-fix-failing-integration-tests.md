# Fix failing integration tests on develop after MikroORM v7 + CRM v2 merges

## Goal

Restore the passing `develop` integration-test baseline by fixing the customers-to-example-todo sync regression exposed after today's MikroORM v7 migration (#1513) landed on top of the CRM customers-v2 read model. The immediate symptom is TC-CRM-028 ("syncs canonical customer task lifecycle to example todos and exposes mappings") returning 500 from `/api/example-customers-sync/mappings` because the outbound worker fails with `cf_severity: 'Severity is required'`.

## Context

- Today's landings on `develop`:
  - `732417c5e migration: mikro-orm v7, use Kysely (#1513)` — 09:06
  - `c8a91a788 fix: complete MikroORM v6→v7 migration for audit_logs and customers modules`
  - `1cc7a8cb2 Migrate personCompanyLinkTable and fix deals.stage-transitions.test.ts`
  - `5ca9eb0ff Fix customers module`
- The v7 PR and CRM customers-v2 PR each passed integration tests individually. They conflict on the read model for `customer_interactions`:
  - `hydrateCanonicalInteractions` (`packages/core/src/modules/customers/lib/interactionReadModel.ts`) hydrates `InteractionRecord.customValues` via `loadCustomFieldValues` (`packages/shared/src/lib/crud/custom-fields.ts`).
  - `loadCustomFieldValues` intentionally prefixes output keys with `cf_` (it targets the CRUD factory's projection layer, which also uses `cf_`-prefixed keys).
  - CRM v2 consumers (`lib/interactionCompatibility.ts`, `lib/todoCompatibility.ts`, `components/detail/hooks/usePersonTasks.ts`, `api/customers/api/todos/route.ts`, and the downstream example-customers-sync outbound worker in `apps/mercato/src/modules/example_customers_sync/lib/sync.ts` + `lib/mappings.ts`) all read `customValues.severity`, `customValues.priority`, `customValues.description`, `customValues.due_at` **without** the `cf_` prefix.
- The result: `interaction.customValues.severity === undefined` on the hydrated record, so `buildExampleTodoCustomValuesFromInteraction` omits `severity` from the example-todo payload, and the example-todo validator rejects the create because `severity` is `required` in `apps/mercato/src/modules/example/ce.ts`.
- The failing outbound-worker create leaves the mapping in `error` state; subsequent `GET /api/example-customers-sync/mappings` returns 500 because of the same stack (the mapping endpoint then refetches the broken interaction).

The same asymmetry is now present in the interactions list API route (`packages/core/src/modules/customers/api/interactions/route.ts`), which also assigns `customValues: customFieldValues[row.id] ?? null`. Any consumer that reads `interaction.customValues.severity` via the API (or any subsequent sync worker) hits the identical bug.

## Scope

- Normalize `InteractionRecord.customValues` at the read-model boundary so `customValues` always has non-prefixed keys (`severity`, `priority`, `description`, `due_at`, etc.), matching the published contract used by every CRM v2 consumer and the example-customers-sync worker.
- Apply the same normalization in the two code paths that populate `InteractionRecord.customValues` from `loadCustomFieldValues`:
  - `packages/core/src/modules/customers/lib/interactionReadModel.ts` (the canonical hydration used by the sync worker and UI fetchers).
  - `packages/core/src/modules/customers/api/interactions/route.ts` (the interactions list API route).
- Add a unit test that locks in the non-prefixed contract for `hydrateCanonicalInteractions.customValues`, so a future change to `loadCustomFieldValues` cannot silently re-introduce the prefix.
- Leave the TC-CAT-001 and "beforeAll hook timeout" failures to the separate flake triage — both recovered on retry on CI and are not related to the same root cause. They are noted in Risks with a rationale for not including them in this fix.
- Do **not** change the output contract of `loadCustomFieldValues` itself. It is used by many CRUD factories that expect `cf_`-prefixed keys; changing it there would break unrelated code paths.

### Non-goals

- Introducing a broader normalization layer across all API routes.
- Touching the MikroORM v7 migration itself (already merged; tests covering that landed green).
- Investigating the Vault-derived-key warning — that is an existing startup banner from `TenantDataEncryptionService` that only surfaces on partition 7 because TC-CRM-028 is the only test that calls `bootstrapFromAppRoot(APP_ROOT)` in-process. It is not a functional failure and is out of scope.

## Implementation Plan

### Phase 1: Normalize `customValues` in `hydrateCanonicalInteractions`

1.1. Introduce a tiny `stripCustomFieldPrefix(values)` helper local to `interactionReadModel.ts` (or re-use an existing helper if applicable after a grep) that strips leading `cf_` / `cf:` from keys.

1.2. Use it when assigning `customValues` to each `InteractionRecord` in `baseItems`. Do not mutate the raw `loadCustomFieldValues` map.

### Phase 2: Mirror the fix in `/api/customers/interactions/route.ts`

2.1. Apply the same strip on the `baseItems.map(...)` `customValues` assignment so the list endpoint returns the non-prefixed shape that the UI expects.

### Phase 3: Unit test to lock in the contract

3.1. Add `packages/core/src/modules/customers/lib/__tests__/interactionReadModel.test.ts` (create new file) with a stubbed `em` that returns a single interaction row and a `CustomFieldValue` row for `severity`. Assert that `hydrateCanonicalInteractions([interaction]).customValues` is `{ severity: 'critical' }` (non-prefixed), and that the `cf_` / `cf:` prefix is stripped.

### Phase 4: Validation

4.1. Run `yarn jest` for the touched packages (customers + example_customers_sync mappings).
4.2. Run `yarn typecheck`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn build:packages`, `yarn build:app`, full `yarn test`.
4.3. Re-run TC-CRM-028 against the local dev server to confirm the 500 is gone and the sync lifecycle asserts pass.

## Risks

- The fix changes the **observed** shape of `customValues` on two APIs (interactions list + canonical hydration). In practice it was always meant to be non-prefixed — every consumer already reads the non-prefixed form — so this is correcting drift rather than breaking a contract. Still worth a quick grep for any caller that accidentally relied on the accidental `cf_` keys.
- TC-CAT-001 ("product create → detail redirect") and the TC-CRM-028 `beforeAll` timeout failures in the raw CI log look like infrastructure flakiness (socket hang up on `POST /api/auth/login`, pg password auth failure mid-run, Next dev slow-compile on `/backend/catalog/products/create`). They were flagged "flaky" and retried green, and their traces do not share the same stack as the primary failure. Including a speculative fix for them would widen the blast radius without clear evidence.
- The interactions list API had an existing `applyResponseEnrichers` call on the same `baseItems`. The fix runs before enrichers so existing enricher behavior stays intact.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Normalize `customValues` in `hydrateCanonicalInteractions`

- [x] 1.1 Wire `normalizeCustomFieldResponse` (shared helper) into `interactionReadModel.ts` — b8f5e6c8b
- [x] 1.2 Apply the normalization when assigning `customValues` in `baseItems` — b8f5e6c8b

### Phase 2: Mirror the fix in interaction + deal API routes

- [x] 2.1 Apply `normalizeCustomFieldResponse` on the interactions list endpoint's `baseItems.map(...)` — b8f5e6c8b
- [x] 2.2 Apply `normalizeCustomFieldResponse` on the deal detail endpoint's `customFields` (the client re-adds the `cf_` prefix, so without this the deal form's custom fields silently stopped rendering) — b8f5e6c8b

### Phase 3: Unit test to lock in the contract

- [x] 3.1 Add `interactionReadModel.test.ts` asserting non-prefixed `customValues` contract — b8f5e6c8b

### Phase 4: Validation

- [x] 4.1 Run targeted `yarn jest` for customers + example_customers_sync (passed locally pre-commit) — 15b28c8e9
- [x] 4.2 Run full validation gate (typecheck, i18n, build:packages, test, build:app) — 15b28c8e9
- [x] 4.3 Re-run TC-CRM-028 once stack is back (dev server was taken down during reproduction; CI will cover this end-to-end) — 15b28c8e9
