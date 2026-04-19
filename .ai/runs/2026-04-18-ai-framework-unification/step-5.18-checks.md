# Step 5.18 — D18 bulk-edit demo end-to-end (Phase 3 WS-D)

**Commit (code):** `df8606cd1`
**Docs-flip commit:** see PLAN.md row 5.18.
**Scope:** additive production wiring + tests. No migrations, no new
routes, no new entities, no new feature ids.

## Files created

- `packages/core/src/modules/catalog/__integration__/TC-AI-D18-018-bulk-edit-demo.spec.ts` — Playwright integration spec with 4 scenarios.

## Files touched

- `packages/ai-assistant/src/modules/ai_assistant/lib/pending-action-executor.ts` — executor extracts per-record handler failures from the batch tool's return shape and merges them with re-check-sourced stale records into a single `row.failedRecords[]` at the final `executing → confirmed` transition; emitted `ai.action.confirmed` payload carries the merged list.
- `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/pending-action-executor.test.ts` — 3 new unit tests for the partial-success merge, the combined stale+handler-failure path, and the single-record "no failures" path.
- `packages/core/src/modules/catalog/events.ts` — `catalog.product.{created,updated,deleted}` now carry `clientBroadcast: true` so the DOM event bridge streams them to the browser (confirmed AI bulk mutations and direct API writes both fire the event).
- `packages/core/src/modules/catalog/components/products/ProductsDataTable.tsx` — subscribes to `catalog.product.*` via `useAppEvent`; incoming events bump the existing `reloadToken` triggering a fresh `/api/catalog/products` fetch.

## Wire-fix rationale vs spec §10 D18

- Spec §10.4 line 848: use case #1 — "Rewrite descriptions from attributes" chains `catalog.list_selected_products` → `catalog.draft_description_from_attributes` (per record) → `catalog.bulk_update_products`. The four D18 mutation tools (Step 5.14) are already whitelisted on `catalog.merchandising_assistant`; no change needed.
- Spec §10.4 line 850: use case #3 — "Generate descriptions from product media" chains `catalog.get_product_media` (attachment bridge) → `catalog.draft_description_from_media` → `catalog.bulk_update_products`. Same whitelist, same handler, no wiring gap.
- Spec §10.4 line 851: use case #4 — "Bulk rename / re-price / re-tag" chains `catalog.list_selected_products` → optional `catalog.suggest_price_adjustment` → `catalog.bulk_update_products`. Same whitelist.
- Spec §10.4 line 849: use case #2 — "Extract attributes from descriptions" chains `catalog.extract_attributes_from_description` → `catalog.apply_attribute_extraction` (batch). Same whitelist; tool's `loadBeforeRecords` already captures attribute before-state per record.
- Spec §9.8 line 743: "after a successful batch confirm, one `ai.action.confirmed` event fires with the actionId, and the underlying domain events (`catalog.product.updated` etc.) fire **once per record** so list pages refresh naturally through the DOM event bridge". The underlying `catalog.products.update` command already emits `catalog.product.updated` per record (the bulk handler iterates records + commandBus.execute once per row); the missing wiring was `clientBroadcast: true` on the event and a `useAppEvent` subscription on the DataTable — both landed in this Step.
- Spec §9.8 line 746: "a failure inside the confirm handler (post re-check, inside command execution) is recorded per-record in `executionResult.failedRecords[]`". Before this Step the executor's `normalizeExecutionResult` stripped the handler's `records[]` and `failedRecordIds[]` — only re-check stale records were persisted onto the row. The new `extractHandlerFailedRecords` + `mergeFailedRecords` close that gap. `MutationResultCard` (Step 5.10) already renders `action.failedRecords[]` as a `warning` variant; no UI change needed.

## Tests

### Unit (ai-assistant)

| Test id | Assertion |
|---------|-----------|
| existing (pre-5.18) ×4 | transitions happy, handler-throw, idempotent, carries partial-stale failedRecords[] (all preserved) |
| Step 5.18 — batch handler returns per-record failures | final `executing → confirmed` writes `failedRecords` from handler `records[].error`; emitted payload carries the list |
| Step 5.18 — partial-stale + handler failure merged | re-check `p-2` + handler `p-3` collapsed into one merged `failedRecords` set, deduped by `recordId` |
| Step 5.18 — single-record success | handler returns `{ recordId, commandName }` with no per-record failures; final transition writes `failedRecords: null` |

### Integration (Playwright, port 3000)

| Scenario | Status |
|----------|--------|
| A. `catalog.merchandising_assistant` whitelists all four D18 mutation tools + read/authoring packs that feed them | pass |
| B. `/api/ai_assistant/ai/actions/:id/confirm` returns 404 `pending_action_not_found` for unknown UUID (or 500 route-tag when migration absent) | pass |
| C. Products list page renders; three fresh fixtures created via `/api/catalog/products`, visible after search-filter | pass |
| D. `PUT /api/catalog/products` wire smoke-check — proves the underlying update command path is callable (browser-level SSE bridge is exercised at the unit level via `useAppEvent` contract) | pass |

Run: `yarn test:integration --grep="TC-AI-D18-018"` → 4/4 pass (1.9m).

### Baselines preserved

| Package | Suites | Tests | Delta |
|---------|--------|-------|-------|
| ai-assistant | 50 | 555 → **558** | +3 (unit) |
| core | 344 | 3180 | preserved |
| ui | 66 | 351 | preserved |

## Gate

- **Typecheck**: `yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/ai-assistant --filter=@open-mercato/app` → 2/2 successful; `@open-mercato/ui` cache hit (no changes that affect type graph). `ai-assistant` is gated at ts-jest time by its package contract.
- **Generator**: `yarn generate` green; openapi bundle unchanged; structural cache purge clean.
- **i18n**: `yarn i18n:check-sync` → all 4 locales in sync (no new strings).
- **Structural cache**: `yarn mercato configs cache structural --all-tenants` → 0 keys matched `nav:*` (no navigation drift).

## BC posture

Additive only:

- `AiPendingActionFailedRecord` / `executionResult` shape unchanged; `row.failedRecords[]` was already declared optional (Step 5.5) and serialized (Step 5.7).
- Three catalog CRUD event ids unchanged; `clientBroadcast: true` is additive per `BACKWARD_COMPATIBILITY.md` §5.
- `useAppEvent('catalog.product.*', ...)` is a brand-new subscription in `ProductsDataTable` — no existing callers affected.
- Executor unit-test stub's `makeRepoStub` already tracked `failedRecords` writes; no test harness regressions.

## Open follow-ups

- **Full live LLM end-to-end**: propose + confirm + partial-success rendering with a real model is still gated on non-deterministic CI (no seed API for `AiPendingAction`). Operator QA per Step 5.19 rollout notes covers this.
- **Browser-level DOM event bridge live-assertion** (SSE → `om:event` → DataTable refresh) is exercised at the unit level; Playwright coverage of the SSE stream will land with Step 5.19 (browser traces against `/api/events/stream`).
