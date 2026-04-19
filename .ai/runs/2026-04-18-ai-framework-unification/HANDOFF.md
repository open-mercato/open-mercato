# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-19T14:05:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 5 Step 5.4 **complete**. Phase 3 WS-B is
now fully landed (versioned prompt-override persistence + additive
merge rules + feature-gated mutationPolicy override UI). Next:
Step 5.5 — `AiPendingAction` MikroORM entity + repository + migration,
the first Step of Phase 3 WS-C (mutation approval gate / D16).
**Last commit (code):** `ddc08903e` — `feat(ai-assistant): feature-gated mutationPolicy override with escalation guard (Phase 3 WS-B)`

## What just happened

- New MikroORM entity `AiAgentMutationPolicyOverride` under
  `packages/ai-assistant/src/modules/ai_assistant/data/entities.ts`
  (+ re-export at `data/entities/AiAgentMutationPolicyOverride.ts`).
  Migration landed at
  `packages/ai-assistant/src/modules/ai_assistant/migrations/Migration20260419132948.ts`
  (reversible; `down()` drops the table cascade). Snapshot updated.
- `AiAgentMutationPolicyOverrideRepository` exposes `get` / `set` /
  `clear`. Unlike the prompt-override repo this is NOT versioned —
  there's one current override per `(tenantId, organizationId, agentId)`
  and `set` replaces it atomically via `em.transactional`. Reads go
  through `findOneWithDecryption`.
- New route
  `/api/ai_assistant/ai/agents/[agentId]/mutation-policy`:
  - `GET` → `{ agentId, codeDeclared, override }` (requires
    `ai_assistant.view`).
  - `POST` (`ai_assistant.settings.manage`) persists the override.
    **Escalation guard (load-bearing):** rejects any POST whose
    `mutationPolicy` would widen the agent's code-declared policy with
    400 + `code: 'escalation_not_allowed'` and the offending values in
    `codeDeclared` / `requested`.
  - `DELETE` (`ai_assistant.settings.manage`) clears the override;
    idempotent (200 even when none existed).
  - `metadata` declared per method; `openApi` covers all three verbs.
- Policy hierarchy landed (most restrictive → least):
  `read-only` (0) < `destructive-confirm-required` (1) <
  `confirm-required` (2). Encoded in `POLICY_RESTRICTIVENESS` inside
  `lib/agent-policy.ts`. Three pure helpers — `isKnownMutationPolicy`,
  `resolveEffectiveMutationPolicy`, `isMutationPolicyEscalation` —
  are exported so route + runtime + tests share one source of truth.
- Runtime wiring (additive):
  - `checkAgentPolicy` now accepts an optional
    `mutationPolicyOverride`. Callers that omit it keep exactly the
    pre-Step-5.4 behavior.
  - `resolveAiAgentTools` (both the agent-level and per-tool
    `checkAgentPolicy` invocations) forwards the override through.
  - `runAiAgentText` / `runAiAgentObject` load the override via
    `AiAgentMutationPolicyOverrideRepository.get` before calling
    `resolveAiAgentTools`. Lookup failures (missing container, missing
    `em`, repo throw, corrupt enum) log at `warn` and fall back to
    `null` → code-declared policy. A chat turn never fails on override
    lookup.
- Settings page gains a new `MutationPolicySection` collapsible panel
  inside `AgentDetailPanel`, rendered BETWEEN the agent metadata block
  and the prompt-override editor (deliberately separate surfaces):
  - Shows code-declared policy and current tenant override as
    `StatusBadge`s plus the effective policy at the section header.
  - Radio group with all three options; options more permissive than
    the code-declared value are disabled with an explanatory tooltip
    (`"Cannot be set above the agent's declared policy — this is a
    code-level change."`).
  - "Clear override" button visible when an override exists; "Save
    override" button activates when the selected value differs from
    the current override.
  - Success alert on 200; destructive Alert surfaces server errors
    verbatim — especially `escalation_not_allowed`, where the server
    message is relayed without rewriting.
- Integration spec `TC-AI-AGENT-SETTINGS-005` gains two scenarios:
  - Settings page for a read-only agent disables the `confirm-required`
    radio (asserts `data-ai-agent-mutation-policy-option-disabled="true"`).
  - POST escalation attempt via `request.fetch` — route exists and
    returns 400 + `escalation_not_allowed` when auth is present, or
    401/403 in stripped-auth test envs (the route must never 404 on
    the path itself).
- i18n: 22 new keys under `ai_assistant.agents.mutation_policy.*`
  with full en/pl/es/de translations (no placeholder rows).
