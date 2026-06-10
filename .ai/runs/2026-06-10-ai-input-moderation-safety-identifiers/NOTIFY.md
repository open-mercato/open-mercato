# Notify — 2026-06-10-ai-input-moderation-safety-identifiers

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-06-10T12:52:09Z — run started
- Brief: Implement spec `.ai/specs/2026-06-04-ai-input-moderation-and-safety-identifiers.md` — AI input moderation gate + hashed end-user safety identifiers in the `ai_assistant` runtime.
- External skill URLs: none
- Spec status: merged upstream (PR #2511, issue #2510) on 2026-06-04 — implementation gate resolved.
- Mode: Spec-implementation run; 17 steps across 3 phases. Fork workflow (push `fork`, PR upstream `develop`, labels/reviews comments-only).

## 2026-06-10T13:17:27Z — checkpoint 1 (Phase 1 complete)
- Steps 1.1..1.4 + 1.4-fix landed (SHA range 18962f889..f3d4a8d0c).
- Validation: shared 46 + ai-assistant 138 unit tests pass; `yarn generate` + full `yarn typecheck` clean (21/21).
- Decision: checkpoint typecheck surfaced `providerOptions: Record<string,unknown>` not assignable to AI SDK `SharedV2ProviderOptions` at streamText/ToolLoopAgent call sites → fixed forward as Step 1.4-fix (`as never` cast, matching existing file style). No per-step UI in this window (pure contract + runtime logic), so no Playwright pass.
- Backfill pattern adopted for the Commit column (no `--amend`): each step's real SHA is recorded in the following step's commit to avoid the amend-rewrites-SHA mismatch seen on step 1.1.

## 2026-06-10T13:37:32Z — checkpoint 2 (Phase 2 complete)
- Steps 2.1..2.4 + 2.4-fix landed (SHA range 29da4fb0a..0125ac77e).
- Validation: full typecheck 21/21; ai-assistant 1241 unit tests; ui AiChat 13 tests (incl. new moderation render case); i18n sync clean (en/de/es/pl gained `ai_assistant.errors.moderation*`).
- Decision/blocker resolved: checkpoint surfaced that existing runtime tests mock `llmProviderRegistry` without `.get`; the gate resolved the API key eagerly in its call args. Fixed forward (2.4-fix) by switching to a lazy `resolveApiKey()` thunk invoked only on the proceed path. No functional change to enforcement.
- UI verification done via AiChat RTL test (deterministic) rather than live Playwright; full chat integration deferred to Step 3.9 with stubbed moderation responses.

## 2026-06-10T14:06:26Z — checkpoint 3 (Phase 3 part 1 complete)
- Steps 3.1..3.5 + 3.5-fix landed (SHA range 359bde1c0..d457c1c74): entity+migration+snapshot, event+repo+recorder, settings GET/PUT + runtime override honoring, settings UI moderation section, moderation-flags read route.
- Validation: yarn generate ok; full typecheck 21/21; ai-assistant 1254 unit tests; i18n sync clean.
- Decisions/blockers resolved:
  1. `yarn db:generate` emitted an unrelated `ai_chat_conv_participants_active_conv_user_idx` index drop (pre-existing develop drift). Per AGENTS.md coding-agent exception, stripped it from the migration and restored the index in the snapshot; verified the only semantic snapshot removal was that index.
  2. Checkpoint typecheck surfaced `em.create(AiModerationFlag)` needing `[OptionalProps]` (sibling entities declare it). Fixed forward as 3.5-fix.
- UI (3.4 settings section) verified via typecheck + settings-route unit tests; live toggle exercise deferred to 3.9 stubbed integration test.
