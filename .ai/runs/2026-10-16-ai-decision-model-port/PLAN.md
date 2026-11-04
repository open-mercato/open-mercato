# Execution plan — AI decision model port

**Run:** 2026-10-16-ai-decision-model-port
**Branch:** feat/ai-decision-model-port
**Base:** develop
**Source spec:** .ai/specs/2026-10-06-ai-decision-model-port.md
**Mode:** Spec-implementation run

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Port types in shared and zod schemas in ai-assistant | inline | done | 19291ab8e |
| 1 | 1.2 | Fixture adapter with deterministic rules | dispatch | done | 418e29744 |
| 1 | 1.3 | OpenRouter adapter with wire mapping, HTTP error mapping and response validation | dispatch | done | 2016503af |
| 1 | 1.4 | Decision model registry with built-in registration and env resolution | dispatch | done | 7900de4f2 |
| 1 | 1.5 | Decision model service and DI registration | dispatch:capable | done | a71fc5bcb |
| 2 | 2.1 | Env example block and create-app template sync | dispatch:cheap | done | f430e20e9 |
| 2 | 2.2 | Docs page, ai-assistant AGENTS.md entry and spec changelog | dispatch | done | caf825a6f |
| 2 | 2.3 | Debug log on probability normalization | inline | done | df3f71727 |
| 2 | 2.4 | Record the skipped AGENTS.md entry in the spec | inline | done | f16aa072e |
| 2 | 1.1-review-fix | Reject __proto__ keys, type error maps by code, drop 2xx httpStatus | inline | done | bd620bfd7 |
| 2 | 2.2-review-fix | Document the debug normalization log and align the fixture opt-in wording | inline | done | 1cc20cf99 |

## Goal

Ship the provider-neutral decision model port from the source spec: types in `@open-mercato/shared/lib/ai/decision-model`, and schemas, registry, `openrouter` + `fixture` adapters and the `decisionModelService` DI singleton in `@open-mercato/ai-assistant`.

## Scope

- `packages/shared/src/lib/ai/decision-model.ts` (types only).
- `packages/ai-assistant/src/modules/ai_assistant/lib/decision-model-*.ts`, `lib/decision-adapters/{openrouter,fixture}.ts`, `di.ts`.
- `apps/mercato/.env.example` + `packages/create-app/template/.env.example`.
- `apps/docs/docs/framework/ai-assistant/decision-models.mdx`, `packages/ai-assistant/AGENTS.md`, the spec changelog.

## Non-goals

- Any consumer (workflows `AI_DECISION` step is a separate spec).
- Per-tenant settings UI, OpenAI Decisions adapter, LLM-emulation fallback (spec Out of scope / D3).
- New production dependencies (adapter uses `fetch`).
- No HTTP routes, entities or migrations.

## Risks

- The vendor endpoint is `/alpha/`; the adapter is covered by contract tests built from the spec's published-shape description, not live calls (no network in tests).
- New public contract surface (types + DI key) — marked `@experimental` per D11.
- Recorded deviations from the spec are listed below.

## Deviations from the spec's Implementation Plan

- **Order:** the spec lists Registry (2) before the adapters (3, 4). The registry registers the built-in adapters itself (`createDecisionModelRegistry`), so the adapters land first (Steps 1.2, 1.3) and the registry after (1.4). Same content, dependency-safe order.
- **Shared helpers:** the error type the adapters throw (`DecisionModelError` with `code` + `httpStatus`) and the response validation/normalization helper live in `ai-assistant/lib/decision-model-schemas.ts` (Step 1.1) so both adapters and the service reuse them. Both are `ai-assistant` internals.

## External References

- None (`--skill-url` not passed).

## Implementation Plan

### Phase 1 — Port

#### Step 1.1 — Port types in shared and zod schemas in ai-assistant
- `packages/shared/src/lib/ai/decision-model.ts`: types only, exactly as in the spec "Port types" block, JSDoc `@experimental`; `EnvLookup` imported as a type from `./llm-provider`.
- `packages/ai-assistant/src/modules/ai_assistant/lib/decision-model-schemas.ts`: request schemas from the spec; `DecisionModelError` class (`code`, `httpStatus?`, `[internal]` message prefix); `normalizeDecisionAnswers(request, raw)` validating per spec "Response validation" (probabilities in [0,1], key/level set equality in request order, chosen value in set, sum within 1 ± 0.02 then normalized; score `value` = probability-weighted position, `level` = argmax) and throwing `invalid_response`.
- Tests: schema limits, discriminated union, order preservation incl. integer-like keys, type-level mutual-assignability test, normalization rules.

