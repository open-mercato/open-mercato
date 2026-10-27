# Checkpoint 3 — Phase 3 part 1 (persistence, settings, audit route)

**Steps covered:** 3.1 → 3.5-fix (SHA range `359bde1c0`..`d457c1c74`)
**Packages touched:** `@open-mercato/ai-assistant` (entity + migration, events, repository, recorder, settings route + UI, moderation-flags route)
**Date:** 2026-06-10T14:06:26Z

## Scope of the window
- 3.1 — `AiModerationFlag` entity + `input_moderation` column on `AiAgentRuntimeOverride` + migration `Migration20260610134045_ai_assistant.ts` + snapshot. Unrelated `ai_chat_conv_participants_active_conv_user_idx` drift was stripped from the migration and restored in the snapshot (pre-existing develop drift, per AGENTS.md coding-agent exception).
- 3.2 — `ai_assistant.moderation_flag.created` event + `AiModerationFlagRepository` + `recordModerationFlag` recorder wired into the gate's `onFlagged` hook (best-effort, never throws).
- 3.3 — settings GET/PUT extended with `inputModeration`; GET returns per-agent `moderation` (enforced/override/effective); runtime now honors tenant + per-agent overrides via `resolveModerationOverrideValues` (gated on `supportsInputModeration && !untrustedInput`).
- 3.4 — agent settings UI `ModerationSection` (Inherit/On/Off `Select` + non-editable Enforced `StatusBadge`) + i18n in all four locales.
- 3.5 — read-only `GET /api/ai_assistant/moderation-flags` (guarded by `ai_assistant.settings.manage`, zod query, `pageSize ≤ 100`, tenant-scoped, `openApi`).
- 3.5-fix — checkpoint-discovered: `em.create(AiModerationFlag, …)` required `[OptionalProps]` (sibling entities declare it). Added `[OptionalProps]?: 'id' | 'createdAt' | 'organizationId'`.

## Checks

| Check | Result | Notes |
|-------|--------|-------|
| `yarn generate` | ✅ pass | Registered the new route in the OpenAPI manifest + event registry. (One benign `Skipping structural cache purge` notice — missing `core/dist` barrel in the worktree, unrelated.) |
| `yarn typecheck` (full) | ✅ pass (21/21) | Run 1 failed on `AiModerationFlagRepository` (`em.create` missing `[OptionalProps]`) → fixed in 3.5-fix; run 2 clean. |
| ai-assistant full unit suite | ✅ pass | 91 suites / 1254 tests (incl. moderation service/policy/gate/recorder + settings route + moderation-flags route + override repo). |
| `yarn i18n:check-sync` | ✅ pass | All four locales in sync (added `ai_assistant.agents.moderation.*`). |
| `yarn i18n:check-usage` / `check-hardcoded` | ✅ advisory (exit 0) | New keys referenced in the settings UI; no new blocking findings. |

## UI verification
- Touched UI: `AiAgentSettingsPageClient.tsx` (`ModerationSection`).
- Verified via full typecheck (the component compiles against the extended GET contract) + the settings-route unit tests that back its data + PUT path. A live Playwright exercise of the toggle + enforced badge is implemented deterministically in Step 3.9 (settings UI route stubbed), per the run's "prefer deterministic UI verification; UI checks must not block" stance. Dev stack was reachable (:3000) but driving the per-agent control needs seeded agents + a configured provider, so it is covered by the stubbed integration test instead.

## Notes
- Migration `down()` made symmetric (drops the new table + indexes); the unrelated index drop/create was removed.
- Repository reads are tenant-scoped (`tenantId` always in the filter); isolation is exercised in Step 3.8.
- **Verdict: GREEN.** Persistence + settings + audit route landed; remaining: audit DataTable page (3.6), docs (3.7), integration tests (3.8/3.9).
