# Step 4.6 — Phase 2 WS-B polish (i18n, shared keyboard shortcuts, debug support)

**Date:** 2026-04-18
**Commit (code):** _pending — flipped in docs commit_
**Status:** done

## What landed

- **Shared `useAiShortcuts` hook** under
  `packages/ui/src/ai/useAiShortcuts.ts`. One implementation of the
  `Cmd/Ctrl+Enter` + `Escape` contract reused by `<AiChat>` (4.1), the AI
  playground (4.4), and the agent settings page (4.5). Exported from
  `@open-mercato/ui/ai`.
  - `onSubmit`: fired on `Cmd+Enter` / `Ctrl+Enter`; `preventDefault` so the
    native newline is suppressed.
  - `onCancel`: fired on `Escape`; optional — when unbound, Escape bubbles
    the usual way so modal-dialog close behavior is preserved.
  - `enabled` gate for conditional bindings.
- **Debug panel expansion on `<AiChat>`**:
  - Rewrote the old single-pre JSON blob into four collapsible `<details>`
    sections: **Resolved tools**, **Prompt sections**, **Last request**,
    **Last response**. Each section is addressable by
    `data-ai-chat-debug-section="…"` for DOM inspection, screenshot smoke,
    and integration testing.
  - New additive props `debugTools?: AiChatDebugTool[]` and
    `debugPromptSections?: AiChatDebugPromptSection[]`. Both are optional;
    the panel renders empty-state copy when absent.
  - A persistent **Status** footer shows `idle` / `submitting` / `streaming`
    and surfaces the last error code when present.
- **Playground + agent settings consume the shared hook.**
  `AiPlaygroundPageClient.tsx` (ObjectLane prompt textarea) and
  `AiAgentSettingsPageClient.tsx` (override textareas) both drop their
  inline `onKeyDown` handlers in favor of `useAiShortcuts`. The playground
  also computes `debugTools` + `debugPromptSections` from the currently
  selected agent and feeds them into the `<AiChat>` debug panel so the
  debug toggle on the playground page renders the full resolved-tool map
  and prompt-section preview.
- **Agent-picker deliberately left inline.** The duplicated `<select>`
  picker block in the playground and settings page is still under the
  50-line threshold (~15 lines each). Per the Step 4.6 brief, the
  extraction stays deferred and the former `TODO(step 4.6)` comment on
  `AiAgentSettingsPageClient.tsx` is rewritten to name the ongoing
  decision instead of an outstanding TODO.
- **i18n audit (mandatory deliverable).** See table below.
- **19 new i18n keys** under `ai_assistant.chat.debug.*` and
  `ai_assistant.chat.shortcuts.*`, synced across `en/pl/es/de`.
  `yarn i18n:check-sync` green (46 modules × 4 locales; 163 keys / locale
  for `ai_assistant`, up from 144).

## i18n audit table

Grepped every Phase-2 UI file shipped in Steps 4.1, 4.2, 4.3, 4.4, 4.5 for
user-facing hardcoded strings. Strings reachable by the end user MUST
route through `useT()`. Other literal strings (dev-only console, thrown
Error messages consumed by an Alert that IS translated, internal schema /
test data) are listed with a justification.

