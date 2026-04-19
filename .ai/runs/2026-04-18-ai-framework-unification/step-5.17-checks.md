# Step 5.17 — Phase 3 WS-D integration tests (pending-action contract)

**Commit (code):** `d3ee45368`
**Docs-flip commit:** see PLAN.md row 5.17.
**Scope:** additive, test-only. No production code changed.

## Files created

- `packages/ai-assistant/src/modules/ai_assistant/__tests__/integration/pending-action-contract.test.ts`

Placement follows the per-module rule (Jest integration under the owning
package's `__tests__/integration/` directory). The existing TC-AI-MUTATION-011
Playwright spec (Step 5.13) is untouched — Step 5.17 is the Jest-integration
complement.

## Scenario coverage vs the 15-scenario contract brief

| # | Scenario | Test id |
|---|----------|---------|
|  1 | Happy path (pending → executing → confirmed, typed ai.action.confirmed ×1) | `scenario-1 happy path` |
|  2 | Cancel with reason (typed ai.action.cancelled ×1) | `scenario-2 cancel` |
|  3 | Expiry via Step 5.12 cleanup worker (resolvedByUserId=null) | `scenario-3 expiry via cleanup worker` |
|  4 | Expiry via opportunistic cancel path (atomic flip pending → expired) | `scenario-4 expiry via opportunistic cancel path` |
|  5 | Stale-version single-record (412, row stays pending, no event) | `scenario-5 stale-version single-record` |
|  6 | Stale-version batch partial (failedRecords[] on confirmed row) | `scenario-6 stale-version batch partial` |
|  7 | Stale-version batch all (412, row stays pending) | `scenario-7 stale-version batch all` |
|  8 | Cross-tenant (tenant B cannot read tenant A row) | `scenario-8 cross-tenant` |
|  9 | Idempotent double-confirm (no re-execution, no re-emit) | `scenario-9 idempotent double-confirm` |
| 10 | Idempotent double-cancel (no re-emit) | `scenario-10 idempotent double-cancel` |
| 11 | Read-only-agent refusal (403 read_only_agent) | `scenario-11 read-only-agent refusal` |
| 12 | Prompt-override escalation refusal (additive-only guarantee) | `scenario-12 prompt-override escalation refusal` |
| 13 | Reconnect (GET re-hydration between propose and confirm) | `scenario-13 reconnect` |
| 14 | Illegal state-machine transitions (AiPendingActionStateError) | `scenario-14 illegal state transitions` |
| 15 | Attachment cross-tenant (403 attachment_cross_tenant) | `scenario-15 attachment cross-tenant` |
| +1 | Typed event helper: confirm / cancel / expired payloads | `typed event helper` |
| +1 | Executor tool-handler context surface | `tool handler receives the full McpToolContext surface` |

Total: 17 Jest tests in one new integration suite.

## Mocking discipline

- **ORM stub** — hand-rolled in-memory repository that mirrors
  `AI_PENDING_ACTION_ALLOWED_TRANSITIONS` and throws `AiPendingActionStateError`
  on illegal edges, exactly like the production `AiPendingActionRepository.setStatus`
  transactional guard.
- **Event bus** — exercised through the existing `emitEvent` injection seams on
  `executePendingActionConfirm`, `executePendingActionCancel`, and
  `runPendingActionCleanup`. Event id + typed payload shape are asserted
  directly against `PENDING_ACTION_CONFIRMED_EVENT_ID` /
  `PENDING_ACTION_CANCELLED_EVENT_ID` / `PENDING_ACTION_EXPIRED_EVENT_ID` and
  the `AiActionConfirmedPayload` / `AiActionCancelledPayload` /
  `AiActionExpiredPayload` types from `events.ts`.
- **Attachment guard** — `findWithDecryption` is mocked at the
  `@open-mercato/shared/lib/encryption/find` module boundary plus a virtual
  mock for `@open-mercato/core/modules/attachments/data/entities` (the core
  dist is ESM and ts-jest does not transform it). Both mocks are scoped to this
  suite only.

None of the under-test modules (`pending-action-executor.ts`,
`pending-action-cancel.ts`, `pending-action-recheck.ts`,
`workers/ai-pending-action-cleanup.ts`) are mocked.

## No production code added

No new exported helpers, no new types, no new routes, no new events. The
existing `emitEvent` / `repo` injection seams were sufficient to drive every
scenario end-to-end.

## Baselines preserved

- `packages/ai-assistant`: baseline 49/538 → **50/555** (+1 suite, +17 tests).
- `packages/core`: **3180/3180** unchanged (344 suites).
- `packages/ui`: **351/351** unchanged (66 suites).

Full ai-assistant run: `packages/ai-assistant$ npx jest --config=jest.config.cjs --forceExit`
(2.0 s wall; all 50 suites green, the Jest worker-exit warning is the
pre-existing environment behavior documented in earlier step-checks).

## Other gates

- `yarn turbo run typecheck --filter=@open-mercato/ai-assistant --filter=@open-mercato/core --filter=@open-mercato/app`
  → 2/2 successful (cache-hit; ai-assistant has no direct typecheck script by
  design, its gate is build + ts-jest).
- `yarn generate` → green; no output drift (test-only Step).
- `yarn i18n:check-sync` → green (no new strings).

## BC posture

- Additive only. One new test file. No production code touched. No generator
  output changed. No migration. No i18n additions. No contract-surface move.

## Deferred / carried forward

- **Step 5.18** — full D18 bulk-edit demo end-to-end
  (`catalog.merchandising_assistant` runs all four named use cases through
  `bulk_update_products` with single `[Confirm All]` approval, per-record
  `catalog.product.updated` events, DataTable refresh via DOM event bridge,
  and `partialSuccess` handling).
- **Step 5.19** — docs + operator rollout notes (release notes, migration
  guide, coexistence with OpenCode).
- All open follow-ups from Step 5.16 unchanged (dispatcher UI-part flushing,
  per-agent TTL override, `agent-runtime.ts resolveAgentModel` migration,
  inbox_ops provider cutover, dedicated portal `ai_assistant.view` feature,
  dedicated `ai_assistant.settings.manage_mutation_policy` feature, dev-env
  cleanup-worker integration test).
