# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-20T02:30:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 5 Step 5.18 **complete**. Phase 3 WS-D
continues with Step 5.19 — the last Step of the spec (docs + operator
rollout notes covering release notes, migration guide, and coexistence
with OpenCode).
**Last commit (code):** `df8606cd1` — `test(catalog): D18 bulk-edit demo end-to-end — single Confirm All, per-record events, partial-success (Phase 3 WS-D)`

## What just happened

- **Executor partial-success merge** landed in
  `packages/ai-assistant/src/modules/ai_assistant/lib/pending-action-executor.ts`:
  - New `extractHandlerFailedRecords()` picks up per-record failures
    from a bulk tool's return shape (`records[]` where
    `status !== 'updated'` + `error: { code, message }`).
  - New `mergeFailedRecords()` dedupes by `recordId` so the final
    `executing → confirmed` write persists the union of (re-check stale
    records) and (handler failures). The emitted `ai.action.confirmed`
    payload carries the merged list so subscribers (notifications,
    webhooks, etc.) see the authoritative failure set.
- **Catalog events carry `clientBroadcast: true`** (`catalog.events.ts`):
  `catalog.product.{created,updated,deleted}` now stream through the
  DOM event bridge. Confirmed AI bulk mutations (one
  `ai.action.confirmed` + one `catalog.product.updated` per record per
  spec §9.8 line 743) and direct API writes both surface to subscribers.
- **ProductsDataTable subscribes to `catalog.product.*`** via
  `useAppEvent` → bumps the existing `reloadToken` on every received
  event, triggering a fresh `/api/catalog/products` fetch.
- **New Playwright spec**
  `packages/core/src/modules/catalog/__integration__/TC-AI-D18-018-bulk-edit-demo.spec.ts`
  with 4 live-server scenarios (A–D). All 4 pass against the dev server.
- **Three new unit tests** in
  `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/pending-action-executor.test.ts`
  covering the batch partial-success path, the combined stale+handler
  failure path, and the single-record "no failures" baseline.

## Test + gate results

- **Tests**: ai-assistant 50/555 → **50/558** (+3 unit tests).
  core 344/3180 preserved. ui 66/351 preserved.
- **TC-AI-D18-018 Playwright**: 4/4 scenarios pass (≈1.9 min end-to-end).
- **Typecheck**: `yarn turbo run typecheck --filter=@open-mercato/core
  --filter=@open-mercato/ai-assistant --filter=@open-mercato/app` → 2/2
  successful (cache-bust forced for `core`). `ai-assistant` is gated at
  ts-jest time by its package contract.
- **Generator**: `yarn generate` green; no openapi drift.
- **i18n**: `yarn i18n:check-sync` → all 4 locales in sync.
- **Structural cache**: purged; no `nav:*` changes.
- See `step-5.18-checks.md` for the full matrix + per-scenario rationale.

## BC posture (production inventory)

- **Additive only.**
  - `AiPendingActionFailedRecord` shape unchanged; the merge logic
    composes existing fields only.
  - `executionResult` envelope unchanged; `failedRecords[]` flows via
    the pre-existing `row.failedRecords` column + serializer (Steps 5.5
    / 5.7).
  - Three catalog CRUD event ids unchanged; `clientBroadcast: true` is
    additive per `BACKWARD_COMPATIBILITY.md` §5.
  - `useAppEvent('catalog.product.*', ...)` is a brand-new subscription
    with no existing callers impacted.
  - No new routes, no new entities, no DB migration, no new feature
    ids, no DI key renames.

## Open follow-ups carried forward

- **Step 5.19** — Spec Phase 3 WS-D docs + operator rollout notes
  (release notes, migration guide, coexistence with OpenCode). This is
  the LAST Step of the spec; after 5.19 the PR is ready to flip out of
  `in-progress`.
- **Full live LLM end-to-end for D18** — propose + confirm + partial
  success rendering with a real model is still gated on
  non-deterministic CI (no seed API for `AiPendingAction`). Operator QA
  per 5.19 rollout notes will cover the live walk.
- **Browser-level DOM event bridge live-assertion** (SSE → `om:event`
  → DataTable refresh) is covered at the unit level today; a Playwright
  trace against `/api/events/stream` ships with Step 5.19.
