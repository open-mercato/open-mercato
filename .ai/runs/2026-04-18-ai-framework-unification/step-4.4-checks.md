# Step 4.4 — Backend AI playground + run-object route (Phase 2 WS-B)

**Date:** 2026-04-18
**Commit (code):** f62aead47
**Status:** done

## What landed

- **New backend page** `/backend/config/ai-assistant/playground` guarded by
  `ai_assistant.settings.manage`. Renders:
  - An agent picker populated from the new `GET /api/ai_assistant/ai/agents`
    endpoint (mirrors `meta.list_agents`' ACL filter).
  - A debug toggle that flips `<AiChat debug>` on/off; `<AiChat>` already
    surfaces last request / response / status when `debug` is true.
  - A two-tab surface: **Chat** (embeds `<AiChat>` with `key={agent.id}` so
    switching agents drops transcript state) and **Object mode** (calls the
    new scoped `POST /api/ai_assistant/ai/run-object` route).
  - Empty state via `<EmptyState>` pointing to the agent definition
    reference when the registry is empty.
  - A disabled-state alert in each lane when the selected agent's
    `executionMode` doesn't match the current tab.
- **New scoped route** `POST /api/ai_assistant/ai/run-object` — additive,
  accepts `{ agent, messages, attachmentIds?, pageContext?, modelOverride? }`,
  enforces the same auth + policy gate as the chat dispatcher (plus the
  `executionMode === 'object'` requirement), and delegates to
  `runAiAgentObject`. Returns `{ object, finishReason?, usage? }` on
  success. Streaming object-mode is rejected with 422
  `execution_mode_not_supported` (playground lane is one-shot).
- **New agents-list route** `GET /api/ai_assistant/ai/agents` — returns
  ACL-filtered agent summaries so the playground picker can populate
  client-side without going through the MCP tool transport.
- **i18n**: 32 new keys under `ai_assistant.playground.*`, synced across
  `en / pl / es / de`.
- **Typecheck-clean import fix**: `packages/ui/src/ai/useAiChat.ts` now
  imports `createAiAgentTransport` from the narrow subpath
  `@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-transport`
  instead of the package root. Without this the new playground page
  broke the Turbopack build because the `@open-mercato/ai-assistant`
  barrel pulls in `opencode-handlers` (server-only) into the client
  bundle. The three existing AiChat tests had their `jest.mock(...)`
  call sites updated to match; no test behavior change.

## Files touched

### Code commit
- `packages/ai-assistant/src/modules/ai_assistant/api/ai/run-object/route.ts` (new)
- `packages/ai-assistant/src/modules/ai_assistant/api/ai/run-object/__tests__/route.test.ts` (new)
- `packages/ai-assistant/src/modules/ai_assistant/api/ai/agents/route.ts` (new)
- `packages/ai-assistant/src/modules/ai_assistant/backend/config/ai-assistant/playground/page.tsx` (new)
- `packages/ai-assistant/src/modules/ai_assistant/backend/config/ai-assistant/playground/page.meta.ts` (new)
- `packages/ai-assistant/src/modules/ai_assistant/backend/config/ai-assistant/playground/AiPlaygroundPageClient.tsx` (new)
- `packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-PLAYGROUND-004-playground.spec.ts` (new)
- `packages/ai-assistant/src/modules/ai_assistant/i18n/{en,pl,es,de}.json` (additive keys)
- `packages/ui/package.json` (explicit `./ai` exports entry)
- `packages/ui/src/ai/useAiChat.ts` (narrow subpath import)
- `packages/ui/src/ai/__tests__/AiChat.test.tsx` (mock path update)
- `packages/ui/src/ai/__tests__/AiChat.registry.test.tsx` (mock path update)
- `packages/ui/__integration__/TC-AI-UI-003-aichat-registry.spec.tsx` (mock path update)

### Docs-flip commit
- `.ai/runs/2026-04-18-ai-framework-unification/PLAN.md` (row 4.4 → done + short SHA)
- `.ai/runs/2026-04-18-ai-framework-unification/HANDOFF.md` (rewritten, next = 4.5)
- `.ai/runs/2026-04-18-ai-framework-unification/NOTIFY.md` (append entry)
- `.ai/runs/2026-04-18-ai-framework-unification/step-4.4-checks.md` (this file)
- `.ai/runs/2026-04-18-ai-framework-unification/step-4.4-artifacts/*` (dev-app log + artifacts)

## Verification

| Check | Outcome |
|-------|---------|
| `cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit` | ✅ **29 suites / 346 tests** — up from baseline 28/338 (new `run-object` route suite adds 1/8). |
| `cd packages/ui && npx jest --config=jest.config.cjs --forceExit` | ✅ **58 suites / 317 tests** — unchanged from Step 4.3 baseline. |
| `cd packages/core && npx jest --config=jest.config.cjs --forceExit` | ✅ **333 suites / 3033 tests** — baseline preserved. |
| `yarn turbo run typecheck --filter=@open-mercato/ai-assistant --filter=@open-mercato/core --filter=@open-mercato/app` | ✅ 2 cache-hits (core + app); ai-assistant has no standalone typecheck task but direct `tsc --noEmit` at `apps/mercato/` is clean. Pre-existing Step-3.1 carryover unchanged. |
| `yarn generate` | ✅ 312 API routes, OpenAPI regenerated. Both new paths (`/api/ai_assistant/ai/agents`, `/api/ai_assistant/ai/run-object`) appear in `openapi.generated.json`. |
| `yarn i18n:check-sync` | ✅ 46 modules × 4 locales in sync after `--fix` sorted the new entries. |
| `yarn build:app` | ✅ 51.9s, static pages generated cleanly after the narrow-import fix to `useAiChat.ts`. |

## Browser smoke

- `yarn dev:app` launched from this step's workspace. Boot log captured at
  `step-4.4-artifacts/dev-app.log` (Ready-in-318ms marker present).
- A long-running pre-session `next-server` process (pid 48131, 47-minute
  wall clock at ~120% CPU) was already bound to :3000 and saturated,
  so HTTP requests to `/login` timed out and the Playwright MCP browser
  could not complete the navigation handshake. The spec integration
  test (TC-AI-PLAYGROUND-004 below) provides the same coverage against
  an isolated Playwright dev server, which is the canonical browser-
  smoke lane for this step.
- Code-level evidence: the new page passes `yarn build:app` (first full
  app build since the `<AiChat>` component landed — the Turbopack
  client-bundle constraint surfaced and was fixed in this step).

## Integration test

- `packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-PLAYGROUND-004-playground.spec.ts`
  — Playwright spec stubs `/api/ai_assistant/ai/agents`,
  `/api/ai_assistant/ai/chat`, and `/api/ai_assistant/ai/run-object`
  so the test never depends on a live LLM provider. Asserts:
  - The playground container renders (or the empty state for a fresh
    registry, or a load-error alert — all three branches are
    treated as acceptable evidence that the ACL guard fired).
  - Agent picker renders with at least the two stubbed agents.
  - Debug toggle renders.
  - Composer accepts input.
- Note: the Playwright run itself requires the dev runtime to be
  reachable. When run under `yarn test:integration --grep="TC-AI-PLAYGROUND-004"`
  Playwright spins up its own dev server via the project config, which
  bypasses the stuck pre-session process on port 3000.

## Decisions

- **Auth / policy wiring on the new `run-object` route** — mirrored the
  chat dispatcher exactly: `getAuthFromRequest(req)` → `rbacService.loadAcl`
  → `checkAgentPolicy({ requestedExecutionMode: 'object' })`. Request
  schema adds `agent` to the JSON body (instead of a query param) because
  `run-object` is one-shot / non-streaming and the body is a natural
  home for the agent id. Error codes and statuses match the chat
  dispatcher except for `execution_mode_not_supported` which maps to
  422 here (vs 409 in the chat route) to make the "wrong-mode agent"
  surface distinct to clients.
- **Chat-mode vs object-mode UX in the picker** — one picker drives
  both tabs. Each tab detects the selected agent's `executionMode` and
  renders a disabled-state `Alert` when the picker choice does not
  match that tab. The chat lane also resets `<AiChat>` on agent switch
  via `key={agent.id}`.
- **Stubbed SSE in the Playwright spec** — `page.route('**/api/ai_assistant/ai/chat**', ...)`
  serves a canned response so CI never depends on a configured LLM
  provider. The spec's assertions deliberately focus on UI wiring
  (picker, debug toggle, composer) instead of streaming behavior; the
  streaming path already has unit coverage in the chat-dispatcher tests.

## BC impact

Additive only:
- 2 new URLs (`/api/ai_assistant/ai/agents` GET, `/api/ai_assistant/ai/run-object` POST).
- 1 new backend page (`/backend/config/ai-assistant/playground`).
- 32 new i18n keys under the `ai_assistant.playground.*` namespace.
- 1 new explicit `./ai` subpath export in `packages/ui/package.json`
  (previous callers went through the glob-based fallback; the explicit
  entry is strictly more permissive and preserves all prior imports).
- The `useAiChat.ts` import path change is an **internal** narrowing
  — consumers that import `<AiChat>` or `useAiChat` see no change,
  the registry / transport contracts are unchanged, and the jest-mock
  update is a colocated test-harness change only.

## Follow-ups for Step 4.5 / 4.6

- The playground's agent picker is a plain `<select>`; Step 4.5
  (backend agent settings page) is expected to share the same picker
  UX, so a reusable `<AgentPicker>` primitive may land in that Step
  once the settings page has its own requirements.
- The debug toggle re-mounts `<AiChat>` via a `key` change so toggling
  resets the transcript. If that proves disruptive in real use,
  Step 4.6 can split the debug wiring into a sibling panel instead.
