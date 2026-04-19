# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-19T04:15:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 5 Step 5.16 **complete**. Phase 3 WS-D
continues with Step 5.17 — the full pending-action contract integration
sweep (happy / cancel / expiry / stale-version / cross-tenant /
idempotent double-confirm / read-only-agent refusal / prompt-override
escalation refusal / page-reload reconnect).
**Last commit (code):** `ccf2d1292` — `test(ai-framework): integration tests for page-context + model-factory + maxSteps budget (Phase 3 WS-D)`

## What just happened

- **Four new Jest integration suites** landed per-module (no Playwright
  required — Step 5.16 was integration-test-only):
  - `packages/core/src/modules/customers/__tests__/ai-agents-context.integration.test.ts`
    (7 tests) — drives the production `customers.account_assistant.resolvePageContext`
    callback through the agent's module-root `ai-agents.ts` export so the
    widget → runtime contract is pinned. Covers person / company / deal
    happy paths, unknown recordType, missing recordId, cross-tenant
    recordId (tenant isolation via `found: false`), and throwing service
    with a `console.warn` spy.
  - `packages/core/src/modules/catalog/__tests__/ai-agents-context.integration.test.ts`
    (6 tests) — covers both `hydrateCatalogAssistantContext` (summary
    projection) and `hydrateMerchandisingAssistantContext` (full
    bundles). Asserts `SELECTION_CAP=10`, cross-tenant ids silently
    dropped via `missingIds`, and no-parse recordId fallthrough.
  - `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/model-factory.integration.test.ts`
    (8 tests) — pins the full 4-layer chain
    (`callerOverride > <MODULE>_AI_MODEL > agentDefaultModel > provider default`),
    plus `no_provider_configured` throw, `moduleId: undefined` skip, and
    empty / whitespace `callerOverride` fallthrough.
  - `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/max-steps-budget.integration.test.ts`
    (5 tests) — stubs the AI SDK module boundary (`streamText`,
    `generateObject`, `stepCountIs`, `convertToModelMessages`) and
    asserts `stopWhen: stepCountIs(agent.maxSteps)` wires for
    runAiAgentText (positive / undefined / zero) plus object-mode parity
    on `generateObject`.

- **Mock boundaries held narrow.** Customers + catalog suites mock the
  tool pack (`../ai-tools`); ai-assistant suites stub `ai` and the
  provider registry at the Jest module boundary. No internal lib helpers
  under test were mocked. No DI container, no DB.

- **No production code changes.** No new public helpers needed — the
  Step 5.1 `CreateModelFactoryDependencies.registry`/`env` seam, the
  agent's exported `resolvePageContext`, the catalog helpers, and the
  existing `ai` import seam were all sufficient.

## Test + gate results

- **Tests**: ui 66/351 preserved. core 342/3167 → **344/3180** (+2
  suites / +13 tests). ai-assistant 47/525 → **49/538** (+2 suites /
  +13 tests).
- **Typecheck**: `yarn turbo run typecheck --filter=@open-mercato/ai-assistant
  --filter=@open-mercato/core --filter=@open-mercato/app` → 2/2
  successful (ai-assistant has no typecheck script by design — ts-jest +
  build step is its gate).
- **Generator**: `yarn generate` green; no output drift (test-only
  Step). Structural cache purge ran as normal.
- **i18n**: `yarn i18n:check-sync` green — no new strings added.
- See `step-5.16-checks.md` for the per-suite coverage matrix and the
  documented scope gap.

## BC posture (production inventory)

- **Additive only.** Four new test files. No production code touched.
  No generator output changed. No migration. No i18n additions. No API
  / event / feature / DI key / DB rename.

## Deliberate scope gap carried forward

- **Caller-passed `stopWhen` / `maxSteps` override on
  `runAiAgentText` / `runAiAgentObject`** — the Step 5.16 description
  mentioned this scenario but the current public input shape does not
  expose a per-call override surface (only `modelOverride`). Introducing
  it would require new production code, which Step 5.16 explicitly
  forbade. Deferred to a future Phase 5 hardening Step, likely bundled
  with the agent-runtime `resolveAgentModel` migration that is also
  still deferred from Step 5.1. The existing agent-level `maxSteps`
  declaration remains fully covered.