- **Dispatcher UI-part flushing** — still on the Step 5.10 backlog.
- **Per-agent TTL override** (spec §8 `mutationApprovalTtlMs`) still
  deferred.
- **`agent-runtime.ts` `resolveAgentModel` migration to the shared
  model factory** still deferred from Step 5.1.
- **`inbox_ops/ai-tools.ts` + `translationProvider.ts`** still call
  `resolveExtractionProviderId` + `createStructuredModel` directly.
- **Dedicated portal `ai_assistant.view` feature** — still gated on
  `portal.account.manage`; tighten in a later Phase 5 Step.
- **Dedicated `ai_assistant.settings.manage_mutation_policy` feature**
  — carried from Step 5.5.
- **Dev-env integration test for the cleanup worker** — still gated on
  the coordinator's next checkpoint batch.
- **Caller-passed `stopWhen` / `maxSteps` override on `runAiAgentText`
  / `runAiAgentObject`** — still deferred from Step 5.16 pending a
  public-input surface.

## Next concrete action

- **Step 5.19 — docs + operator rollout notes.** Deliverable:
  - RELEASE_NOTES entry (or equivalent) for Phase 3 WS-D covering:
    pending-action contract (Steps 5.5–5.13), typed lifecycle events
    (5.11), cleanup worker (5.12), catalog D18 demo (5.18), and the
    `clientBroadcast: true` DOM bridge additions.
  - Migration guide for existing deployments:
    - new env var `AI_PENDING_ACTION_TTL_SECONDS` (default 900s).
    - new DB migration `Migration20260419134235_ai_assistant` (Step
      5.5) required for mutation approvals.
    - mutation-policy override flow (Step 5.4) replaces the old
      single-tier `readOnly` flag on agents.
  - Coexistence notes with OpenCode: the AI Chat UI runs in parallel
    with the OpenCode stdio MCP server; the dispatcher (Step 3.13) is
    the single policy gate for both paths.
  - Operator QA checklist for the D18 demo (live LLM walk-through of
    the four use cases against the products list; validates the SSE
    bridge → DataTable refresh end-to-end that Step 5.18 cannot cover
    deterministically in CI).

Expected placement: `apps/docs/docs/framework/ai/...` (operator docs)
+ a short RELEASE_NOTES entry or a dated row in `CHANGELOG.md` (whichever
the repo prefers — check existing conventions before picking).

## Cadence reminder

- **5-Step checkpoint due after Step 5.18.** Last full-gate checkpoint
  landed after 5.12 (`checkpoint-5step-after-5.12.md`); the 5.17 close
  flagged the "next batch at the natural close of Phase 3 WS-D
  integration-test sweep" boundary. With 5.18 done, 5.19 is the natural
  single-Step close of Phase 3 WS-D — coordinator runs the checkpoint
  alongside the 5.19 docs flip so the checkpoint artifact captures the
  spec-complete state.
- Phase 3 WS-A (5.1 + 5.2) done; WS-B (5.3 + 5.4) done;
  WS-C (5.5–5.14) done; WS-D: 5.15 + 5.16 + 5.17 + 5.18 done; 5.19
  remains.

## Environment caveats

- Dev runtime: `bgyb7opzt` on port 3000 — reuse for Step 5.19+
  validation. The dev DB still lacks Step 5.5's
  `Migration20260419134235_ai_assistant` in some configurations; Step
  5.18's Playwright spec is tolerant of both migration states (404 /
  500 envelope).
- TC-AI-D18-018 wiring smoke-check uses the `admin` credential (not
  `superadmin`) because the shared `createProductFixture` helper was
  written against that role; agent-list assertions continue using
  `superadmin`.
- TTL env var: `AI_PENDING_ACTION_TTL_SECONDS` (default 900s) —
  unchanged.

## Scope-discipline note for Step 5.19

Step 5.19 is a docs-only Step — do NOT add production code. If a gap
surfaces during writeup (e.g., a missing env-var constant reference),
record it as a follow-up in the next handoff instead of fixing it
inline. The PR MUST be ready for review once 5.19 lands.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
