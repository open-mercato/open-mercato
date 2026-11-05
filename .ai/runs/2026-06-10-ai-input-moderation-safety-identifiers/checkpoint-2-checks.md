# Checkpoint 2 — Phase 2 (Moderation gate)

**Steps covered:** 2.1 → 2.4-fix (SHA range `29da4fb0a`..`0125ac77e`)
**Packages touched:** `@open-mercato/ai-assistant` (moderation service, policy, gate, agent definition, di, chat route), `@open-mercato/ui` (AiChat error rendering)
**Date:** 2026-06-10T13:37:32Z

## Scope of the window
- 2.1 — `ModerationService` (OpenAI `/v1/moderations`, timeout + 1 retry, zod-parsed) + `AiModerationBlockedError`/`AiModerationUnavailableError` + DI registration.
- 2.2 — `resolveModerationPolicy` 5-step precedence + `isModerationActive`/`shouldFailClosed` helpers + `untrustedInput` on `AiAgentDefinition`.
- 2.3 — pre-loop gate wired into `runAiAgentText` (`runInputModerationGate` + `extractLatestUserText`), with an `onFlagged` hook reserved for Phase 3 audit persistence.
- 2.4 — chat route maps `AiModerationBlockedError`→`moderation_blocked` (400) and `AiModerationUnavailableError`→`moderation_unavailable` (503); `<AiChat>` renders translated copy (warning variant) and never shows the raw server text; i18n keys added to all four locales.
- 2.4-fix — checkpoint-discovered: existing runtime tests mock `llmProviderRegistry` without `.get`; the gate computed the API key **eagerly** in its call arguments. Switched to a lazy `resolveApiKey()` thunk invoked only on the proceed path. Added an `<AiChat>` RTL test for the moderation render path.

## Checks

| Check | Result | Notes |
|-------|--------|-------|
| `yarn typecheck` (full) | ✅ pass (21/21) | Clean before and after the 2.4-fix. |
| ai-assistant unit tests (`moderation`, `moderation-policy`, `input-moderation-gate`, runtime + chat route) | ✅ pass | 89 suites / 1241 tests. Includes 9 service + 8 policy + 13 gate cases. |
| `@open-mercato/ui` `AiChat.test.tsx` | ✅ pass | 13 tests incl. new `moderation_blocked` envelope → translated message + `data-ai-chat-error` assertion. |
| `yarn i18n:check-sync` | ✅ pass | All locales in sync after `--fix` re-sort (en/de/es/pl gained the two `ai_assistant.errors.moderation*` keys). |
| `yarn i18n:check-usage` / `check-hardcoded` | ✅ advisory (exit 0) | New keys are referenced in `AiChat.tsx`; route API-error strings follow the existing jsonError convention (client translates by code). No new blocking findings. |
| `yarn generate` | n/a this window | No new auto-discovery surface in Phase 2 (entity/event/route discovery lands in Phase 3). |

## UI verification
- Touched UI: `packages/ui/src/ai/AiChat.tsx` (error-message mapping + variant).
- Verified via the `AiChat.test.tsx` React Testing Library suite (deterministic, no live stack): a stubbed `moderation_blocked` error envelope renders the localized copy, hides the raw internal message, and tags the alert `data-ai-chat-error="moderation_blocked"` as a warning. This is the right granularity for an error-string/variant mapping; a full Playwright run would require a flagged-input fixture against a live OpenAI moderations endpoint, deferred to the Phase 3 chat integration tests (3.9) using stubbed responses.

## Notes
- No `em.find(`/`em.findOne(` introduced (Phase 2 has no DB access; the audit insert lands in Phase 3.2 via the gate's `onFlagged` hook).
- `[internal]`-prefixed throws in `moderation.ts` keep the i18n hardcoded checker satisfied.
- **Phase 2 verdict: GREEN.** Moderation gate enforced/opt-in/skip + fail-open/fail-closed paths covered; ready for Phase 3 (persistence, settings, audit UI, docs, integration).
