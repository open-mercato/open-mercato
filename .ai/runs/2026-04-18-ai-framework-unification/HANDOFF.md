# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T18:45:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 4 WS-B Step 4.6 **complete** (closes Phase 2
WS-B polish: shared keyboard-shortcut hook, collapsible `<AiChat>` debug
panel, i18n audit). Next: Phase 4 WS-C Step 4.7 — first customers agent
read-only prompt template.
**Last commit:** `ee68a0030` — `feat(ai-assistant): polish Phase 2 WS-B (i18n audit, shared keyboard shortcuts, debug panel)`

## What just happened

- **Shared `useAiShortcuts` hook** under `packages/ui/src/ai/useAiShortcuts.ts`.
  Owns `Cmd/Ctrl+Enter` + `Escape` for every Phase-2 AI surface. Consumed by
  `<AiChat>` (4.1), `AiPlaygroundPageClient` (4.4), and
  `AiAgentSettingsPageClient` (4.5). No per-surface listeners remain.
- **`<AiChat>` debug panel expansion** — collapsible `<details>` sections
  for Resolved tools, Prompt sections, Last request, Last response + a
  persistent Status footer. Two new optional props: `debugTools` and
  `debugPromptSections`. Every section addressable via
  `data-ai-chat-debug-section="…"`.
- **Playground wires the debug data** — converts the selected agent's
  `tools[]` + `systemPrompt` into `AiChatDebugTool[]` + `AiChatDebugPromptSection[]`
  and passes them to `<AiChat>`.
- **Agent picker stays inline** — duplicated `<select>` block in
  playground + settings is under the 50-line threshold. The Step 4.5
  `TODO(step 4.6)` comment was rewritten to document the ongoing
  decision instead of flagging a TODO.
- **i18n audit (Step 4.6 deliverable)** — see `step-4.6-checks.md`. Every
  user-facing literal in Phase-2 UI routes through `useT()`. The few
  remaining non-translatable strings (network error fallbacks, dev-only
  error messages, stubbed API metadata) are justified row-by-row in the
  audit table.
- **19 new i18n keys** under `ai_assistant.chat.debug.*` and
  `ai_assistant.chat.shortcuts.*`, synced across `en/pl/es/de`.
  `yarn i18n:check-sync` green.
- **Unit tests** — 7 for `useAiShortcuts`, 4 for the AiChat debug panel.
  ui package is now 60 suites / 328 tests (baseline 58/317). ai-assistant
  and core baselines preserved (30/353 and 333/3033).
- **Integration tests** — TC-AI-PLAYGROUND-004 toggles the debug panel
  and asserts the three new sections render; TC-AI-AGENT-SETTINGS-005
  adds a `Cmd/Ctrl+Enter` test that fires the placeholder save route.
- **Browser smoke** — `step-4.6-artifacts/playground.png` and
  `step-4.6-artifacts/agents.png` captured against the running
  `yarn dev:app` task on port 3000 (reused, not restarted).

## Next concrete action

- **Step 4.7** — First customers agent with prompt template (read-only).
  Opens Phase 2 WS-C. Lands the first production `ai-agents.ts` in
  `packages/core/src/modules/customers/ai-agents.ts` against the new
  `defineAiAgent()` helper from 2.1. `yarn generate` should surface the
  agent in `ai-agents.generated.ts` so the playground + settings pages
  stop rendering the empty state.
- Keep the agent read-only (`readOnly: true`, `mutationPolicy:
  'read-only'`) and wire it to the customers tool pack shipped in 3.9
  (`customers.list_people`, `customers.list_companies`, `customers.list_deals`,
  `customers.list_activities`, `customers.list_tasks`, `customers.get_person`,
  `customers.get_company`, etc.).
- Include a unit test asserting the agent registers under the expected
  id and that its `allowedTools` resolve against `toolRegistry`.

## Blockers / open questions

- **Dev server HMR did not pick up the new `@open-mercato/ui/ai` export
  automatically** — had to rebuild both `@open-mercato/ui` and
  `@open-mercato/ai-assistant` (`node build.mjs` in each) AND touch
  `apps/mercato/next.config.ts` to bust Turbopack's cached module graph.
  User-held background task on port 3000 (`bk93jo24j`) was reused per
  the brief; the dev server was never restarted. Future Phase-2+ Steps
  that add new exports to `@open-mercato/ui` subpath packages SHOULD
  follow the same rebuild-plus-touch pattern.
- **Resolved-tool `requiredFeatures`** are not yet surfaced by the
  agents list endpoint. The debug panel already renders
  `requiredFeatures` when present — wiring is one `requiredFeatures`
  field away in `GET /api/ai_assistant/ai/agents/route.ts`. Tracked as a
  Phase-3 follow-up in `tool-registry.ts` so the playground and settings
  UIs can display real features once they exist.
- **Old i18n keys kept for BC** — `ai_assistant.chat.debugPanelTitle`
  and `ai_assistant.chat.shortcutHint` still exist in all four locale
  files. The AiChat debug heading now uses
  `ai_assistant.chat.debug.panelTitle`; the old key is retained so any
  third-party consumers referencing it keep working.

## Environment caveats

- Dev runtime reachable. Reused the pre-existing `yarn dev:app` background
  task on port 3000 (task id `bk93jo24j`). No second dev server spawned.
- Database / migration state: clean, untouched.
- `yarn i18n:check-sync` green (46 modules × 4 locales, 163 keys per
  locale for the `ai_assistant` module).
- Typecheck clean; pre-existing `@open-mercato/app`
  `agent-registry.ts(43,7)` diagnostic (Step 3.1 carryover) is tolerated.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