- Test deltas:
  - ai-assistant: 33 / 386 → **36 / 419** (+3 suites / +33 tests).
    New suites: `AiAgentMutationPolicyOverrideRepository` (7),
    `agent-policy.mutation-override` (11), `route.test.ts` (15).
  - core: 338 / 3094 preserved.
  - ui: 60 / 328 preserved.
- Typecheck (`@open-mercato/core` + `@open-mercato/app`) green;
  `yarn generate` green with no drift; `yarn db:generate` emitted the
  migration (manually renamed the class to `_ai_assistant` suffix to
  match Step 5.3 convention); `yarn i18n:check-sync` green (46 modules
  × 4 locales).

## Open follow-ups carried forward

- **Step 5.5** is the next natural stop: `AiPendingAction` MikroORM
  entity + repository + migration. This opens Phase 3 WS-C (mutation
  approval gate). Before the coordinator lets 5.5 land it should run
  the overdue 5-Step checkpoint (full gate + integration suites +
  ds-guardian sweep).
- **`agent-runtime.ts` `resolveAgentModel` migration** still deferred
  from Step 5.1. A later Step should migrate it to
  `createModelFactory(container)` so chat-mode and object-mode runs
  honor `<MODULE>_AI_MODEL` via the shared port.
- **Runtime signature extension** for `AiAgentPageContextInput` —
  the merchandising agent's sheet already carries
  `pageContext.extra.filter` client-side, but the current hook only
  forwards `entityType` + `recordId`. When a Step needs the filter
  server-side (e.g., the D18 bulk-edit flow), widen the shape
  additively and re-wire the merchandising hydrator to surface it.
- **`inbox_ops/ai-tools.ts` + `translationProvider.ts`** still call
  `resolveExtractionProviderId` + `createStructuredModel` directly.
  Revisit in or after the next WS-C Step.
- **Portal customer login UI helper** still missing from
  `packages/core/src/modules/core/__integration__/helpers/` — carried
  from Phase 2. TC-AI-INJECT-010 retains its deferred-UI-smoke
  placeholder.
- **Dedicated portal `ai_assistant.view` feature** — still gated on
  `portal.account.manage`; tighten in a later Phase 5 Step.
- **Dedicated `ai_assistant.settings.manage_mutation_policy` feature**
  — Step 5.4 ships the mutation-policy UI under the existing
  `ai_assistant.settings.manage` feature (same as prompt overrides).
  The HANDOFF for 5.3 floated a stricter feature for policy edits;
  splitting it out remains optional and would be additive.

## Next concrete action

- **Step 5.5** — Spec Phase 3 WS-C — `AiPendingAction` MikroORM entity
  + repository + migration. One new additive table keyed by
  `(tenantId, organizationId, agentId, actionId)` with `status`,
  `requestedPayload`, `diff`, `records[]`, `failedRecords[]`,
  `expiresAt`, `confirmedByUserId?`, `cancelledByUserId?`. Migration
  MUST be reversible. Repository mirrors the prompt/mutation override
  repos (tenant-scoped, `findWithDecryption`).

## Cadence reminder

- **5-Step checkpoint overdue.** Last full-gate checkpoint landed
  after 4.4 (`checkpoint-5step-after-4.4.md`); Phase 2 closed at 4.11;
  Steps 5.1, 5.2, 5.3, 5.4 are the 7th/8th/9th/10th Steps since. Main
  coordinator should run the full validation gate + integration
  suites + ds-guardian sweep BEFORE Step 5.5 touches DB state for the
  mutation gate.
- Phase 3 WS-A (5.1 + 5.2) done; Phase 3 WS-B (5.3 + 5.4) **done**.
  Phase 3 WS-C (5.5–5.14) opens next.

## Environment caveats

- Dev runtime: `bgyb7opzt` on port 3000 — reuse for Phase 5 Step 5.5
  validation.
- Database / migration state: **new migration landed this Step**
  (`Migration20260419132948_ai_assistant`). Snapshot checked in.
  Run `yarn db:migrate` to apply on any env that lagged.
- Typecheck clean (`@open-mercato/core` + `@open-mercato/app`); the
  ai-assistant package still has no `typecheck` script — its Jest
  suite acts as the TS gate via `ts-jest`.
- Task glossary: the Step 5.4 brief used colloquial policy names
  (`write-capable`, `stack-approval`) that do NOT match the actual
  `AiAgentMutationPolicy` enum. Implementation uses the real enum
  (`read-only | confirm-required | destructive-confirm-required`)
  from `lib/ai-agent-definition.ts`; changing the enum is frozen by
  the BC contract, and the spec (§4, §9, §K3) locks the three-value
  form.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
