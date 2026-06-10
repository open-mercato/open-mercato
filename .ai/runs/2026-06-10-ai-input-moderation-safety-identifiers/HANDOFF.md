# Handoff — 2026-06-10-ai-input-moderation-safety-identifiers

**Last updated:** 2026-06-10T13:37:32Z
**Branch:** feat/ai-input-moderation-safety-identifiers (pushed to `fork`)
**PR:** not yet opened (opens after final gate)
**Current phase/step:** Phase 2 complete (checkpoint 2 green). Next: Phase 3 Step 3.1.
**Last commit:** 0125ac77e — fix(ai-assistant): resolve moderation API key lazily

## What just happened
- Phase 2 (moderation gate) landed: ModerationService + typed errors + DI (2.1), policy resolution + `untrustedInput` (2.2), pre-loop gate in runAiAgentText (2.3), SSE `moderation_blocked`/`moderation_unavailable` + AiChat translated copy + i18n all locales (2.4), lazy API-key fix + AiChat render test (2.4-fix).
- Checkpoint 2 green: typecheck 21/21, ai-assistant 1241 tests, ui AiChat 13 tests, i18n sync clean. See `checkpoint-2-checks.md`.

## Next concrete action
- Step 3.1: add `AiModerationFlag` MikroORM entity (table `ai_moderation_flags`, append-only, indexes `(tenant_id, created_at)` + `(tenant_id, user_id)`) in `data/entities.ts`, plus a nullable `input_moderation` column on `AiAgentRuntimeOverride`. Then `yarn db:generate`, review the SQL + `migrations/.snapshot-open-mercato.json`, keep only the intended migration (delete unrelated generator output). Do NOT run `yarn db:migrate`.

## Key wiring notes for Phase 3
- The gate (`runInputModerationGate` in `agent-runtime.ts`) already accepts an `onFlagged(categories)` hook — Phase 3.2 wires the best-effort audit insert + `ai_assistant.moderation_flag.created` emit there (must not throw / not block the rejection). The runtime call site currently does NOT pass `onFlagged` yet, nor per-agent/tenant-wide override values (those arrive with the `input_moderation` column in 3.1/3.3).
- Events pattern: `createModuleEvents` in `events.ts` (`emitAiAssistantEvent`). Add `ai_assistant.moderation_flag.created` (entity `ai_moderation_flag`, category `system`).
- Settings route: `api/settings/route.ts` `runtimeOverrideUpsertSchema` — add `inputModeration: z.boolean().nullable().optional()`; GET returns effective per-agent policy via `resolveModerationPolicy` (`enforced`/`on`/`off`/`inherit`).
- Existing entities live in `data/entities.ts`; `AiAgentRuntimeOverride` is the override row (gets the new column). Repositories live in `data/repositories/`.

## Blockers / open questions
- none

## Environment caveats
- Node 24 required; fresh worktree needs `yarn generate` before typecheck.
- ai-assistant has no local `jest` bin — run `../../node_modules/.bin/jest --config jest.config.cjs <pattern>` from the package dir; shared/ui use `yarn workspace <pkg> jest <pattern>`.
- A dev server responded 200 on :3000 this session, but Phase 3 UI checks should still prefer deterministic component/integration tests; reserve live Playwright for 3.9 with stubbed moderation responses.
- Fork workflow: push `fork`, PR upstream `develop`, labels/reviews comments-only.

## Worktree
- Path: /home/bernard/workspace/OpenMercatoTest/.ai/tmp/auto-create-pr/ai-input-moderation-safety-identifiers-20260610-145153
- Created this run: yes