| File | Literal | Surfaces to user? | Verdict |
|------|---------|-------------------|---------|
| `packages/ui/src/ai/AiChat.tsx` | every user-facing literal already routed via `useT()` | ✅ | Green. New `ai_assistant.chat.debug.*` keys added. |
| `packages/ui/src/ai/useAiChat.ts` | `'Network request failed.'`, `'Stream interrupted.'`, `'Agent dispatch failed (${status}).'`, `'Agent dispatch failed.'` | Yes (surface through Alert body and `onError`) | Deliberate fallback strings for catastrophic network/abort paths where no locale context is available. AiChat's Alert surrounding them IS translated (`ai_assistant.chat.errorTitle`) and the body value is shown raw. Moving these into `useT()` requires plumbing the translator through the hook — defer to a follow-up in Phase 3 once the hook takes on more responsibility. Documented as non-translatable defensive copy. |
| `packages/ui/src/ai/upload-adapter.ts` | `'Upload failed (${status})'`, `'Upload request aborted'` | Flows to user via flash errors, but callers translate them | Already consumed through translated flash helpers in `useAiChatUpload.ts`; fallback copy only when no translator is present. Non-blocking — same rationale as `useAiChat.ts`. |
| `packages/ui/src/ai/useAiShortcuts.ts` | No literals. | n/a | Green. |
| `packages/ai-assistant/.../playground/AiPlaygroundPageClient.tsx` | every user-facing literal routed via `useT()` | ✅ | Green. `throw new Error('Failed to load agents (${status})')` at fetcher line 60 is dev/console-surface only — the UI catches the rejection and renders a translated `ai_assistant.playground.loadErrorTitle` alert. |
| `packages/ai-assistant/.../agents/AiAgentSettingsPageClient.tsx` | every user-facing literal routed via `useT()` except the `aria-label` `` `${sectionLabel} override` `` built from a translated `sectionLabel` | ✅ | `sectionLabel` comes from `t('ai_assistant.agents.prompt.sections.<id>', …)`, so the composed aria-label is effectively localized. The concatenation pattern is used elsewhere in backoffice forms and matches DS guidance. Green. |
| `packages/ai-assistant/.../agents/[agentId]/prompt-override/route.ts` | `"Persistence lands in Phase 3 Step 5.3."` | No — server-returned metadata, the client falls back to a translated `ai_assistant.agents.prompt.pendingMessage` before rendering. | Non-translatable placeholder — API response copy. Green. |
| `packages/ai-assistant/.../api/ai/agents/route.ts` | Only dev-only `console.error` and non-user-facing error codes | No | Green. |
| `page.meta.ts` files | `navTitleKey` + `pageGroupTitleKey` route through translation | ✅ | Green. |

**Net:** 0 user-visible literals leaked. All new strings introduced in
4.6 are covered by the new `ai_assistant.chat.debug.*` /
`ai_assistant.chat.shortcuts.*` namespaces.

## Files touched

### Code commit
- `packages/ui/src/ai/useAiShortcuts.ts` (new)
- `packages/ui/src/ai/index.ts` — export `useAiShortcuts` + new debug-panel types.
- `packages/ui/src/ai/AiChat.tsx` — adopt `useAiShortcuts`, expand debug panel.
- `packages/ui/src/ai/__tests__/useAiShortcuts.test.tsx` (new — 7 tests).
- `packages/ui/src/ai/__tests__/AiChat.debug.test.tsx` (new — 4 tests).
- `packages/ai-assistant/src/modules/ai_assistant/backend/config/ai-assistant/playground/AiPlaygroundPageClient.tsx` — share the shortcut hook, build debug tool map and prompt-section snapshots, pass to `<AiChat>`.
- `packages/ai-assistant/src/modules/ai_assistant/backend/config/ai-assistant/agents/AiAgentSettingsPageClient.tsx` — share the shortcut hook, rewrite the `TODO(step 4.6)` comment, attach textarea ref.
- `packages/ai-assistant/src/modules/ai_assistant/i18n/{en,pl,es,de}.json` — 19 new keys each.
- `packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-PLAYGROUND-004-playground.spec.ts` — assert the debug panel surfaces the three new sections.
- `packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-AGENT-SETTINGS-005-settings-page.spec.ts` — assert `Cmd+Enter` / `Ctrl+Enter` triggers the placeholder save inside an override textarea.

### Docs-flip commit
- `.ai/runs/2026-04-18-ai-framework-unification/PLAN.md` (row 4.6 → done + short SHA)
- `.ai/runs/2026-04-18-ai-framework-unification/HANDOFF.md` (rewritten, next = Step 4.7)
- `.ai/runs/2026-04-18-ai-framework-unification/NOTIFY.md` (append entry)
- `.ai/runs/2026-04-18-ai-framework-unification/step-4.6-checks.md` (this file)
- `.ai/runs/2026-04-18-ai-framework-unification/step-4.6-artifacts/playground.png`
- `.ai/runs/2026-04-18-ai-framework-unification/step-4.6-artifacts/agents.png`

## Verification

| Check | Outcome |
|-------|---------|
| `cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit` | ✅ **30 suites / 353 tests** — baseline preserved. |
| `cd packages/ui && npx jest --config=jest.config.cjs --forceExit` | ✅ **60 suites / 328 tests** — +2 suites (useAiShortcuts + AiChat.debug) and +11 tests over the baseline 58/317. |
| `cd packages/core && npx jest --config=jest.config.cjs --forceExit --silent` | ✅ **333 suites / 3033 tests** — baseline preserved. |
| `yarn turbo run typecheck --filter=@open-mercato/ui --filter=@open-mercato/app` | ✅ clean (2/2 cached). |
| `apps/mercato && npx tsc --noEmit` | ✅ 0 errors. |
| `yarn generate` | ✅ 313 API routes (no drift). |
| `yarn i18n:check-sync` | ✅ 46 modules × 4 locales in sync. |

