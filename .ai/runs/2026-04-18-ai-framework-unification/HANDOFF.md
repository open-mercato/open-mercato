# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T14:55:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 4 WS-A Step 4.3 **complete** (closes WS-A:
`<AiChat>` + upload adapter + formalized UI-part registry with Phase 3
slots reserved). Next: Phase 4 WS-B Step 4.4 — backend playground page.
**Last commit:** `59f23edac` — `feat(ui): formalize AiChat UI-part registry with Phase 3 slot reservations (Phase 2 WS-A)`

## What just happened

- Step 4.3 landed the formalized UI-part registry:
  - `createAiUiPartRegistry()` — isolated instances for testing / scoped rendering.
  - `defaultAiUiPartRegistry` — global singleton that seeds the four Phase 3
    reserved slots (`mutation-preview-card`, `field-diff-card`,
    `confirmation-card`, `mutation-result-card`) to a shared
    `PendingPhase3Placeholder` DS-compliant info alert.
  - `<AiChat>` gained an optional `registry` prop that overrides the
    default registry. Step-4.1 `registerAiUiPart` / `resolveAiUiPart`
    shims still work.
- New files: `ui-part-slots.ts`, `ui-parts/pending-phase3-placeholder.tsx`,
  3 new test files, `__integration__/TC-AI-UI-003-aichat-registry.spec.tsx`.
- i18n keys added under `ai_assistant.chat.pending_phase3.*` (4 locales).
- Jest run: `packages/ui` `ai/` scope = 6 suites / 45 tests, green.
- Earlier same session:
  - Cleanup commit `bbc63f1da` moved the TC-AI integration specs from
    `.ai/qa/tests/ai-framework/` into their per-module
    `__integration__/` homes per the user's feedback. The spec runner's
    discovery helper already walks `packages/*/src/**/__integration__/**`
    so no Playwright config change was needed.
  - Refactor commit `8afa65d2e` split the verbose skill variant into
    `.ai/skills/auto-create-pr-sophisticated/` and
    `.ai/skills/auto-continue-pr-sophisticated/`; originals restored to
    pre-PR state.

## Next concrete action

- **Step 4.4** — Backend playground page
  `/backend/config/ai-assistant/playground` with:
  - Agent picker that enumerates agents the caller can invoke (reuses
    `meta.list_agents` from Step 3.8).
  - Debug panel toggle (shows `useAiChat`'s last request / response
    payload plus resolved tools & prompt sections).
  - Object-mode runner calling `runAiAgentObject` (Step 3.5).
  - Keyboard shortcuts (`Cmd/Ctrl+Enter` submit, `Escape` cancel) —
    follow `packages/ui/AGENTS.md` dialog conventions.
  - Feature gate: `ai_assistant.settings.manage` (existing, see
    `packages/ai-assistant/src/modules/ai_assistant/acl.ts`).
  - First real browser surface for `<AiChat>`. Executor MUST run a
    Playwright MCP smoke per the UI-step cadence rule (memory:
    `feedback_integration_tests_per_module.md`) and land an integration
    spec under
    `packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-PLAYGROUND-004-playground.spec.ts`.

## Blockers / open questions

- **Dispatcher response shape.** `useAiChat` assumes plain-text streaming
  (`toTextStreamResponse`). If the playground wants to stream `UIMessage`
  chunks for tool calls / usage / parts, migrate the dispatcher to
  `toUIMessageStreamResponse` — flag in 4.4 if it becomes a blocker.
- **Object-mode dispatcher.** Per Step 3.5 decisions, the HTTP route is
  still chat-only. The playground's object-mode lane will call the
  helper directly server-side via a new scoped route (e.g.
  `POST /api/ai_assistant/ai/run-object`) — keep scope small.
- **Integration-test discovery in `packages/ui`.** The CLI discovery
  helper walks `packages/*/src/**/__integration__/**`, so
  `packages/ui/__integration__/` may fall outside the default scope
  (note: lives at `packages/ui/__integration__/`, not
  `packages/ui/src/**`). Verify during 4.4 and add a README redirect or
  move the spec into `packages/ui/src/ai/__integration__/` if discovery
  drops it.

## Environment caveats

- Dev runtime runnable (verified at the Phase 3 WS-C checkpoint).
- Database / migration state: clean, untouched.
- `yarn i18n:check-sync` green after 4.3 keys landed.
- Typecheck clean; the pre-existing `@open-mercato/app`
  `agent-registry.ts(43,7)` diagnostic (Step 3.1 carryover) is
  tolerated.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
