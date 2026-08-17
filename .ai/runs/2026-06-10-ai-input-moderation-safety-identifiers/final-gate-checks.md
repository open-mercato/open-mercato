# Final gate — AI Input Moderation & Safety Identifiers

**Fired:** all 19 Tasks rows `done` (1.1 → 3.9, incl. 4 checkpoint fixes).
**Branch:** `feat/ai-input-moderation-safety-identifiers` → upstream PR #2949 (draft).
**Date:** 2026-06-10

## Full validation gate

| Check | Result | Notes |
|-------|--------|-------|
| `yarn build:packages` (1) | ✅ pass (exit 0) | |
| `yarn generate` | ✅ pass (exit 0) | route + event discovery |
| `yarn build:packages` (2, post-generate) | ✅ pass (exit 0) | |
| `yarn i18n:check-sync` | ✅ pass (exit 0) | all 4 locales in sync |
| `yarn i18n:check-usage` | ✅ advisory (exit 0) | 3691 pre-existing unused keys (baseline); new keys are referenced |
| `yarn typecheck` | ✅ pass (exit 0) | 21/21 packages |
| `yarn test` (unit) | ✅ pass (exit 0) | full monorepo unit suite |
| `yarn build:app` | ✅ pass (exit 0) | Next.js app build incl. new pages/routes |

Raw logs: `final-gate-artifacts/*.log`. (The `IO error: Permission denied` lines are the benign turbo remote-cache notice seen on every run in this worktree.)

## Full integration suites

| Suite | Result | Notes |
|-------|--------|-------|
| `yarn test:integration:ephemeral --filter TC-AI-MODERATION` | ✅ pass — **7/7** | `TC-AI-MODERATION-008` (3) + `TC-AI-MODERATION-009` (4) on the ephemeral Docker stack (built this branch + applied migration `Migration20260610134045`, app on :5001). First run surfaced two real issues, fixed in Step `3.8-fix`: (a) the audit listing narrowed by `organization_id` so null-org rows were hidden → made it tenant-scoped only; (b) the settings test depended on the empty-in-CI agent registry → rewritten to a synthetic-agent PUT echo. Re-run: 7 passed (2.1m). Log: `final-gate-artifacts/integration-moderation-2.log`. |
| `yarn test:create-app:integration` | ⤬ skipped (justified) | This run's only `packages/shared` change is the **additive** new file `lib/ai/safety-identifier.ts` — no template, packaging, or existing-export changes. The standalone scaffold/build path is unaffected, so the heavy Verdaccio publish+scaffold check is not warranted. |

## Design System (ds-guardian)

Manual DS-token scan of every changed `*.tsx` (added lines, `origin/develop..HEAD`):

| File | Result |
|------|--------|
| `AiAgentSettingsPageClient.tsx` (moderation section) | CLEAN — semantic tokens only (`StatusBadge` variants, `text-muted-foreground`, `text-overline`, `border-border`) |
| `AiModerationFlagsPageClient.tsx` (audit page) | CLEAN — `StatusBadge variant="error"`, no hardcoded colors / arbitrary sizes |
| `AiChat.tsx` (moderation error mapping) | CLEAN — reused existing alert variants; no new color/size literals |

No hardcoded Tailwind status colors, arbitrary values (`text-[…]`, `p-[…]`, `z-[…]`), hex/rgb, or `dark:` overrides on status tokens were introduced. No residual ds-guardian findings.

## Code-review / BC self-review

- All contract changes are **ADDITIVE-ONLY** per `BACKWARD_COMPATIBILITY.md`: new optional `LlmProvider`/`LlmCreateModelOptions` members, new optional `AiAgentDefinition.untrustedInput`, new nullable `input_moderation` column + new `ai_moderation_flags` table (no backfill), new event id `ai_assistant.moderation_flag.created`, new optional settings request/response fields, one new read-only route. No removals, no renames, no frozen-surface breakage.
- Tenant isolation: every `ai_moderation_flags` read filters `tenant_id`; integration isolation probe in `TC-AI-MODERATION-008`.
- No `em.find(`/`em.findOne(` introduced (entity writes go through the typed repository; reads use `findAndCount` with a tenant filter — no encryption map needed, no PII persisted per the Q4 decision).
