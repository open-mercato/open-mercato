# Execution Plan — AI Input Moderation & Safety Identifiers

**Source spec:** `.ai/specs/2026-06-04-ai-input-moderation-and-safety-identifiers.md` (merged via upstream PR #2511, issue #2510)
**Branch:** `feat/ai-input-moderation-safety-identifiers`
**Base:** `develop` (upstream `open-mercato/open-mercato`)
**Date:** 2026-06-10

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `auto-continue-pr-loop`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Extend shared LLM provider contract (endUserIdentifier / mapEndUserIdentifier / supportsInputModeration) + tests | done | 18962f889 |
| 1 | 1.2 | Add safety-identifier HMAC helper (deriveAiSafetyIdentifierSecret + computeEndUserIdentifier) + tests | done | 81155e2a9 |
| 1 | 1.3 | Implement mapEndUserIdentifier + supportsInputModeration in OpenAI/Anthropic adapters + tests | done | 56bd75d55 |
| 1 | 1.4 | Thread endUserIdentifier through runAiAgentText into merged providerOptions + tests | done | pending |
| 2 | 2.1 | ModerationService + typed errors (AiModerationBlockedError/Unavailable) + DI registration + tests | todo | — |
| 2 | 2.2 | resolveModerationPolicy 5-step precedence + untrustedInput on AiAgentDefinition + tests | todo | — |
| 2 | 2.3 | Wire pre-loop moderation gate into runAiAgentText (fail-open/fail-closed) + tests | todo | — |
| 2 | 2.4 | SSE moderation_blocked code + AiChat translated rendering + i18n keys (all locales) | todo | — |
| 3 | 3.1 | AiModerationFlag entity + input_moderation column + migration + snapshot | todo | — |
| 3 | 3.2 | moderation_flag.created event + repository + best-effort audit insert wired into gate + tests | todo | — |
| 3 | 3.3 | Extend settings GET/PUT with inputModeration + effective policy + openApi + tests | todo | — |
| 3 | 3.4 | Settings UI: input moderation section (Inherit/On/Off + enforced badge) | todo | — |
| 3 | 3.5 | GET /api/ai_assistant/moderation-flags route (guarded, zod query, openApi) + tests | todo | — |
| 3 | 3.6 | Moderation flags audit DataTable backend page + nav | todo | — |
| 3 | 3.7 | Docs page + ai-assistant AGENTS.md update + yarn generate | todo | — |
| 3 | 3.8 | API integration tests (settings roundtrip, moderation-flags tenant isolation) | todo | — |
| 3 | 3.9 | Playwright integration tests (chat enforced/off, settings UI enforced badge) | todo | — |

## Goal

Add two provider-aware content guardrails to the `ai_assistant` runtime: hashed end-user **safety identifiers** attached to every model call, and an opt-in, fail-closed **input pre-moderation gate** (OpenAI `/v1/moderations`) executed before the model call — protecting the instance owner's provider org from enforcement triggered by abusive end users.

## Scope

- `packages/shared/src/lib/ai/` — additive contract members + safety-identifier HMAC helper.
- `packages/ai-assistant/src/modules/ai_assistant/` — adapters, runtime gate, ModerationService, policy resolution, entity + migration, events, settings route + UI, moderation-flags route + audit page, i18n, docs.
- `packages/ui/src/ai/AiChat.tsx` — `moderation_blocked` error rendering.
- `apps/docs/docs/framework/ai-assistant/` — docs page.

## Non-goals

- Output moderation (deferred — providers filter outputs server-side).
- Dedicated moderation provider/key (MVP gates moderation on the chat provider supporting it; only the OpenAI adapter sets `supportsInputModeration`).
- Storing flagged prompt text (only category flags + scores persisted).
- Per-tenant category thresholds, retention pruning workers (deferred per spec Risk Register).

## Risks (brief)

- Moderation API outage degrades enforced (untrusted) surfaces — accepted, fail-closed by design with `AiModerationUnavailableError` and warn logs.
- False positives block legitimate users — default off for trusted surfaces; audit trail quantifies rate.
- Cross-tenant isolation on the new entity + settings — every read filters `tenant_id`; integration isolation probe required.
- Contract changes are ADDITIVE-ONLY per `BACKWARD_COMPATIBILITY.md`.

## Environment caveats

- **Fork workflow**: `origin` = upstream `open-mercato/open-mercato` (read-only for this account); push to `fork` = `adeptofvoltron/open-mercato`. PR opens against upstream `develop` via `--head adeptofvoltron:<branch>`. Cannot apply labels/assignees/formal reviews on upstream PRs — the three-signal lock + `auto-review-pr` verdict degrade to **comments-only**; a documented self code-review + BC review substitutes.
- **Node 24 required** (`.nvmrc`): prefix build/generate/typecheck/test with `export PATH="/home/bernard/.nvm/versions/node/v24.16.0/bin:$PATH"`. Default shell Node is 22 and hard-fails generate/build.
- Fresh worktree: run `yarn build:packages` then `yarn generate` before `yarn typecheck` (generated `#generated/*` barrels are gitignored/ephemeral).
- `.husky/pre-commit` is non-executable repo-wide → git skips it on commit. Not bypassed deliberately; the gate runs `yarn i18n:check-sync`/`check-usage` explicitly. No `chmod` (would add an unrelated mode diff).
- `packages/cli` `dev-env-reload.test.ts › watches generated runtime files` fails locally on ANY branch (inotify `max_user_watches` exhausted) — known-flaky, not branch-caused.

## Implementation Plan (1:1 step ↔ commit)

### Phase 1 — Safety identifiers (shippable alone)

- **1.1** Extend `LlmCreateModelOptions` (optional `endUserIdentifier?: string`) and `LlmProvider` (optional `mapEndUserIdentifier?(identifier: string): Record<string, unknown>`, optional `supportsInputModeration?: boolean`) in `packages/shared/src/lib/ai/llm-provider.ts`. Unit tests assert defaults (adapters without the members behave as today).
- **1.2** Add `deriveAiSafetyIdentifierSecret` (memoized HMAC from base auth secret, purpose label `ai-safety-identifier`) + `computeEndUserIdentifier(tenantId, userId)` in `packages/shared/src/lib/ai/safety-identifier.ts`. Unit tests: stability, tenant separation (same userId different tenant → different hash), no raw id leakage, missing-secret behavior.
- **1.3** Implement `mapEndUserIdentifier` in the OpenAI adapter (`{ openai: { safety_identifier } }`) and Anthropic adapter (`{ anthropic: { metadata: { user_id } } }`); set `supportsInputModeration: true` on the OpenAI adapter only. Adapter unit tests assert the exact `providerOptions` fragment shape.
- **1.4** Compute `endUserIdentifier` from `authContext` (tenantId + userId) in `runAiAgentText`, resolve the provider via the model factory, call `provider.mapEndUserIdentifier(...)`, and merge the fragment into the `streamText` `providerOptions`. Unit test asserts the identifier reaches the SDK options; absent when no provider mapping.

### Phase 2 — Moderation gate

- **2.1** `ModerationService` (`lib/moderation.ts`, registered in `di.ts`): OpenAI `/v1/moderations` client reusing resolved provider credentials, model from `OM_AI_MODERATION_MODEL` (default `omni-moderation-latest`), zod-parsed response, short timeout + one retry; typed `AiModerationBlockedError` + `AiModerationUnavailableError`. Unit tests with mocked HTTP (flagged / clean / timeout / 5xx).
- **2.2** `resolveModerationPolicy(agentDef, overrides, env)` implementing 5-step precedence (untrustedInput → per-agent override → tenant-wide override → `OM_AI_INPUT_MODERATION` env → default off); add `untrustedInput?: boolean` to `AiAgentDefinition`. Exhaustive precedence unit tests.
- **2.3** Wire the pre-loop gate into `runAiAgentText` (before the SDK call, after model resolution): skip when provider lacks `supportsInputModeration`; on flagged → throw `AiModerationBlockedError`; fail-closed when enforced/on, fail-open + warn log when opt-in and the service throws `AiModerationUnavailableError`. Unit tests for each branch.
- **2.4** Map `AiModerationBlockedError` → SSE `{ type: 'error', code: 'moderation_blocked' }` in the chat route; `<AiChat>` maps the code to `t('ai_assistant.errors.moderationBlocked')` (raw categories never sent to the client). Add i18n keys (`errors.moderationBlocked`, settings + audit labels) to all locales. `yarn i18n:check-hardcoded` clean.

### Phase 3 — Tenant settings, audit trail, docs

- **3.1** Add `AiModerationFlag` entity (table `ai_moderation_flags`, append-only, indexes `(tenant_id, created_at)` + `(tenant_id, user_id)`) + nullable `input_moderation` column on `AiAgentRuntimeOverride`; `yarn db:generate`, review SQL, update `.snapshot-open-mercato.json` (no `yarn db:migrate`).
- **3.2** Declare `ai_assistant.moderation_flag.created` via `createModuleEvents` in `events.ts`; add a repository for `AiModerationFlag`; best-effort insert + emit wired into the gate (insert/emit failure logs but never masks the rejection). Unit tests (insert failure does not mask rejection).
- **3.3** Extend `/api/ai_assistant/settings` GET/PUT: `runtimeOverrideUpsertSchema` gains `inputModeration: z.boolean().nullable().optional()`; GET returns effective per-agent policy (`enforced`/`on`/`off`/`inherit`); update `openApi`. Route unit tests.
- **3.4** Settings UI: per-agent "Input moderation" three-state control (Inherit/On/Off) via existing form primitives; `untrustedInput` agents render a non-editable `<StatusBadge>` "Enforced" with explanatory text. Semantic tokens, `aria-label`s, lucide icons.
- **3.5** New read-only `GET /api/ai_assistant/moderation-flags` route: `requireAuth` + `requireFeatures: ['ai_assistant.settings.manage']`, zod query (`page`, `pageSize`≤100, optional `agentId`/`userId`/`from`/`to`), tenant-filtered parameterized reads, `{ items, total, page, pageSize }`, `openApi` export. Route + isolation unit tests.
- **3.6** Moderation-flags audit `<DataTable>` backend page (category chips as `<StatusBadge>` semantic tokens, `<EmptyState>` via `emptyState`, date-range filter, `pageSize ≤ 100`) + settings/nav entry.
- **3.7** Docs page under `apps/docs/docs/framework/ai-assistant/` (moderation + safety identifiers, operator guidance on rotation/outage); update `packages/ai-assistant/AGENTS.md`; `yarn generate` for route/i18n discovery.
- **3.8** API integration tests: `PUT /api/ai_assistant/settings` with `inputModeration` roundtrip (set → GET reflects effective policy → reset in teardown); `GET /api/ai_assistant/moderation-flags` created flag visible only to its tenant, second tenant gets empty list. Self-contained fixtures + `finally` teardown.
- **3.9** Playwright integration tests: chat with moderation enforced + stubbed-flagged input → translated rejection, no model call; chat with moderation off (default) → message reaches mock model (regression guard); settings UI moderation section toggle + enforced agent non-editable badge.

### Final gate (after 3.9, when all rows done)

Full validation gate + `yarn test:integration` + `yarn test:create-app:integration` (likely skippable — no packaging/template surface; document) + `ds-guardian` pass (lands `X.Y-ds-fix` steps). See `final-gate-checks.md`.
