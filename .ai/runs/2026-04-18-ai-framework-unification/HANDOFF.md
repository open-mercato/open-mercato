# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T18:15:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 4 WS-B Step 4.5 **complete** (backend AI agent
settings page + prompt-override placeholder route). Next: Phase 4 WS-B
Step 4.6 — i18n keys, keyboard shortcuts, debug support polish; closes
Phase 2 WS-B.
**Last commit:** `ce011a9e5` — `feat(ai-assistant): add backend AI agent settings page + prompt-override placeholder route (Phase 2 WS-B)`

## What just happened

- Step 4.5 shipped the operator-facing agent configuration page at
  `/backend/config/ai-assistant/agents`, guarded by
  `ai_assistant.settings.manage`:
  - Agent picker + metadata panel with `StatusBadge`s for `executionMode`
    and `mutationPolicy`, plus `readOnly` / `maxSteps` display.
  - Prompt-sections editor covering all eight `PromptSectionName` ids
    from spec §8 (`role`, `scope`, `data`, `tools`, `attachments`,
    `mutationPolicy`, `responseStyle`, `overrides`). Each section has a
    Default/Override toggle; Override drafts live in React state only.
  - Persistent info `Alert` pointing at the Phase-3 roadmap (Step 5.3 owns
    the versioned persistence).
  - Read-only allowed-tools list with `Mutation`/`Read` `StatusBadge`, an
    always-on disabled `Enabled` switch, and a `Tooltip` explaining
    "Editable after Phase 3 lands mutation policy controls."
  - Attachment media-type badges driven by `acceptedMediaTypes`.
- New placeholder route `POST /api/ai_assistant/ai/agents/:agentId/prompt-override`:
  - Validates the agent via the registry. 401 / 403 / 404 / 400 error paths.
  - Returns `200 { pending: true, agentId, message: 'Persistence lands in
    Phase 3 Step 5.3.' }`. No DB writes, no events.
- `GET /api/ai_assistant/ai/agents` extended **additively** with
  `systemPrompt`, `readOnly`, `maxSteps`, and `tools[]` (each entry
  exposing `{ name, displayName, isMutation, registered }`). The playground
  client still compiles unchanged.
- Sidebar now shows both "AI Playground" (431) and "AI Agents" (432) under
  the Module Configs section — confirmed live in the browser smoke at
  `step-4.5-artifacts/browser-smoke.png`.
- 50 new `ai_assistant.agents.*` i18n keys, synced across `en/pl/es/de`.
- Integration spec
  `packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-AGENT-SETTINGS-005-settings-page.spec.ts`
  stubs `/api/ai_assistant/ai/agents` + `/prompt-override`; asserts both
  the empty-state branch and the unauthenticated-redirect contract.
- 7 new unit tests for the placeholder route (401/403/404/400×2/200/superadmin).
- Deliberate duplication: the `<select>` agent picker is duplicated once
  between the playground (4.4) and the settings page (4.5). A `TODO(step 4.6)`
  comment in `AiAgentSettingsPageClient.tsx` flags the extraction point
  once the duplication grows. Step 4.5 brief authorized this decision
  because the duplicated block is under 50 lines.

## Next concrete action

- **Step 4.6** — i18n keys, keyboard shortcuts, debug support polish
  (closes Phase 2 WS-B):
  - Extract the shared `<AgentPicker>` primitive so the playground and
    settings page stop duplicating the `<select>` markup (the TODO comment
    in `AiAgentSettingsPageClient.tsx` names the extraction spot).
  - Expand keyboard-shortcut coverage across the playground + settings
    page (Cmd/Ctrl+S as save alias, Escape behavior on the settings
    drawer / picker, consistent Cmd+K behavior with the command palette).
  - Consolidate the debug-panel surface so it's a sibling panel instead
    of forcing `<AiChat>` re-mount on toggle (decision deferred from 4.4).
  - Promote any playground- or settings-only i18n keys into shared
    namespaces if 4.6 finds overlap; otherwise leave per-page keys as-is.
  - Integration spec under `TC-AI-UI-POLISH-006-*.spec.ts`.

## Blockers / open questions

- **Prompt-override persistence is still stubbed.** Step 5.3 (Phase 3 WS-B)
  owns the versioned storage. Until 5.3 lands, the settings page's "Save
  overrides" button POSTs to the placeholder route and relies on the
  local-state React drafts. No regression risk because no prior consumers
  exist.
- **Agent-definition does not yet expose `PromptTemplate.sections`.** The
  Default panel quotes `systemPrompt` once (under the `role` section) and
  shows a Phase-3-deferred placeholder for the other seven slots. When
  5.3 lands, the settings page will want to wire real per-section copy —
  track as a Phase 3 follow-up.

## Environment caveats

- Dev runtime reachable. Reused the pre-existing `yarn dev:app` background
  task on port 3000 (task id `bk93jo24j`) for the browser smoke — no
  second dev server spawned.
- Had to run `node build.mjs` inside `packages/ai-assistant` once to
  hydrate `dist/modules/.../agents/` so the package-exports `./*/*/*/*/*/*/*`
  fallback can resolve the new page route at runtime. Future Phase-2
  Steps that add new backend pages MAY need the same rebuild step until
  the ai-assistant package ships a dev-mode fallback that resolves to
  `src/` directly.
- Database / migration state: clean, untouched.
- `yarn i18n:check-sync` green (46 modules × 4 locales, 50 new
  `ai_assistant.agents.*` keys).
- Typecheck clean; pre-existing `@open-mercato/app`
  `agent-registry.ts(43,7)` diagnostic (Step 3.1 carryover) is tolerated.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
