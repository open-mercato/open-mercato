# AI Decision Model Port

> Status: **Implemented in open PR #7553** (not yet deployed; stays out of `implemented/` until then). First consumer: the workflows `AI_DECISION` step, specified in `2026-10-06-workflows-ai-decision-step.md` (pending its own spec PR; not yet on `develop`).

## 📝 TLDR

**Key points:**
- A new class of models has reached the market: **decision models**. They take application state plus typed questions and return a typed answer **with a probability distribution** instead of prose. TypeSafe AI's **Jev** is generally available through the **OpenRouter Decisions API**. OpenAI has a Decisions API in closed preview with no public contract yet.
- Open Mercato has no abstraction for them today. A module that wants "pick one of these options" either hand-rolls an LLM structured-output call, with uncalibrated self-reported confidence, or integrates a vendor API directly.
- **Proposed (future behavior):** a provider-neutral **decision model port**, shaped after the published Decisions API contract. It has three question types (`choice`, `score`, `binary`), adapters selected from `.env`, and a DI service `decisionModelService` that any module resolves soft-optionally. It ships with one adapter (`openrouter`, e.g. `typesafe/jev-1.13`) and an explicitly enabled, non-production `fixture` adapter for deterministic tests. The surface is marked **`@experimental`** for one minor, because the vendor endpoint is `/alpha/`.

**Scope:**
- **Types only** (no zod, no imports) in `@open-mercato/shared/lib/ai/decision-model.ts`, mirroring `llm-provider.ts`.
- Zod schemas, registry (with built-in adapter registration), adapters and the DI service in `@open-mercato/ai-assistant`.
- Env configuration, availability, timeout and abort, response validation, error taxonomy, and usage/cost reporting.

**Out of scope:**
- Per-tenant model settings in the UI.
- Any consumer feature. The first consumer is the workflows `AI_DECISION` step (separate spec).
- An OpenAI Decisions adapter, until its contract is public.
- An LLM-emulation adapter (explicit decision: no decision model means unavailable).

## Overview

| | LLM provider port (existing) | Decision model port (this spec) |
|---|---|---|
| Output | text / structured object | typed answer + probabilities per option |
| Confidence | none, or self-reported by the model | derived from the model's own distribution |
| Latency | seconds | sub-second (OpenRouter reports Jev P95 ≈ 0.34 s) |
| Config | `OM_AI_PROVIDER` / `OM_AI_MODEL` | `OM_DECISION_PROVIDER` / `OM_DECISION_MODEL` |

> **Market reference.**
> - **OpenRouter Decisions API**, `POST /api/alpha/decisions`. Request: `{ model, state, questions: { [name]: { type, instructions, criteria } }, session_id?, user?, trace? }`. Question types:
>   - `choice`: `criteria` is a map of option key → description.
>   - `score`: `criteria` is an ordered array of levels.
>   - `noul`: `criteria` is `{ true, false }`.
>
>   Response: `{ model, answers: { [name]: … }, usage: { input_tokens, output_tokens, cost } }`. Answers:
>   - `choice` → `{ choice, confidence, probabilities }`
>   - `score` → `{ score, confidence, probabilities, legend }`
>   - `noul` → `{ noul }`, a probability.
>
>   Errors use HTTP 400/401/402/403/413/429/5xx/524/529 with `{ error: { code, message } }`.
>
>   *Adopted:* the state + named-questions shape and the three primitives. Our port renames `noul` to the neutral `binary`. *Rejected:* leaking vendor field names into the port.
> - **Known model caveats.**
>   - Option order affects Jev's probabilities (community reports), so the port carries options as an **ordered array** and adapters must preserve that order.
>   - *JevOut* (arXiv 2609.30243) shows natural context can flip decisions, so consumers own injection mitigation; the port does not claim it.
>   - Jev's confidence is derived from its probabilities, so the port exposes both and consumers should prefer `probabilities`.

## Problem Statement

- There is no shared way to say "classify this into one of N" with calibrated output. Every candidate consumer (workflows branching, message/channel routing, inbox_ops, catalog categorization, CRM lead scoring, `business_rules` AI assist) would otherwise integrate a vendor or emulate one with an LLM.
- Decision-model vendors are converging on one shape, but only one contract is public. A port that copies that shape in neutral terms lets adapters be added later without changing consumers.

