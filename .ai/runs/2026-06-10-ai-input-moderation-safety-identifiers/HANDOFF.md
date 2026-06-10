# Handoff — 2026-06-10-ai-input-moderation-safety-identifiers

**Last updated:** 2026-06-10T14:06:26Z
**Branch:** feat/ai-input-moderation-safety-identifiers (pushed to `fork`)
**PR:** not yet opened (opens after final gate)
**Current phase/step:** Phase 3 steps 3.1–3.7 complete. Next: Step 3.8 (needs the ephemeral DB/app integration stack).
**Last commit:** dfc373e4e — docs(ai-assistant): moderation docs page + AGENTS.md section

## What just happened
- 3.1–3.5 (see checkpoint-3), 3.6 moderation-flags audit DataTable page + nav, 3.7 docs page (`apps/docs/docs/framework/ai-assistant/moderation.mdx` + sidebar) + AGENTS.md section.
- After 3.6 and 3.7: full typecheck 21/21 clean, i18n sync clean. (Two quick in-step typecheck fixes folded in: `[OptionalProps]` on the entity at 3.5-fix; `PaginationProps.totalPages` on the audit table.)

## Next concrete action
- Step 3.8: API integration tests under the module's `__integration__/` (or `.ai/qa/tests/`) per `.ai/qa/AGENTS.md` — self-contained (API fixtures + `finally` teardown):
  1. `PUT /api/ai_assistant/settings` with `inputModeration` → `GET` reflects effective per-agent policy; reset to inherit in teardown.
  2. `GET /api/ai_assistant/moderation-flags` — a flag created for tenant A is visible to A only; tenant B gets an empty list (isolation probe).
  Then Step 3.9 (Playwright: chat enforced→rejection with stubbed moderation, chat off→reaches mock model, settings UI toggle + enforced badge).
- These steps + the final gate's `yarn test:integration` need the ephemeral Postgres + app stack — run them where that stack is available.

## Remaining steps
- 3.6 audit DataTable page + nav
- 3.7 docs page under apps/docs/docs/framework/ai-assistant/ + AGENTS.md update + yarn generate
- 3.8 API integration tests (settings inputModeration roundtrip; moderation-flags tenant isolation probe) — self-contained per .ai/qa/AGENTS.md
- 3.9 Playwright integration tests (chat enforced→rejection stubbed, chat off→reaches mock model, settings UI toggle + enforced badge)
- Final gate (step 7): full validation gate + yarn test:integration + yarn test:create-app:integration (likely skip — document) + ds-guardian; then open PR to upstream develop.

## Key wiring already in place (for later steps)
- GET `/api/ai_assistant/settings` returns per-agent `moderation: { enforced, override, effective }`.
- `AiModerationFlagRepository.list({ tenantId, organizationId?, agentId?, userId?, from?, to?, page, pageSize })` → `{ items, total }`.
- Route `GET /api/ai_assistant/moderation-flags` returns `{ items, total, page, pageSize }`.
- Audit page should use `DataTable` from `@open-mercato/ui` + `apiCall`. Reference an existing config DataTable page (e.g. usage stats `AiUsageStatsPageClient.tsx`).

## Blockers / open questions
- none

## Environment caveats
- Node 24 required; ai-assistant has no local jest bin (use `../../node_modules/.bin/jest --config jest.config.cjs <pattern>`).
- `yarn db:generate` re-introduces the unrelated `ai_chat_conv_participants_active_conv_user_idx` drop (pre-existing develop drift) — if regenerating, strip it again + keep the snapshot index.
- Fork workflow: push `fork`, PR upstream `develop`, labels/reviews comments-only.

## Worktree
- Path: /home/bernard/workspace/OpenMercatoTest/.ai/tmp/auto-create-pr/ai-input-moderation-safety-identifiers-20260610-145153
- Created this run: yes
