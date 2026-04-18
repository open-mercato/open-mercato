# 5-Step Full-Gate Checkpoint — after Step 4.4

**Timestamp:** 2026-04-18T19:10:00Z
**HEAD at start:** `18cb4bd8a` (Step 4.4 browser smoke)
**HEAD at end:** `0a6b22e76` (TC-AI flake fixes)
**Branch:** `feat/ai-framework-unification`, local == origin

## Why

User rule: after every 5 completed Steps, run the full gate and make
everything green (i18n, unit, typecheck, build, integration). Steps
since last checkpoint: 3.13, 4.1, 4.2, 4.3, 4.4 = 5. Checkpoint due.

## Gate results

| Check | Outcome | Notes |
|-------|---------|-------|
| `yarn build:packages` | ✅ | 18 tasks |
| `yarn generate` | ✅ | 312 API paths, new `/api/ai_assistant/ai/run-object` + `/api/ai_assistant/ai/agents` emitted |
| `yarn typecheck` | ✅ | pre-existing `agent-registry.ts(43,7)` Step-3.1 carryover still tolerated |
| `yarn test` (full monorepo) | ✅ | 19 packages, all pass |
| `yarn i18n:check-sync` | ✅ | 46 modules × 4 locales in sync |
| `yarn i18n:check-usage` | ✅ | advisory baseline 3956 unused keys (+14 from Step 4.3 additions, expected) |
| `yarn build:app` | ✅ | 40s |
| `yarn test:integration --grep="TC-AI"` | ✅ | **7/7** pass after flake fixes (initially 2 failed) |

## Drift surfaced and fixed

1. **Stale next-server process on port 3000** blocking `yarn dev:app`. Killed pid 48131 (62min runtime, ~120% CPU). Unrelated to this PR.
2. **Stale auto-skill worktrees** (`pr-1372`, `pr-1523`, `pr-1526`) carried private `node_modules/playwright` copies that made `@playwright/test` register twice when `yarn test:integration` loaded the shared config. Removed the `node_modules` inside each stale worktree (keeping the worktrees themselves for user review).
3. **TC-AI-001 wrong-password test** had two bugs:
   - `waitForSelector('form[data-auth-ready="1"]')` used `.catch(() => null)`, so when dev cold-compile exceeded 5s the test clicked a still-disabled submit button.
   - Cookie-consent + demo-environment fixed banners overlay the submit region and intercepted pointer events.
   - Fix: make hydration wait mandatory with a 30s timeout, switch to `form.requestSubmit()` instead of clicking the button, and raise the per-test timeout to 60s.
4. **TC-AI-002 unauthenticated-caller test** had two bugs:
   - The shared `request` fixture carried the superadmin session cookie from earlier `getAuthToken` calls, so the "unauth" probe was actually authenticated.
   - The framework-level `requireAuth` page guard short-circuits before the route handler runs; its 401 envelope is `{error:"Unauthorized"}`, not the route's `{code:"unauthenticated"}`.
   - Fix: use `playwrightRequest.newContext()` for an isolated cookie jar, and accept either the framework or route-level envelope.

## Artifacts

All under `checkpoint-5step-after-4.4-artifacts/`:
- `build-packages.log`, `generate.log`, `typecheck.log`, `unit-tests.log`, `i18n-sync.log`, `build-app.log` — gate raw output.
- `integration-tc-ai.log`, `integration-tc-ai-retry.log`, `integration-tc-ai-retry2.log`, `integration-tc-ai-retry3.log`, `integration-tc-ai-final.log` — the flake-fix iterations.

## Next action

Step 4.5 — Backend agent settings page at `/backend/config/ai-assistant/agents` (prompt overrides + tool toggles + attachment policy). UI-step per the cadence rule — requires browser smoke + per-module integration spec under `packages/ai-assistant/src/modules/ai_assistant/__integration__/`.