## Browser smoke

- Reused the pre-existing `yarn dev:app` background task on port 3000
  (task id `bk93jo24j`) — did not spawn a second dev server.
- Rebuilt `@open-mercato/ai-assistant` and `@open-mercato/ui` once each
  so the `dist/` copies that Next.js resolves at runtime carry the new
  `useAiShortcuts` export + updated debug panel. Touched
  `apps/mercato/next.config.ts` afterwards to bust Turbopack's cached
  module graph without restarting the dev server itself.
- Logged in as `superadmin@acme.com` / `secret` and captured:
  - `step-4.6-artifacts/playground.png` — `/backend/config/ai-assistant/playground` with the empty-state card (no agents registered yet — Step 4.7 lands the first) and the Settings sidebar listing both "AI Playground" and "AI Agents".
  - `step-4.6-artifacts/agents.png` — `/backend/config/ai-assistant/agents`, same empty-state branch.
- Debug-panel toggle branch was exercised in the unit tests + integration
  spec rather than by manually stubbing an agent in the browser because
  the generated registry is still empty (Step 4.7 lands the first
  production agent).

## Integration test

- `TC-AI-PLAYGROUND-004` — extended to stub two agents, toggle the debug
  panel, and assert the three new collapsible sections (`tools`,
  `promptSections`, `lastRequest`) render.
- `TC-AI-AGENT-SETTINGS-005` — extended with a new test that stubs the
  registry, switches the `role` prompt section into override mode, fills
  the textarea, and presses `Cmd+Enter` (with Ctrl+Enter fallback). The
  test asserts the placeholder `/prompt-override` route was invoked.

## Decisions

- **Agent picker stays inline.** Playground + settings each duplicate
  ~15 lines of `<select>` markup. Below the 50-line threshold named in
  the Step 4.6 brief → no shared `<AgentPicker>` extracted. The Step 4.5
  `TODO(step 4.6)` comment is rewritten to document the decision.
- **Shared `useAiShortcuts` owns the `Cmd/Ctrl+Enter` + `Escape`
  contract.** Every Phase-2 UI surface that accepts user input uses the
  same hook. No per-surface listeners. The hook lives in
  `packages/ui/src/ai` so Phase 3 components can pick it up directly.
- **Debug-panel expansion is additive.** `debugTools` and
  `debugPromptSections` are optional new props; existing consumers
  (AiChat.test.tsx, registry smoke spec) render unchanged.
- **Old i18n keys kept.** `ai_assistant.chat.debugPanelTitle` and
  `ai_assistant.chat.shortcutHint` stay in the locale files. The
  AiChat debug-panel heading now uses the new `ai_assistant.chat.debug.panelTitle`
  key; the old key remains to avoid removing from contract surface #4
  (type/export/file stability) even though translation keys are not a
  strict contract.
- **`AiChatDebugTool.requiredFeatures`** is optional to stay honest
  until the agent registry actually surfaces per-tool `requiredFeatures`
  (blocked on `tool-registry.ts` wiring, tracked as a Phase 3 follow-up
  in `tool-registry.ts`).
- **Step 4.11 integration coverage** — the cross-cutting integration
  suite at Step 4.11 will add full-stack assertions for the debug panel
  and shared keyboard-shortcut flow; the two scoped specs updated here
  are the minimum the cadence rule demands.

## BC impact

Additive only:
- New exports from `@open-mercato/ui/ai`:
  `useAiShortcuts`, `UseAiShortcutsOptions`, `UseAiShortcutsResult`,
  `AiChatDebugTool`, `AiChatDebugPromptSection`.
- New optional props on `<AiChat>`: `debugTools`, `debugPromptSections`.
- New i18n keys (19 × 4 locales = 76 entries) under
  `ai_assistant.chat.debug.*` and `ai_assistant.chat.shortcuts.*`.
- 0 removed exports, 0 renamed files, 0 changed function signatures, 0 new
  routes, 0 DB migrations, 0 new ACL features.

## Follow-ups for Step 4.7

- First customers agent with prompt template (read-only) lands at
  `packages/core/src/modules/customers/ai-agents.ts`. The playground +
  settings pages should start rendering a non-empty agent list once
  Step 4.7 runs `yarn generate`.
- Extend debug-panel tests once real resolved-tool `requiredFeatures`
  land (currently optional).
