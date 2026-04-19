# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-19T05:30:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 5 Step 5.17 **complete**. Phase 3 WS-D
continues with Step 5.18 — full D18 bulk-edit demo end-to-end
(`catalog.merchandising_assistant` runs all four named use cases through
`bulk_update_products` with single `[Confirm All]` approval, per-record
`catalog.product.updated` events, DataTable refresh via DOM event bridge,
and `partialSuccess` handling).
**Last commit (code):** `d3ee45368` — `test(ai-assistant): pending-action contract integration tests (Phase 3 WS-D)`

## What just happened

- **One new Jest-integration suite** landed under
  `packages/ai-assistant/src/modules/ai_assistant/__tests__/integration/pending-action-contract.test.ts`
  with 17 tests covering the full Step 5.5 → 5.12 pending-action contract:
  - 15 scenarios from the Step 5.17 brief (happy / cancel / expiry-worker /
    expiry-opportunistic / stale-version single / stale-version batch partial /
    stale-version batch all / cross-tenant / idempotent double-confirm /
    idempotent double-cancel / read-only-agent refusal / prompt-override
    escalation refusal / reconnect / illegal state transitions / attachment
    cross-tenant).
  - +1 typed-event payload-shape test across confirm / cancel / expired.
  - +1 `McpToolContext` surface assertion on the executor's handler context.

- **Mock boundaries stayed narrow.** An in-memory repository stub mirrors
  `AI_PENDING_ACTION_ALLOWED_TRANSITIONS` so illegal edges throw
  `AiPendingActionStateError` exactly like the production
  `AiPendingActionRepository.setStatus` transactional guard. The three
  under-test helpers — `executePendingActionConfirm`,
  `executePendingActionCancel`, `runPendingActionCleanup` — are exercised
  via the existing `emitEvent` and `repo` injection seams and are NOT
  mocked. Typed event-id constants and payload types
  (`AiActionConfirmedPayload` / `AiActionCancelledPayload` /
  `AiActionExpiredPayload`) are asserted directly. The attachment
  cross-tenant scenario mocks `findWithDecryption` at the
  `@open-mercato/shared/lib/encryption/find` module boundary plus a
  virtual mock for `@open-mercato/core/modules/attachments/data/entities`
  (core dist is ESM and ts-jest does not transform it); both mocks are
  scoped to this suite only.

- **No production code changes.** No new helpers, no new types, no new
  routes, no new events. The `emitEvent` and `repo` seams already present
  on every executor were sufficient.

## Test + gate results

- **Tests**: ui 66/351 preserved. core 344/3180 preserved.
  ai-assistant 49/538 → **50/555** (+1 suite / +17 tests).
- **Typecheck**: `yarn turbo run typecheck --filter=@open-mercato/ai-assistant
  --filter=@open-mercato/core --filter=@open-mercato/app` → 2/2
  successful (cache-hit; ai-assistant has no direct typecheck script by
  design, its gate is build + ts-jest).
- **Generator**: `yarn generate` green; no output drift (test-only
  Step). Structural cache purge ran as normal.
- **i18n**: `yarn i18n:check-sync` green — no new strings added.
- See `step-5.17-checks.md` for the full 15-scenario coverage matrix.

## BC posture (production inventory)

- **Additive only.** One new test file. No production code touched.
  No generator output changed. No migration. No i18n additions. No API /
  event / feature / DI key / DB rename.

## Open follow-ups carried forward (unchanged)

- **Step 5.18** — full D18 bulk-edit demo end-to-end.
- **Step 5.19** — docs + operator rollout notes.
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

- **Step 5.18 — full D18 bulk-edit demo end-to-end.** Deliverable:
  - Drive `catalog.merchandising_assistant` through all four named use
    cases listed in the source spec's D18 section using
    `bulk_update_products` under a single `[Confirm All]` approval.
  - Per-record `catalog.product.updated` events MUST be emitted (one per
    surviving row in the batch), and the events' payloads MUST satisfy
    the existing catalog events contract.
  - `DataTable` refresh via the DOM event bridge (`useAppEvent`) MUST be
    demonstrated on an actual catalog list page; partialSuccess rows
    (surfaced via `failedRecords[]`) MUST be visible.
  - Coverage can be a mix of Jest integration (for the bulk executor
    wiring) + Playwright (for the single-approval UX). Keep the
    `prepare-mutation` batch path + the Step 5.6 records[] contract
    front-and-center.
  - No new public types, no new routes.

  Expected placement: integration code under
  `packages/core/src/modules/catalog/__tests__/` and
  `packages/ai-assistant/src/modules/ai_assistant/__tests__/integration/`;
  Playwright pieces under `.ai/qa/tests/ai-framework/` if browser-driven
  UX coverage is included.

## Cadence reminder

- **5-Step checkpoint due after Step 5.17.** Last full-gate checkpoint
  landed after 5.12 (`checkpoint-5step-after-5.12.md`). Five Steps since
  (5.13 → 5.14 → 5.15 → 5.16 → 5.17). Coordinator runs the next
  checkpoint batch at the natural "close of Phase 3 WS-D integration-test
  sweep" boundary which is NOW.
- Phase 3 WS-A (5.1 + 5.2) done; Phase 3 WS-B (5.3 + 5.4) done;
  Phase 3 WS-C (5.5–5.14) done; Phase 3 WS-D: 5.15 + 5.16 + 5.17 done;
  5.18 → 5.19 remain.

## Environment caveats

- Dev runtime: `bgyb7opzt` on port 3000 — reuse for Step 5.18+
  validation. The dev DB still lacks Step 5.5's
  `Migration20260419134235_ai_assistant` (carried from Step 5.14 → 5.15
  → 5.16); integration specs continue to be tolerant of both migration
  states. Step 5.18 will likely benefit from running `yarn db:migrate`
  once the coordinator authorizes it.
- No migration in this Step (test-only).
- Typecheck clean (`@open-mercato/core` + `@open-mercato/app`);
  ai-assistant gated by build + ts-jest.
- TTL env var: `AI_PENDING_ACTION_TTL_SECONDS` (default 900s) —
  unchanged.

## Scope-discipline note for Step 5.18

Step 5.18 is the first Step in Phase 5 that should produce user-visible
behavior (the `[Confirm All]` single-approval UX on an actual catalog
list page). Keep the deliverable ONE end-to-end demo — do NOT conflate
it with "polish the preview card" or "add more bulk tools". If extra
tooling surfaces during the demo, carry them as separate follow-ups.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
