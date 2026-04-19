# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-19T10:20:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 5 Step 5.3 **complete**. Phase 3 WS-B is
now partially landed — versioned prompt-override persistence + additive
merge rules are live end-to-end. Next: Step 5.4 — surface
`mutationPolicy` as a feature-gated field in the settings UI (separate
from the prompt editor) so Phase 3 WS-B closes before the pending-action
entity lands in Step 5.5.
**Last commit (code):** `656158c98` — `feat(ai-assistant): versioned prompt override persistence + merge rules (Phase 3 WS-B)`

## What just happened

- New MikroORM entity `AiAgentPromptOverride` under
  `packages/ai-assistant/src/modules/ai_assistant/data/entities.ts`
  (+ a neighbor re-export file under
  `data/entities/AiAgentPromptOverride.ts` so call sites can import by
  name). Migration landed at
  `packages/ai-assistant/src/modules/ai_assistant/migrations/Migration20260419100521.ts`
  (clean, reversible, table + 2 indexes + 1 unique constraint).
  Snapshot checked in alongside.
- `AiAgentPromptOverrideRepository` exposes `getLatest` / `save` /
  `listVersions`. Save allocates the next monotonic version inside
  `em.transactional` (the `withAtomicFlush` helper is spec-only today;
  the unique constraint on `(tenantId, organizationId, agentId, version)`
  turns any concurrent write into a DB-level error instead of silent
  double-v1). Reads always go through `findOneWithDecryption` /
  `findWithDecryption`.
- `lib/prompt-override-merge.ts` implements additive merge: canonical
  section keys APPEND below the built-in content with a blank-line
  separator; brand-new header keys land after RESPONSE STYLE; reserved
  policy keys (`mutationPolicy`, `readOnly`, `allowedTools`,
  `acceptedMediaTypes`) throw `PromptOverrideReservedKeyError`. The
  helper also exports `composeSystemPromptWithOverride` for callers that
  hold a plain-string base prompt (today: every shipped agent).
- `POST /api/ai_assistant/ai/agents/:agentId/prompt-override` now
  persists and returns `{ ok: true, agentId, version, updatedAt }`.
  Body accepts both `sections` (canonical) and `overrides` (Step-4.5
  alias) so old clients keep working. Reserved-key payloads 400 with
  `code: 'reserved_key'`. Unknown agent IDs 404 with
  `code: 'agent_unknown'`.
- `GET` on the same route returns
  `{ agentId, override: <latest> | null, versions: [...] }` (newest
  first, capped at 10). Feature gate stays `ai_assistant.settings.manage`.
- Runtime wiring: `agent-runtime.ts` now layers the latest tenant-scoped
  override onto the built-in `systemPrompt` via
  `composeSystemPrompt` → `resolveBaseSystemPromptWithOverride`. Both
  `runAiAgentText` and `runAiAgentObject` share the helper so chat-mode
  and object-mode stay in lock-step (Step 3.6 parity contract). Lookup
  failures log at `warn` and fall back to the built-in prompt —
  chat turns never fail on override lookup.
- Settings page (`AiAgentSettingsPageClient.tsx`) hydrates current +
  history via GET, saves via POST, surfaces success via a success alert
  with the new version number, and shows the last-5 history rows inside
  a new `data-ai-agent-override-history` section. Reserved-key errors
  surface an i18n-keyed destructive alert. BC: the Save button now reads
  both the old `pending: true` and new `{ ok: true, version }` response
  shapes so pre-Step-5.3 deployments keep working.
- Integration spec `TC-AI-AGENT-SETTINGS-005` gains two scenarios:
  happy-path save surfacing `data-ai-agent-override-history-row="1"`,
  and reserved-key POST surfacing the i18n-keyed destructive alert.
- i18n: 13 new keys under `ai_assistant.agents.override.*` with full
  translations for en / pl / es / de. The Step-4.5 "local-only today"
  copy was also refreshed in all four locales.
- Test deltas:
  - ai-assistant: 31 / 363 → **33 / 386** (+2 / +23). New suites:
    `prompt-override-merge` (11), `AiAgentPromptOverrideRepository` (7),
    `route.test.ts` (12 — 8 pre-existing reshaped + 4 new).
  - core: 338 / 3094 preserved.
  - ui: 60 / 328 preserved.
