# Checkpoint 4 — Steps 3.6..3.9 (Phase 3 close)

- **Recorded:** 2026-10-22T16:17:40Z
- **Steps:** 3.6, 3.7, 3.8, 3.9 (commits 03a5ac8eb..86d6c763f)
- **Touched areas:** `packages/ai-assistant`: approver feature + notifications, `GET /ai/actions` + `ai_assistant.get_pending_action`, Pending AI actions backend page + nav badge (UI), docs (`mcp.mdx`, package AGENTS.md, UPGRADE_NOTES), `.env.example` (app + template), MCP spec, Playwright specs `TC-AI-MCP-*`
- **Runner:** local mode; integration against an isolated ephemeral app (`yarn test:integration:ephemeral:start`, own Postgres container, torn down after)

| Check | Result | Notes |
|---|---|---|
| ai-assistant jest (full) | ✅ pass | 135 suites, 1806 tests |
| `yarn build:packages` / `yarn generate` | ✅ pass | no tracked generated drift |
| app typecheck (direct) | ✅ pass | exit 0 |
| `yarn i18n:check-sync` | ✅ pass | |
| `yarn i18n:check-usage` | ✅ pass | no missing keys (unused-key count advisory, pre-existing) |
| Playwright `TC-AI-MCP-*` (ephemeral app, `OM_MCP_MUTATION_MODE=approval`) | ✅ 6 passed, 1 skipped | 013 is deny-mode only; run separately by the Step 3.9 executor with `OM_MCP_MUTATION_MODE=deny`: 1 passed. Log: `checkpoint-4-artifacts/integration-tc-ai-mcp.log` |
| UI screenshot | ✅ captured | `checkpoint-4-artifacts/screenshot-pending-action-approved.png` — detail page after approving from the page |

## Notes for review
- Mutation mode is per process: deny (013) and approval (015/016) tests skip unless the app is started in that mode; CI needs one run per mode to exercise them.
- Requester names resolve through `/api/auth/users` only for callers with `auth.users.list`; others see short ids (visible in the screenshot).
- Known gap: for MCP calls with a server API key bound to a session user (`sessionUserId` ≠ `createdBy`), `get_pending_action` resolves the viewer as `createdBy` while the row's requester is `sessionUserId`; that requester would not see their own row through the tool (they still see it on the page and API). Rare configuration; left for the final review.
