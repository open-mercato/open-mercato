# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-19T02:45:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 5 Step 5.15 **complete**. Phase 3 WS-D
production-rollout work starts here: `<AiChat>` now threads a stable
`conversationId` per mount (or accepts one from the caller), and three
production surfaces bind to the framework through widget injection
rather than page edits — People list, Deal detail, and the catalog
Products list merchandising trigger.
**Last commit (code):** `2d6886130` — `feat(ai-assistant-bindings): thread conversationId + bind production agents via widget injection (Phase 3 WS-D)`

## What just happened

- **`<AiChat>` / `useAiChat` conversation id threading.**
  - New optional `conversationId?: string` prop. When omitted, the hook
    mints a stable random id once on mount via `React.useRef` + a
    `crypto.randomUUID` helper (falls back to a `conv_<time>_<rand>`
    token when `crypto` isn't available). When caller-supplied, the prop
    is forwarded verbatim — same prop across two remounts yields the
    same id.
  - The id is sent in the POST body to `/api/ai_assistant/ai/chat`,
    accepted by the dispatcher schema
    (`z.string().min(1).max(128).optional()`), and threaded through
    `runAiAgentText` → `resolveAiAgentTools` → `prepareMutation` so the
    Step 5.6 idempotency hash collapses repeated confirms / retries
    within the same chat onto a single `AiPendingAction` row.
  - Also exposed on the result of `useAiChat` and as
    `data-ai-chat-conversation-id` on the region root for integration
    observability.

- **Customers People list trigger (Step 4.10 extension).**
  - `customers.injection.ai-assistant-trigger` already rendered on
    `data-table:customers.people.list:header` with a selection-aware
    `pageContext`. This Step adds unit coverage for
    `computeCustomersAiInjectPageContext` across four cases (no
    selection / explicit selectedRowIds / selectedCount-only /
    string `totalMatching` coercion).

- **Customers Deal detail binding (new).**
  - New widget `customers.injection.ai-deal-detail-trigger` on the new
    spot `detail:customers.deal:header`. The deal detail page
    (`backend/customers/deals/[id]/page.tsx`) gained one shared
    `<InjectionSpot>` mount — the trigger, sheet, and `<AiChat>` embed
    all live inside the widget.
  - `pageContext` shape:
    `{ view: 'customers.deal.detail', recordType: 'deal', recordId,
       extra: { stage, pipelineStageId } }`.
  - Wires `customers.account_assistant` (read-only by default). When
    the Step 5.4 per-tenant mutation-policy override unlocks writes,
    the Step 5.13 `customers.update_deal_stage` tool becomes
    reachable through the same flow.
  - Feature-gated behind `customers.deals.view` + `ai_assistant.view`.

- **Catalog merchandising migration (page → injection).**
  - New widget `catalog.injection.merchandising-assistant-trigger` on
    spot `data-table:catalog.products:header`. Reuses the existing
    `MerchandisingAssistantSheet` component verbatim so the Phase 2
    read-only DOM contract is preserved.
  - Removed the direct `MerchandisingAssistantSheet` import +
    `useMerchandisingAssistantEligibility` polling from
    `backend/catalog/products/page.tsx`; the page is now a thin shell
    around `<ProductsDataTable>`. Feature gating moved to the widget's
    `features` metadata.
  - `ProductsDataTable.injectionContext` now surfaces
    `total` / `totalMatching` so the widget can build the selection-
    aware `MerchandisingPageContext` without a direct dependency on
    the host page.

- **Unit tests (new / extended).**
  - `packages/ui/src/ai/__tests__/AiChat.conversation.test.tsx` — 3
    tests: explicit-prop stability across remounts, auto-mint
    uniqueness without a prop, POST-body forwarding.
  - `ai-assistant-trigger/__tests__/widget.client.test.tsx` +4 tests
    on the page-context derivation.
  - `ai-deal-detail-trigger/__tests__/widget.client.test.tsx` — 6
    tests covering widget render, null-on-missing-id, flat/nested
    pageContext derivation, and flat/nested precedence.
  - `merchandising-assistant-trigger/__tests__/widget.client.test.tsx` —
    4 tests covering widget render + merchandising pageContext
    derivation.
  - `catalog/widgets/__tests__/injection-table.test.ts` extended with
    the new `data-table:catalog.products:header` mapping assertion.

- **Integration tests (new, per UI cadence).**
  - `TC-AI-INJECT-012-deal-detail-inject.spec.ts` seeds a deal via the
    customers CRUD API, asserts the trigger renders with the seeded id
    on `data-ai-customers-deal-id`, opens the sheet, the `<AiChat>`
    composer appears, then cleans up. Tolerant of API seed failures
    (skips cleanly).
  - `TC-AI-INJECT-013-merchandising-injection.spec.ts` exercises the
    catalog migration path — same DOM contract as TC-AI-MERCHANDISING-008
    but through the injection registry.
  - TC-AI-INJECT-009 (people-list inject) and TC-AI-MERCHANDISING-008
    (merchandising) continue to pass — every data- attribute they pin
    on was preserved across the migration.

## Test + gate results

- **Tests**: ui 65/348 → **66/351** (+1 suite / +3 tests); core (post-
  5.14 ~342/~3114) → **342/3167** (mutation-pack additions from 5.14
  + this Step's widget test additions); ai-assistant 47/525 preserved.
- **Typecheck**: `yarn turbo run typecheck --filter=@open-mercato/ui
  --filter=@open-mercato/ai-assistant --filter=@open-mercato/core
  --filter=@open-mercato/app` — **3/3 successful** (ai-assistant gated
  by build step as before).
- **Generator**: `yarn generate` green; both new injection widgets
  discovered and emitted into `injection-widgets.generated.ts` +
  `injection-tables.generated.ts`. Structural cache purge ran as
  normal.
- **i18n**: `yarn i18n:check-sync` green — five new
  `customers.ai_assistant.dealDetail.*` keys added in en/pl/es/de.
- See `step-5.15-checks.md` for the per-test coverage matrix.

## BC posture (production inventory)

- **Additive only.** New optional prop (`conversationId`) on
  `<AiChat>` + `useAiChat`. New optional body field on the chat
  dispatcher (bounded). New optional field on `RunAiAgentTextInput`.
  Two new injection widgets. One new injection spot id
  (`detail:customers.deal:header`). One new `data-` attribute on the
  `<AiChat>` region root. Five new i18n keys per locale. No API route
  rename, no event rename, no feature-id rename, no DI key rename, no
  DB migration, no generator-output name change.

## Open follow-ups carried forward

- **Step 5.16** — integration tests for page-context resolution +
  model-factory fallback chain + `maxSteps` execution-budget
  enforcement.
- **Step 5.17** — full pending-action contract integration sweep (happy
  / cancel / expiry / stale-version / cross-tenant confirm denial /
  idempotent double-confirm / read-only-agent refusal / prompt-override
  escalation refusal / page-reload reconnect).
- **Step 5.18** — full D18 bulk-edit demo end-to-end.
- **Step 5.19** — docs + operator rollout notes.
- **Dispatcher UI-part flushing** — still on the Step 5.10 backlog.
- **Per-agent TTL override** (spec §8 `mutationApprovalTtlMs`) still
  deferred.
- **`agent-runtime.ts` `resolveAgentModel` migration** still deferred
  from Step 5.1.
- **`inbox_ops/ai-tools.ts` + `translationProvider.ts`** still call
  `resolveExtractionProviderId` + `createStructuredModel` directly.
- **Dedicated portal `ai_assistant.view` feature** — still gated on
  `portal.account.manage`; tighten in a later Phase 5 Step.
- **Dedicated `ai_assistant.settings.manage_mutation_policy` feature**
  — carried from Step 5.5.
- **Dev-env integration test for the cleanup worker** — still gated on
  the coordinator's next checkpoint batch.

## Next concrete action

- **Step 5.16** — integration tests for page-context resolution,
  model-factory fallback chain, and `maxSteps` execution-budget
  enforcement. Primary surfaces:
  1. `customers.account_assistant` with the Deal detail binding from
     Step 5.15 — assert `resolvePageContext` hydrates the deal summary
     on the system prompt via the new `detail:customers.deal:header`
     mount.
  2. `catalog.merchandising_assistant` with the injection-path trigger
     from Step 5.15 — assert the filter/total snapshot flows into
     `pageContext.extra` and back into the agent's system prompt.
  3. `createModelFactory` — exercise the env-override precedence chain
     (`callerOverride > <MODULE>_AI_MODEL > agentDefaultModel >
     provider default`) against a mock provider registry.
  4. `stopWhen: stepCountIs(agent.maxSteps)` — confirm the budget
     caps multi-step runs once `maxSteps` is declared.

## Cadence reminder

- **5-Step checkpoint overdue.** Last full-gate checkpoint landed
  after 5.12 (`checkpoint-5step-after-5.12.md`). Three Steps since
  (5.13 → 5.14 → 5.15). Coordinator runs the next checkpoint batch
  after 5.17 (the natural "close of Phase 3 WS-D integration-test
  sweep").
- Phase 3 WS-A (5.1 + 5.2) done; Phase 3 WS-B (5.3 + 5.4) done;
  Phase 3 WS-C (5.5–5.14) done; Phase 3 WS-D: 5.15 done; 5.16 → 5.19
  remain.

## Environment caveats

- Dev runtime: `bgyb7opzt` on port 3000 — reuse for Step 5.16+
  validation. The dev DB still lacks Step 5.5's
  `Migration20260419134235_ai_assistant` (carried from Step 5.14);
  integration specs continue to be tolerant of both migration states.
  The next executor MAY run `yarn db:migrate` (with user
  authorization) for stricter pending-action envelope coverage.
- No migration in this Step.
- Typecheck clean (`@open-mercato/core` + `@open-mercato/ui` +
  `@open-mercato/app`); ai-assistant gated by build + ts-jest.
- TTL env var: `AI_PENDING_ACTION_TTL_SECONDS` (default 900s) —
  unchanged.

## Scope-discipline note for Step 5.16

Keep Step 5.16 strictly additive to the integration test suite — no
runtime behavior changes. The expected deliverables are:

- `TC-AI-PAGECTX-*` specs that exercise the Deal detail +
  merchandising pageContext wiring end-to-end (assert system-prompt
  hydration reflects the record- or filter-level context).
- `TC-AI-MODEL-FACTORY-*` specs (or a pure-unit harness under
  `packages/ai-assistant`) that exercise the four-layer precedence
  chain.
- `TC-AI-MAXSTEPS-*` spec that asserts `stopWhen: stepCountIs(...)` is
  wired correctly when the agent declares `maxSteps`.

None of this requires new public types / new routes / new widgets.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