- Typecheck (`@open-mercato/core` + `@open-mercato/app`) green;
  `yarn generate` green with no drift; `yarn db:generate` emitted the
  migration; `yarn i18n:check-sync` green (46 modules × 4 locales).

## Open follow-ups carried forward

- **Step 5.4** is the next natural stop: surface `mutationPolicy` as a
  feature-gated field in the settings UI so Phase 3 WS-B closes with
  both its WS-B deliverables (versioned persistence + mutation-policy
  UI) before Step 5.5 touches DB state for `AiPendingAction`.
- **`agent-runtime.ts` `resolveAgentModel` migration** still deferred
  from Step 5.1. A later Step should migrate it to
  `createModelFactory(container)` so chat-mode and object-mode runs
  honor `<MODULE>_AI_MODEL` via the shared port.
- **Runtime signature extension** for `AiAgentPageContextInput` —
  the merchandising agent's sheet already carries
  `pageContext.extra.filter` client-side, but the current hook only
  forwards `entityType` + `recordId`. When a Step needs the filter
  server-side (e.g., the D18 bulk-edit flow), widen the shape in
  `packages/ai-assistant/.../ai-agent-definition.ts` additively and
  re-wire the merchandising hydrator to surface it.
- **`inbox_ops/ai-tools.ts` + `translationProvider.ts`** still call
  `resolveExtractionProviderId` + `createStructuredModel` directly.
  Revisit in or after Step 5.4.
- **Portal customer login UI helper** still missing from
  `packages/core/src/modules/core/__integration__/helpers/` — carried
  from Phase 2. TC-AI-INJECT-010 retains its deferred-UI-smoke
  placeholder.
- **Dedicated portal `ai_assistant.view` feature** — still gated on
  `portal.account.manage`; tighten in a later Phase 5 Step.

## Next concrete action

- **Step 5.4** — Spec Phase 3 WS-B — surface `mutationPolicy` as a
  feature-gated field in the settings UI. The Step 5.3 history panel +
  save machinery is already in place, so 5.4 is scoped to:
  1. A new UI section inside `AgentDetailPanel` exposing the current
     `mutationPolicy` value and (for callers holding a new feature like
     `ai_assistant.settings.manage_mutation_policy`) an editable
     dropdown with `read-only` / `confirm-required` /
     `destructive-confirm-required`.
  2. A `PATCH` or dedicated route that persists the chosen policy
     per tenant + agent (reusing the same repository pattern as 5.3),
     with hard validation that the policy cannot be loosened beyond
     the agent definition's declared ceiling.
  3. i18n keys under `ai_assistant.agents.mutationPolicy.*` across the
     four locales.

## Cadence reminder

- **5-Step checkpoint overdue.** Last full-gate checkpoint landed
  after 4.4 (`checkpoint-5step-after-4.4.md`); Phase 2 closed at 4.11;
  Steps 5.1, 5.2, 5.3 are the 7th, 8th, 9th Steps since. Main
  coordinator should run the full validation gate + integration suites
  + ds-guardian sweep before Step 5.5 touches DB state for the
  mutation gate, and MUST do so before the mutation-gate work lands
  in Step 5.5.
- Phase 3 WS-A (5.1 + 5.2) is done; Phase 3 WS-B is now half-done
  (5.3 landed; 5.4 remaining). The next natural pause is after Step
  5.4 so Phase 3 WS-B closes before the pending-action entity lands.

## Environment caveats

- Dev runtime: `bgyb7opzt` on port 3000 — reuse for Phase 5 Step 5.4
  validation.
- Database / migration state: **new migration landed this Step**
  (`Migration20260419100521_ai_assistant`). Snapshot checked in.
  Run `yarn db:migrate` to apply on any env that lagged.
- Typecheck clean (`@open-mercato/core` + `@open-mercato/app`); the
  ai-assistant package still has no `typecheck` script — its Jest
  suite acts as the TS gate via `ts-jest`.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