#### Step 1.2 — Fixture adapter with deterministic rules
- `lib/decision-adapters/fixture.ts`: `createFixtureDecisionAdapter()`, `isConfigured` always true; rules from D9 (whole-word case-insensitive key match in serialized state; uniform otherwise; score uniform; binary 0.5; confidence = top probability). `provider: 'fixture'`, usage nulls.
- Tests: deterministic choice (match / no-match / first match wins in option order), score, binary.

#### Step 1.3 — OpenRouter adapter with wire mapping, HTTP error mapping and response validation
- `lib/decision-adapters/openrouter.ts`: configured when `OPENROUTER_API_KEY` set; base URL `OM_DECISION_OPENROUTER_BASE_URL` (default `https://openrouter.ai/api`), POST `${base}/alpha/decisions`; port→wire mapping and wire→port mapping per spec; HTTP mapping table per spec; unparseable body → `provider_error`; abort signal passed to `fetch`; never sends `user`.
- Tests: contract tests with request/response fixtures, one per status code, `OPENROUTER_BASE_URL` ignored, ordering preserved, `noul` mapping.

#### Step 1.4 — Decision model registry with built-in registration and env resolution
- `lib/decision-model-registry.ts`: `createDecisionModelRegistry({ env? })`, `register` (idempotent by id), `get`, `list`, `resolve({ moduleId?, env? })`; `openrouter` always, `fixture` only with `OM_DECISION_FIXTURE_ENABLED=1` and `NODE_ENV !== 'production'`; module env-name rule; reasons per spec.
- Tests: env matrix from the spec Implementation Plan step 2 and step 3 opt-in cases.

#### Step 1.5 — Decision model service and DI registration
- `lib/decision-model-service.ts`: `createDecisionModelService({ registry?, env?, logger? })` implementing `getAvailability` and never-throwing `decide` (validate → serialize → token cap via `countTokens` with `OM_DECISION_MAX_INPUT_TOKENS` default 24 000 → resolve → timeout (5 s default, clamp 30 s) combined with caller signal via `AbortSignal.any`, timeout vs aborted by `signal.reason` → adapter → normalize → log metadata only via `createLogger('ai_assistant')` → `reportError` on `provider_error`/`invalid_response`).
- Register `decisionModelService` singleton in `ai_assistant/di.ts` next to `moderationService`.
- Tests: per error code, circular/BigInt state, timeout clamping, throwing adapter, throwing logger, hanging adapter, no state/instructions in logs.

### Phase 2 — Configuration and docs

#### Step 2.1 — Env example block and create-app template sync
- Add the spec's Configuration block after the OpenRouter LLM block in `apps/mercato/.env.example`, mirror in `packages/create-app/template/.env.example`; run `yarn template:sync` check.

#### Step 2.2 — Docs page, ai-assistant AGENTS.md entry and spec changelog
- `apps/docs/docs/framework/ai-assistant/decision-models.mdx` (configuration, usage example with soft-optional resolve, caveats, data flow), sidebar entry if the docs sidebar is explicit.
- `packages/ai-assistant/AGENTS.md`: short "How to use a decision model" task entry (respect `yarn agents:check-budget`).
- Spec changelog entry for the implementation (status stays out of `implemented/` until deployed).

#### Step 2.3 — Debug log on probability normalization
- Appended mid-run: the spec's edge-case table says a near-1 sum is "normalized; logged at debug", and Step 1.1 normalized without logging. `normalizeDistribution` now logs `{ questionName, sum }` at debug (never state or instructions), guarded so a failing logger cannot break validation. Test with a mocked logger.

#### Step 2.4 — Record the skipped AGENTS.md entry in the spec
- Appended mid-run: the `packages/ai-assistant/AGENTS.md` "How to use a decision model" entry from spec Implementation Plan step 6 cannot land, because that file's instruction chain is ~102 KB over the 32 KB budget and `yarn agents:check-budget` only allows it to shrink. Raising the baseline is a CI-guard change that needs a human. Record the deviation in the spec changelog; the docs page carries the guidance and the root Task Router already routes AI work to `apps/docs/docs/framework/ai-assistant/*.mdx`.

#### Step 1.1-review-fix — Reject __proto__ keys, type error maps by code, drop 2xx httpStatus
- From the `om-auto-review-pr` pass: `__proto__` passed the key regex but zod's `z.record` drops it silently (question vanished, `ok: true`). Reject it on the raw `questions` object and as an option key; regression tests added. Type `ERROR_MESSAGES`/`REPORTED_ERROR_CODES` by `DecisionErrorCode`. An unparseable 2xx body no longer reports `httpStatus: 200`.

#### Step 2.2-review-fix — Document the debug normalization log and align the fixture opt-in wording
- From the same review: the docs page now mentions the debug `{ questionName, sum }` normalization log; the spec's D9 wording matches the shared boolean parser the registry uses (`1`/`true`/`yes`/`on`).