## Proposed Solution

### Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Plain TS types only** in `packages/shared/src/lib/ai/decision-model.ts`. Zod schemas, registry, adapters and the service live in `packages/ai-assistant`. | Mirrors `llm-provider.ts`, which is types only. Consumers in `core` import types (erased at runtime) and get the service through DI. Limits stay in `ai-assistant`, so tightening them does not touch a `shared` contract. The registry has no consumer outside `ai-assistant`. |
| D2 | Neutral question types `choice` / `score` / `binary`. Options, levels **and returned probabilities are ordered arrays**, never key-indexed objects. | Vendor-neutral names. Order matters to current models, and JS objects reorder integer-like keys (`"10"`, `"2"`). |
| D3 | **No LLM-emulation fallback.** No decision model configured means unavailable. | Explicit product decision. Keeps one meaning for `probabilities`, which must be model-native, not invented. |
| D4 | Selection from env: `OM_DECISION_PROVIDER`, `OM_DECISION_MODEL`, and a per-module override `OM_DECISION_<MODULE>_MODEL`, where `<MODULE>` is `moduleId.toUpperCase()` with non-alphanumerics turned into `_` (e.g. `workflows` → `OM_DECISION_WORKFLOWS_MODEL`). The API key reuses `OPENROUTER_API_KEY`. The base URL is a **separate** `OM_DECISION_OPENROUTER_BASE_URL` (default `https://openrouter.ai/api`). | Same convention as `OM_AI_*`. `OPENROUTER_BASE_URL` already carries the LLM preset's `/api/v1` base (`OPENROUTER_PRESET.baseURLEnvKeys` in `openai-compatible-presets.ts`), so sharing it would misroute decision calls to `/api/v1/alpha/decisions`. |
| D5 | **The service never throws to callers.** It returns a discriminated `{ ok: true, result } \| { ok: false, error }`. The entire body (serialization, adapter, validation, logging, `reportError`) sits in one catch. State that cannot be serialized (circular, BigInt) → `invalid_request`. Anything else unexpected → `provider_error`. | Consumers (workflow fallback routes) need a closed set of outcomes. |
| D6 | **Mandatory timeout**: default 5 s, max 30 s (a `timeoutMs` above 30 000 is clamped to 30 000; a missing or non-positive one uses the default), plus an optional caller `AbortSignal`, combined with `AbortSignal.any`. `timeout` vs `aborted` is decided by `signal.reason`. | The models are sub-second. A hard bound protects inline callers. |
| D7 | Strict zod validation of the response. Every option key must be present in `probabilities`, and the selected key must be one of them. | Never trust the vendor shape. A mismatch is `invalid_response`, not a guess. |
| D8 | Privacy: `state` is never logged or persisted by the port. The vendor `user` field is never sent. `session_id` is caller-supplied and must be an opaque id (e.g. a workflow instance id). | State may carry tenant data. Identifiers stay pseudonymous. |
| D9 | `fixture` adapter, **registered only when `OM_DECISION_FIXTURE_ENABLED` is truthy (`1`, `true`, `yes` or `on`, parsed with the shared boolean helper) and `NODE_ENV !== 'production'`**. Deterministic rules:<br>- `choice`: the first option (in order) whose key appears as a whole word (case-insensitive) in the serialized state gets p = 1, the others 0. With no match, the distribution is uniform.<br>- `score`: a uniform distribution.<br>- `binary`: probability 0.5.<br>`confidence` equals the top probability. | Lets consumer integration tests exercise the success and low-confidence paths without a vendor. A double opt-in means a misconfigured staging host cannot silently serve fake answers. |
| D10 | **Payload bound in tokens.** The estimate uses `@open-mercato/shared/lib/ai/token-count`, capped by `OM_DECISION_MAX_INPUT_TOKENS` (default 24 000, below Jev's 32 k window). | Character bounds are wrong for JSON, Polish or CJK text (1–2 chars per token). |
| D11 | **`@experimental` for one minor; open unions.** `DecisionAnswer['type']` and `DecisionErrorCode` may gain members, so consumers MUST keep a default branch. | The vendor endpoint is `/alpha/`. Additive union members would otherwise break exhaustive switches. |

### Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Model decisions as LLM `generateObject` | Uncalibrated, slower and costlier. It conflates two model classes (D3). |
| A dedicated provider package (`packages/decision-openrouter`) | Rejected by the author. The LLM adapters set the precedent of living inside `ai-assistant`, and this adapter reuses the OpenRouter credentials already there. |
| A new `@open-mercato/decisions` package | A new package to publish, and duplicated provider config. |
| Wait for OpenAI's contract | Only Jev is public. The port design does not depend on OpenAI. |

## Architecture

```mermaid
flowchart LR
  C[Consumer module\n(e.g. workflows AI_DECISION)] -->|container.resolve('decisionModelService')\nsoft-optional| S[decisionModelService\nai-assistant NEW]
  S --> R[decisionModelRegistry\nai-assistant NEW]
  R --> A1[openrouter adapter\nai-assistant NEW]
  R --> A2[fixture adapter\nnon-prod NEW]
  A1 -->|POST /api/alpha/decisions| OR[(OpenRouter → Jev)]
```

A consumer resolves the service through DI inside a try/catch. When `ai-assistant` is absent, the service is absent and the consumer treats that as unavailable. The service resolves the adapter and model from env through the registry, enforces timeout and validation, and returns a closed result.

### Port types

`@open-mercato/shared/lib/ai/decision-model.ts` holds **types only** (`DecisionQuestion`, `DecisionRequest`, `DecisionAnswer`, `DecisionResult`, `DecisionErrorCode`, `DecisionModelAdapter`; `EnvLookup` is imported as a type from `./llm-provider`). The matching zod schemas live in `ai-assistant/lib/decision-model-schemas.ts`. Because the types are hand-written rather than `z.infer`-derived (same precedent as `llm-provider.ts`), a type-level test asserts that `z.infer<typeof decisionRequestSchema>` and `DecisionRequest` are mutually assignable, so they cannot drift.

Schemas (`ai-assistant`):

```ts
export const decisionChoiceQuestionSchema = z.object({
  type: z.literal('choice'),
  instructions: z.string().min(1).max(4000),
  options: z.array(z.object({ key: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), criteria: z.string().min(1).max(500) }))
    .min(2).max(64),
})
export const decisionScoreQuestionSchema = z.object({
  type: z.literal('score'),
  instructions: z.string().min(1).max(4000),
  levels: z.array(z.string().min(1).max(500)).min(2).max(16),
})
export const decisionBinaryQuestionSchema = z.object({
  type: z.literal('binary'),
  instructions: z.string().min(1).max(4000),
  criteria: z.object({ true: z.string().min(1).max(500), false: z.string().min(1).max(500) }),
})
export const decisionQuestionSchema = z.discriminatedUnion('type', [
  decisionChoiceQuestionSchema, decisionScoreQuestionSchema, decisionBinaryQuestionSchema,
])
export const decisionRequestSchema = z.object({
  state: z.unknown(),
  questions: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), decisionQuestionSchema)
    .refine((questions) => Object.keys(questions).length >= 1 && Object.keys(questions).length <= 8),
  sessionId: z.string().max(256).optional(),
})
```

Types (`shared`):

```ts
export type DecisionQuestion =
  | { type: 'choice'; instructions: string; options: Array<{ key: string; criteria: string }> }
  | { type: 'score'; instructions: string; levels: string[] }
  | { type: 'binary'; instructions: string; criteria: { true: string; false: string } }

export interface DecisionRequest {
  state: unknown
  questions: Record<string, DecisionQuestion>
  sessionId?: string
}

export type DecisionAnswer =
  | { type: 'choice'; value: string; probabilities: Array<{ key: string; probability: number }>; confidence: number | null }
  | { type: 'score'; value: number; level: number; probabilities: Array<{ level: number; probability: number }>; confidence: number | null }
  | { type: 'binary'; probability: number }

export interface DecisionResult {
  answers: Record<string, DecisionAnswer>
  provider: string
  model: string
  usage: { inputTokens: number | null; outputTokens: number | null; costUsd: number | null }
  durationMs: number
}

export type DecisionErrorCode =
  | 'unavailable' | 'invalid_request' | 'auth' | 'insufficient_credits' | 'rate_limited'
  | 'payload_too_large' | 'timeout' | 'aborted' | 'provider_error' | 'invalid_response'

export interface DecisionModelAdapter {
  id: string
  isConfigured(env?: EnvLookup): boolean
  decide(request: DecisionRequest, options: { modelId: string; env?: EnvLookup; signal: AbortSignal }): Promise<DecisionResult>
}
```

In `score` answers:
- `value` is computed by the port from the validated (normalized) `probabilities` as the probability-weighted position in `[0, levels.length - 1]`; the vendor `score` field is not passed through;
- `level` is the argmax index into the request's `levels`;
- the vendor `legend` is dropped, because the caller already holds the level texts.

In `binary` answers, `probability` is **P(true)**: the probability that the `criteria.true` description holds (the vendor `noul` value). There is no separate `confidence`; consumers threshold on `probability` directly.

`probabilities` arrays follow the request's option and level order exactly.

Response validation (`invalid_response` on failure):
- every probability lies in `[0, 1]`;
- the set of keys or levels equals the request's;
- the chosen value is a member of that set;
- for `choice` and `score`, the sum of probabilities is within 1 ± 0.02, and the distribution is then normalized to sum to exactly 1; any other sum is rejected.

### Registry (`ai-assistant/lib/decision-model-registry.ts`)

`createDecisionModelRegistry({ env? })` builds a registry that registers its built-in adapters itself: `openrouter` always, and `fixture` only under the D9 double opt-in. It provides `register(adapter)` (idempotent by id), `get(id)`, `list()`, and `resolve({ moduleId?, env? })`, using the D4 precedence `OM_DECISION_<MODULE>_MODEL` → `OM_DECISION_MODEL`. `resolve` returns either:
- `{ ok: true, adapter, modelId }`, or
- `{ ok: false, reason: 'not_configured' | 'unknown_provider' | 'credentials_missing' | 'model_missing' | 'fixture_disabled' }`.

`OM_DECISION_PROVIDER=fixture` with no registered `fixture` adapter resolves to `fixture_disabled`, not `unknown_provider`.

The registry is pure, with no I/O. Unlike the LLM registry, it is not a `shared` module-level singleton, so it needs no separate bootstrap file or import-graph guard: the DI singleton `decisionModelService` owns the only instance.

### Service (`ai-assistant`, DI key `decisionModelService`)

```ts
interface DecisionModelService {
  getAvailability(input?: { moduleId?: string }): { available: boolean; provider?: string; model?: string; reason?: 'not_configured' | 'unknown_provider' | 'credentials_missing' | 'model_missing' | 'fixture_disabled' }
  decide(input: { request: DecisionRequest; moduleId?: string; timeoutMs?: number; signal?: AbortSignal }):
    Promise<{ ok: true; result: DecisionResult } | { ok: false; error: { code: DecisionErrorCode; message: string; httpStatus?: number } }>
}
```

What `decide` does:
1. Validates `request` (`invalid_request`). Serializes it, mapping a serialization failure to `invalid_request`. Estimates tokens and rejects anything above `OM_DECISION_MAX_INPUT_TOKENS` (`payload_too_large`).
2. Resolves the adapter (`unavailable`).
3. Arms the timeout, chained to the caller's signal.
4. Calls the adapter, maps errors, and validates the response.
5. Logs `{ provider, model, durationMs, usage, questionCount, outcomeCodes }` through `createLogger('ai_assistant')`, never the state or the instructions. It calls `reportError` on `provider_error` / `invalid_response`.

It is registered in `ai-assistant/di.ts` as a singleton next to `moderationService`, and creates its registry with `createDecisionModelRegistry()`.

### OpenRouter adapter (`ai-assistant/lib/decision-adapters/openrouter.ts`)

- Configured when `OPENROUTER_API_KEY` is set. Base URL comes from `OM_DECISION_OPENROUTER_BASE_URL` (default `https://openrouter.ai/api`).
- No `baseurl-allowlist` check: that guard is for HTTP-supplied overrides, and env values are operator-trusted, which matches the LLM presets.
- Maps port to wire:
  - `choice.options[]` → `criteria` object, in insertion order;
  - `score.levels` → `criteria` array;
  - `binary` → `type: 'noul'`;
  - `sessionId` → `session_id`.
- Maps the response back, including `noul` → `binary.probability`.
- HTTP mapping:
  - 400 / 422 → `invalid_request`
  - 401 / 403 → `auth`
  - 402 → `insufficient_credits`
  - 404 → `unavailable` (unknown model id: a configuration error)
  - 413 → `payload_too_large`
  - 429 → `rate_limited`
  - 524 → `timeout`
  - other 5xx / 529, or an unparseable body → `provider_error`
- Uses server-side `fetch` with the abort signal. No new dependency.

## Data Models

No entities, no migrations. No persistence by the port.

## API Contracts

No HTTP routes. The public contract is TypeScript:
- the types exported from `@open-mercato/shared/lib/ai/decision-model`;
- the DI key `decisionModelService` and its interface.

Both are `@experimental` for one minor release (D11), then **STABLE** under `BACKWARD_COMPATIBILITY.md` (types, import paths, DI keys). The registry and schemas are `ai-assistant` internals.

## Configuration

`.env.example` gets a new block, mirrored into the create-app template (Template Sync Checklist):

```bash
# Decision models — typed answers with probabilities (e.g. TypeSafe Jev via OpenRouter).
# Unset → no decision model; features that need one report "unavailable".
# OM_DECISION_PROVIDER=openrouter
# OM_DECISION_MODEL=typesafe/jev-1.13
# Per-module override: OM_DECISION_<MODULE>_MODEL, e.g. OM_DECISION_WORKFLOWS_MODEL=typesafe/jev-1.13
# Credentials reuse OPENROUTER_API_KEY above. Base URL is separate from the LLM preset's:
# OM_DECISION_OPENROUTER_BASE_URL=https://openrouter.ai/api
# OM_DECISION_MAX_INPUT_TOKENS=24000
# Tests only (never in production): OM_DECISION_FIXTURE_ENABLED=1 with OM_DECISION_PROVIDER=fixture
```

## Edge Cases & Failure Scenarios

| Scenario | Result |
|---|---|
| `OM_DECISION_PROVIDER` unset / unknown / adapter not configured | `getAvailability → available: false`; `decide → unavailable` |
| `fixture` selected without `OM_DECISION_FIXTURE_ENABLED=1`, or in production | Not registered: `available: false, reason: 'fixture_disabled'` |
| Operator sets `OPENROUTER_BASE_URL` for the LLM preset | Decision calls are unaffected (separate base URL env) |
| State not serializable (circular, BigInt) | `invalid_request` |
| Unknown model id (404) | `unavailable` |
| Vendor slow beyond the timeout | `timeout`; the request is aborted |
| Caller aborts | `aborted` |
| 402 credits exhausted / 429 | `insufficient_credits` / `rate_limited` (no retry inside the port; consumers decide) |
| Response missing an option key, or selecting an unknown key | `invalid_response` + `reportError` |
| Probabilities sum within 1 ± 0.02 | Normalized; logged at debug |
| Sum outside 1 ± 0.02, a value outside [0, 1], or a key set mismatch | `invalid_response` |
| `timeoutMs` above 30 000, or missing / non-positive | Clamped to 30 000 ms, or the 5 s default |
| State contains secrets or PII | Sent as given (the caller's responsibility to minimize); never logged |

## Risks & Impact Review

#### R1 — Data sent to a third party
- **Scenario:** A consumer passes customer PII in `state`, and it reaches OpenRouter and its upstream vendor.
- **Severity:** Medium.
- **Affected area:** Tenant data and GDPR.
- **Mitigation:** Consumers must allowlist the fields they send (the workflows spec does). The port never logs state and never sends `user`. The docs state the data flow and the DPA responsibility.
- **Residual risk:** Medium. It is inherent to any hosted model.

#### R2 — Vendor contract churn
- **Scenario:** The endpoint is `/api/alpha/…`, and fields change.
- **Severity:** Medium.
- **Affected area:** The OpenRouter adapter only.
- **Mitigation:** The vendor shape is isolated in one adapter, strict validation turns drift into `invalid_response` rather than wrong answers, and adapter contract tests pin fixture payloads.
- **Residual risk:** Low for consumers. An adapter update is needed when the vendor moves to a stable version.

#### R3 — Over-trusting probabilities
- **Scenario:** Consumers treat probabilities as ground truth, even though they shift with option order and context (JevOut).
- **Severity:** Low.
- **Affected area:** Consumer decision quality.
- **Mitigation:** The port preserves order deterministically, and the docs list the caveats.
- **Residual risk:** Accepted.

#### R4 — Cost visibility
- **Scenario:** High-volume consumers incur unexpected spend.
- **Severity:** Low.
- **Affected area:** Tenant spend.
- **Mitigation:** `usage.costUsd` is returned on every call so consumers can record it, and access gating stays with the consumer.
- **Residual risk:** No global quota in v1.

**Tenant isolation:** the port is stateless and holds no caches. The adapter credentials are deployment-level env, as with `OM_AI_*`.

**Deployment and rollback:** additive. Unset env means the feature is off.

## 📋 Phasing

Single phase. The port is useful only as a whole.

## 📋 Implementation Plan

1. **Types** in `shared` (`decision-model.ts`, types only), plus **schemas** in `ai-assistant` (`decision-model-schemas.ts`). *Test:* schema unit tests for limits, order preservation (including integer-like keys) and the discriminated union, plus a type-level test that `z.infer<typeof decisionRequestSchema>` and `DecisionRequest` are mutually assignable.
2. **Registry** in `ai-assistant` (`decision-model-registry.ts`, `createDecisionModelRegistry`): built-in registration, register, list and resolve with env precedence and reasons. *Test:* env-matrix unit tests (unset, unknown, credentials missing, model missing, `fixture` without opt-in → `fixture_disabled`, per-module override, module-id → env-name rule).
3. **Fixture adapter + double opt-in.** *Test:* deterministic choice (whole-word match, no-match uniform), score and binary results; not registered without the flag or under `NODE_ENV=production`.
4. **OpenRouter adapter**: wire mapping, separate base URL env, HTTP error mapping (including 404/422), response validation and normalization. *Test:* contract tests against request/response fixtures copied from the published schema, one per status code, plus an assertion that `OPENROUTER_BASE_URL` is ignored.
5. **Service + DI**: `decisionModelService` with combined signals (timeout vs abort by reason, `timeoutMs` clamping), the token-based payload cap, the whole-body never-throw catch and the logging rules. *Test:* service unit tests per error code, circular-state serialization, timeout clamping, an adapter that throws and a logger that throws, a hanging adapter, and a logging test asserting that no state or instructions are logged.
6. **Env + docs**: `.env.example` block + template sync, the `apps/docs` page "Decision models" (configuration, port usage example, caveats, data flow), and an `ai-assistant/AGENTS.md` task entry "How to use a decision model".

Integration tests: N/A for this spec (no HTTP surface). The consumer specs cover end-to-end paths using the `fixture` adapter.

## Final Compliance Report — 2026-10-06

### AGENTS.md files reviewed
- `AGENTS.md` (root)
- `packages/shared/AGENTS.md`
- `packages/ai-assistant/AGENTS.md`
- `packages/core/AGENTS.md` (Cross-Module Coupling)
- `BACKWARD_COMPATIBILITY.md`
- `packages/create-app/AGENTS.md` (Template Sync)

### Compliance matrix

| Rule source | Rule | Status | Notes |
|---|---|---|---|
| root | Use DI (Awilix) for services | Compliant | `decisionModelService` |
| root | Validate inputs with zod | Compliant | Request and response schemas |
| root | No `any` | Compliant | `state: unknown` |
| root | Derive TS types from zod via `z.infer` | **Deviation (precedent)** | Types are hand-written in `shared` (which must not depend on the `ai-assistant` schemas), as in `llm-provider.ts`; a type-level equality test prevents drift |
| root | Put every external integration provider in a dedicated package | **Deviation (author decision)** | Adapter in `ai-assistant`, following the LLM-adapter precedent; recorded in Alternatives |
| shared | Shared stays dependency-light, contracts minimal | Compliant | Types only in `shared` |
| root | Ask before adding production dependencies | Compliant | None added (`fetch`) |
| root | Never commit credentials | Compliant | Env references only |
| root | Mirror `.env.example` into create-app | Compliant | Step 6 |
| core → Cross-Module Coupling | Soft-optional resolve for optional peers | Compliant | Consumers resolve DI in try/catch |
| root logging | `reportError` alongside logged errors | Compliant | Service step 5 |
| BACKWARD_COMPATIBILITY.md | New contract surfaces documented | Compliant | Types, import paths, DI key are STABLE once released |

### Verdict
Compliant, with one recorded, author-approved deviation and one precedent-backed deviation (hand-written types).

## Changelog

### 2026-10-06
- Initial specification, split from the workflows AI decision step per author decision. No LLM emulation fallback; port lives in `shared` (types) + `ai-assistant`.

### Review — 2026-10-06
- **Reviewer:** Agent (fresh-context adversarial review)
- **Fixed:**
  - Critical: the `OPENROUTER_BASE_URL` collision with the LLM preset. Now a separate `OM_DECISION_OPENROUTER_BASE_URL`.
  - Dropped the misapplied baseurl-allowlist.
  - Token-based payload cap.
  - Whole-body never-throw catch, plus serialization handling and abort-reason disambiguation.
  - Fixture double opt-in, with rules for every question type.
  - Ordered-array probabilities, and `score` semantics specified.
  - `resolve` returns reasons, and the 404/422 mapping is added.
  - Response validation bounds.
  - Registry and schemas moved out of `shared` (types only remain).
  - `@experimental` plus open unions.
- **Verdict:** Approved for core-team design review.

### Review — 2026-10-15
- **Reviewer:** `om-auto-review-pr` (specification review of open-mercato/open-mercato#7464)
- **Fixed:**
  - The consumer-spec link now says the spec is pending its own PR.
  - The architecture diagram places the registry in `ai-assistant`, matching D1.
  - One probability-sum rule: normalize within 1 ± 0.02, reject anything else.
  - `binary.probability` is defined as P(true), with no `confidence`.
  - The shared `DecisionQuestion`/`DecisionRequest` types are spelled out, the hand-written-types deviation is recorded, and a type-level equality test is added.
  - The registry registers its built-ins itself (`createDecisionModelRegistry`). The bootstrap file, re-export and import-graph test are removed.
  - `fixture_disabled` resolution, `timeoutMs` clamping and `score.value` derivation are specified.
  - The preset reference is stable (constant name instead of a line number).

### 2026-10-16
- Implemented on `feat/ai-decision-model-port` (open PR #7553):
  - Types: `packages/shared/src/lib/ai/decision-model.ts` (types only, `@experimental`).
  - Schemas and answer normalization: `packages/ai-assistant/src/modules/ai_assistant/lib/decision-model-schemas.ts`.
  - Adapters: `lib/decision-adapters/openrouter.ts` and `lib/decision-adapters/fixture.ts`.
  - Registry: `lib/decision-model-registry.ts` (`createDecisionModelRegistry`, `decisionModuleModelEnvKey`, `isDecisionFixtureEnabled`).
  - Service: `lib/decision-model-service.ts`, registered as the `decisionModelService` singleton in `ai_assistant/di.ts`.
  - Tests: `lib/__tests__/decision-*.test.ts`.
  - Env block in `apps/mercato/.env.example`, mirrored in `packages/create-app/template/.env.example`.
  - Docs: `apps/docs/docs/framework/ai-assistant/decision-models.mdx`.
- Implementation notes:
  - The adapters landed before the registry, because the registry registers them itself.
  - The OpenRouter request JSON is built by hand, because `JSON.stringify` reorders integer-like keys (`"2"` before `"10"`) and would break option order (D2).
  - Score `probabilities` from the vendor are accepted as an array or as an index-keyed object, since the vendor shape is not fully published.
  - Vendor error messages are never surfaced; a vendor `error.code` is included in the internal message only when it matches a safe token pattern.
  - A missing `OPENROUTER_API_KEY` at call time maps to `unavailable`.
  - A probability sum within 1 ± 0.02 is normalized and logged at debug (`{ questionName, sum }` only).
- Deviation from Implementation Plan step 6: the `packages/ai-assistant/AGENTS.md` "How to use a decision model" entry was not added. That file's instruction chain is already about 102 KB over the 32 KB budget, and `yarn agents:check-budget` only lets it shrink. The guidance lives on the docs page, which the root Task Router already points AI work to. Adding the entry needs a maintainer decision (trim the file or re-record the budget baseline).
- Review follow-ups (`om-auto-review-pr`): `__proto__` is rejected as a question name or option key, because zod's `z.record` would otherwise drop it silently; D9 wording now matches the shared boolean parser used for the fixture opt-in.