## Open follow-ups carried forward (unchanged)

- **Step 5.17** — full pending-action contract integration sweep
  (happy / cancel / expiry / stale-version / cross-tenant confirm
  denial / idempotent double-confirm / read-only-agent refusal /
  prompt-override escalation refusal / page-reload reconnect).
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

## Next concrete action

- **Step 5.17** — pending-action contract integration tests. Primary
  surfaces the executor should pin:
  1. **Happy path** — `prepareMutation` → `AiPendingAction` row created
     with expected snapshot, `mutation-preview-card` UI part emitted,
     `confirm` executes the tool and emits `ai.action.confirmed`.
  2. **Cancel** — `POST /api/ai/actions/:id/cancel` flips status to
     `cancelled`, emits `ai.action.cancelled`, subsequent confirm
     refuses.
  3. **Expiry** — TTL past `expiresAt` → cancel route / cleanup worker
     transitions to `expired` + emits `ai.action.expired`, subsequent
     confirm refuses.
  4. **Stale-version** — Step 5.8 §9.4 re-check: when the underlying
     record changed since capture (`recordVersion` mismatch), confirm
     returns the stale error without mutating.
  5. **Cross-tenant confirm denial** — confirm signed by a session
     scoped to a different tenant MUST refuse without disclosing
     existence.
  6. **Idempotent double-confirm** — second confirm on an already-
     confirmed row returns the same result without re-executing the
     tool / emitting a second `ai.action.confirmed`.
  7. **Read-only-agent refusal** — `readOnly: true` agent whose
     prompt-override tries to escalate — `prepareMutation` must reject
     before even creating the row (spec §9.2).
  8. **Prompt-override escalation refusal** — even with a permissive
     prompt override, `mutationPolicy: 'read-only'` override wins
     (Step 5.4 contract).
  9. **Page-reload reconnect** — `GET /api/ai/actions/:id` returns the
     current card payload unchanged across reconnects; the four
     UI parts from Step 5.10 must re-render identically.

  Expected placement: `packages/ai-assistant/src/modules/ai_assistant/__tests__/integration/`
  for the runtime-level scenarios, and `__integration__/` Playwright
  specs for any full page-reload reconnect coverage if the dev env is
  runnable. Same mock boundary discipline as Step 5.16 — narrow, per-
  module, no DI container mocked unless absolutely necessary.

## Cadence reminder

- **5-Step checkpoint overdue.** Last full-gate checkpoint landed
  after 5.12 (`checkpoint-5step-after-5.12.md`). Four Steps since
  (5.13 → 5.14 → 5.15 → 5.16). Coordinator runs the next checkpoint
  batch after 5.17 (the natural "close of Phase 3 WS-D integration-test
  sweep").
- Phase 3 WS-A (5.1 + 5.2) done; Phase 3 WS-B (5.3 + 5.4) done;
  Phase 3 WS-C (5.5–5.14) done; Phase 3 WS-D: 5.15 + 5.16 done;
  5.17 → 5.19 remain.

## Environment caveats

- Dev runtime: `bgyb7opzt` on port 3000 — reuse for Step 5.17+
  validation. The dev DB still lacks Step 5.5's
  `Migration20260419134235_ai_assistant` (carried from Step 5.14);
  integration specs continue to be tolerant of both migration states.
  The next executor MAY run `yarn db:migrate` (with user
  authorization) for stricter pending-action envelope coverage —
  Step 5.17 is the place where this matters most, since the entire
  sweep exercises the `ai_pending_actions` table.
- No migration in this Step (test-only).
- Typecheck clean (`@open-mercato/core` + `@open-mercato/app`);
  ai-assistant gated by build + ts-jest.
- TTL env var: `AI_PENDING_ACTION_TTL_SECONDS` (default 900s) —
  unchanged.

## Scope-discipline note for Step 5.17

Keep Step 5.17 strictly additive to the integration test suite. The
expected deliverables are per-module Jest integration tests (and,
where the dev env is runnable, Playwright reconnect specs) — no new
public types, no new routes, no new widgets, no new events. If the
scope forces a split (for example because the reconnect Playwright
spec cannot run headless in CI and needs its own Step), land the
Jest coverage first as 5.17 and split the Playwright piece off as
5.17-b rather than fattening one commit.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
