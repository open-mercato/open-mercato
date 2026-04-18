# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T17:10:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 4 WS-B Step 4.4 **complete** (backend
playground page + `run-object` HTTP route + `agents` list route). Next:
Phase 4 WS-B Step 4.5 — backend agent settings page (prompt overrides,
tool toggles, attachment policy).
**Last commit:** `f62aead47` — `feat(ai-assistant): add backend AI playground page + run-object route (Phase 2 WS-B)`

## What just happened

- Step 4.4 shipped the first real user-facing embedding of `<AiChat>`:
  - New backend page `/backend/config/ai-assistant/playground` guarded
    by `ai_assistant.settings.manage`.
  - Two-tab UX (Chat + Object mode) driven by a single agent picker.
    The chat lane embeds `<AiChat key={agent.id}>` so switching agents
    resets transcript state; the object lane calls the new scoped
    one-shot route.
  - Debug toggle flips `<AiChat debug>` on/off. Empty-state alert when
    no agents are registered. Lane-level disabled alerts when the
    selected agent's `executionMode` does not match the current tab.
- New HTTP routes (both additive):
  - `POST /api/ai_assistant/ai/run-object` — reuses the chat
    dispatcher's auth + policy gate but with
    `requestedExecutionMode: 'object'`, returns `{ object, finishReason?, usage? }`
    via `runAiAgentObject`. Streaming-mode is rejected with 422.
  - `GET /api/ai_assistant/ai/agents` — mirrors the
    `meta.list_agents` tool so the client picker can populate without
    going through the MCP tool transport.
- 32 new `ai_assistant.playground.*` i18n keys, synced across en/pl/es/de.
- Integration spec
  `packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-PLAYGROUND-004-playground.spec.ts`
  stubs `/api/ai_assistant/ai/{agents,chat,run-object}` so CI never
  hits a real LLM provider; asserts picker + debug toggle + composer
  wiring.
- 8 new unit tests under the new route's `__tests__/` (401/400/404/403/422
  happy+sad paths + `AgentPolicyError` mapping + stream-mode rejection).
- **Build fix (also in the same commit):** narrowed
  `packages/ui/src/ai/useAiChat.ts`'s import of `createAiAgentTransport`
  from the `@open-mercato/ai-assistant` root barrel to the subpath
  `@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-transport`.
  Without this the playground page (first app consumer of the
  `@open-mercato/ui/ai` module from a Next.js page) failed `yarn build:app`
  because the barrel transitively pulls `opencode-handlers` and the
  server-only DI container into the client bundle. Three AiChat test
  mock paths updated to match; no public contract change. Also added
  an explicit `./ai` entry to `packages/ui/package.json` exports.

## Next concrete action

- **Step 4.5** — Backend agent settings page at
  `/backend/config/ai-assistant/agents`:
  - Per-agent prompt override editor (versioned, additive merge
    — see spec Phase 3 WS-B rules; Phase 2 may ship UI-only with a
    local-state placeholder pending Phase 3 persistence in Step 5.3).
  - Tool whitelist toggles (`allowedTools` per agent) — read-only
    until Phase 3, but surface the list so operators see what each
    agent invokes.
  - Attachment media-type policy view.
  - Guarded by `ai_assistant.settings.manage`.
  - Reuse the agent picker UX from Step 4.4 (candidate for extracting
    to a shared `<AgentPicker>` primitive under
    `packages/ai-assistant/src/modules/ai_assistant/components/` if
    scope stays small; otherwise duplicate once and extract in 4.6).
  - Integration spec under
    `packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-AGENT-SETTINGS-005-*.spec.ts`.
  - Update `packages/ai-assistant/AGENTS.md` / `.ai/specs/...` as the
    spec requires when the prompt-override contract is first exposed.

## Blockers / open questions

- **Prompt-override persistence.** Spec Phase 3 WS-B (Step 5.3) owns
  the versioned prompt-override storage. Step 4.5 may need to land a
  UI-only surface that POSTs to a TODO endpoint or manages override
  state in local component state pending 5.3. Flag the split when the
  Step 4.5 subagent runs.
- **Agent picker reuse.** Playground's picker is currently a plain
  `<select>` inline in `AiPlaygroundPageClient.tsx`. If Step 4.5
  rebuilds the same UI, extract to a shared primitive before a third
  caller appears.
- **Dev-runtime browser smoke caveat.** This Step's browser-smoke was
  constrained by an unrelated pre-session `next-server` process
  saturating port :3000. The Playwright integration spec (which runs
  against its own Playwright-managed dev server) provides equivalent
  coverage. If this recurs for Step 4.5, document and keep moving.

## Environment caveats

- Dev runtime nominally runnable (the build chain is green). The
  primary-worktree's dev server was stuck at ~120% CPU during the
  Step 4.4 session — if this persists, Step 4.5 should either target
  a different port or ask the user to recycle the dev runtime before
  starting.
- Database / migration state: clean, untouched.
- `yarn i18n:check-sync` green (46 modules × 4 locales including the
  32 new `ai_assistant.playground.*` keys).
- Typecheck clean; pre-existing `@open-mercato/app`
  `agent-registry.ts(43,7)` diagnostic (Step 3.1 carryover) is
  tolerated.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
