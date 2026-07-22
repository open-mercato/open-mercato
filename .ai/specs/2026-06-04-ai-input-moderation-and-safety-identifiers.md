# AI Input Moderation & Safety Identifiers

> **Status:** Draft — ready for implementation review
> **Issue:** [open-mercato#2510](https://github.com/open-mercato/open-mercato/issues/2510)
> **Scope:** OSS — `ai_assistant` module (`packages/ai-assistant`), `llm-provider` contract (`packages/shared`)

## TLDR

**Key Points:**
- Add two provider-aware content guardrails to the `ai_assistant` runtime: hashed **end-user safety identifiers** attached to every model call, and an **opt-in, fail-closed input pre-moderation gate** (OpenAI `/v1/moderations`) executed before the model call.
- Protects the instance owner's provider API organization from enforcement (warning → suspension → termination) triggered by abusive end users on untrusted surfaces (customer portal, public widgets).

**Scope:**
- Generic `endUserIdentifier` in the LLM provider contract, mapped per provider (OpenAI `safety_identifier`, Anthropic `metadata.user_id`), value = HMAC — no PII leaves the platform. Always on where supported.
- Input pre-moderation active **only when the resolved chat provider supports it** (initially: OpenAI adapter). Enforced for agents marked `untrustedInput`, tenant-configurable for the rest, default off for backoffice.
- Audit trail of blocked inputs storing **category flags + scores only** — never the prompt content.
- Input-only. Output moderation is explicitly deferred (providers already filter outputs server-side; doubling latency/cost per turn is not justified in MVP).

**Concerns:**
- Moderation adds one extra HTTP round-trip per user turn on enabled agents (~100–300 ms, free endpoint).
- Fail-closed semantics on enforced surfaces mean an OpenAI moderation outage degrades portal chat availability (see Risk Register).

## Overview

Open Mercato deployments are not always backoffice-only with trusted internal staff. The `ai_assistant` module already exposes embeddable `<AiChat>` agents via `/api/ai_assistant/ai/chat?agent=<module>.<agent>`, and portal/customer-facing agents are an expected deployment shape. OpenAI's Usage Policies make the **developer responsible for end-user content**, and enforcement lands on the API-key owner's organization — not the abusive end user. OpenAI's safety best practices name two concrete mitigations this spec implements: hashed per-user `safety_identifier`s (so OpenAI can act on one abuser instead of banning the org) and pre-screening input with the free moderation endpoint.

> **Market Reference**: **LibreChat** (the leading open-source multi-user ChatGPT-style platform) implements exactly this pair: an `OPENAI_MODERATION=true` env toggle that pre-screens input via `/v1/moderations`, plus per-user attribution and ban tooling. We **adopt** the free-moderation-endpoint pre-check and the fail-closed rejection UX. We **reject** LibreChat's global env-only configuration: Open Mercato is multi-tenant with per-agent surfaces, so configuration must resolve per agent definition → per tenant override → default, and identifiers must be tenant-scoped HMACs rather than raw user ids (LibreChat sends its internal user id; we refuse to send anything reversible).

## Problem Statement

- The runtime has strong **authorization** guardrails — ACL features, tool allowlists re-asserted per step by the security-critical `prepareStep` wrapper (`agent-runtime.ts`), mutation approval via `prepareMutation`, model/baseurl allowlists — but **zero content guardrails**. No call to any moderation API exists in the repo; `finishReason: 'content-filter'` (`ai-agent-definition.ts:209`) is only understood reactively after a provider has already filtered.
- No end-user attribution is sent to providers: `LlmCreateModelOptions` (`packages/shared/src/lib/ai/llm-provider.ts:53`) carries only `{ modelId, apiKey, baseURL }`. Provider-side enforcement therefore targets the whole org key.
- There is no per-tenant or per-agent way to declare "this surface accepts untrusted input" — every agent runs with identical (absent) content policy.

## Proposed Solution

Two additive guardrails, wired into existing seams:

1. **Safety identifiers** — the agent runtime computes `endUserIdentifier = HMAC-SHA256(derivedSecret, tenantId + ':' + userId)` from the existing auth context (`McpAuthSuccess.userId` / `tenantId`, `auth.ts:8–17`) and passes it through the model resolution result. Each provider adapter optionally declares how to map it into per-call `providerOptions` (OpenAI → `safety_identifier`, Anthropic → `metadata.user_id`); adapters without a mapping ignore it. The derived secret reuses the memoized per-process HMAC-derivation pattern (`deriveJwtAudienceSecret`, commit `10865faa7`) with purpose label `ai-safety-identifier`, keyed from the existing auth secret env — no new secret to provision, no PII leaves the platform.
2. **Input pre-moderation** — a `ModerationService` (DI-registered in the module's `di.ts`) called in `runAiAgentText` immediately **before** the AI SDK call (pre-loop seam — not per-step; only the new user input of the current turn is moderated, prior history was already screened on its own turns). If the resolved chat provider does not support moderation (capability flag on the provider registry entry, initially only the OpenAI adapter sets it), the gate is skipped. If flagged: persist an `AiModerationFlag` audit record (categories + scores, no content), emit `ai_assistant.moderation_flag.created`, and throw `AiModerationBlockedError`, which the SSE error path surfaces as a translated rejection.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Generic `endUserIdentifier`, provider-mapped | One additive contract change benefits multiple providers; next provider needs only an adapter mapping, not another contract change (Q5). |
| Moderate only when chat provider supports it | The moderation endpoint is OpenAI's API; tenants on Anthropic/Google rely on those providers' server-side filtering. No dedicated moderation key/provider in MVP (Q1). Capability flag keeps the door open for OpenAI-compatible proxies later. |
| Secure-by-default for untrusted surfaces | `untrustedInput: true` on an agent definition **enforces** moderation (not disableable per tenant); other agents are tenant opt-in, default off (Q2). |
| Input-only | Output moderation deferred; providers filter outputs server-side and the runtime already understands `finishReason: 'content-filter'` (Q3). |
| Audit = category flags + scores, never content | Data minimization: enough to identify repeat abusers and tune policy without storing toxic text or PII (Q4). No encryption map needed because no sensitive content is persisted. |
| Fail-closed on enforced surfaces, fail-open on opt-in surfaces | An enforced (untrusted) surface must not silently bypass moderation during an outage; a trusted backoffice surface that opted in prefers availability. Both paths log. |
| Pre-loop gate, not `prepareStep` | The user input is fixed for the whole turn; per-step re-moderation adds latency × steps for zero new information. Mid-loop content is tool output (trusted system data), not user input. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Dedicated moderation provider/key (works for any chat provider) | More configuration surface and a second credential to manage; rejected for MVP per Q1 decision. Capability-flag design allows revisiting additively. |
| Moderation inside the `prepareStep` wrapper | Re-checks identical user input every loop step; wrong altitude — `prepareStep` re-asserts *authorization*, the input content does not change per step. |
| Storing flagged prompt text (encrypted) for incident review | Persisting toxic content + potential PII creates a liability store; category flags identify abusers sufficiently. Can be added later behind its own spec. |
| Client-side moderation call | Trivially bypassable by calling the chat API directly; the gate must live server-side in the runtime. |

## User Stories / Use Cases

- An **instance operator** wants abusive portal users attributed individually to OpenAI so that one bad actor cannot get the whole organization's API key suspended.
- A **tenant admin** wants to enable input moderation for a backoffice agent handling semi-trusted contractor input, so flagged prompts never reach the model.
- A **module developer** shipping a portal-facing agent wants to mark it `untrustedInput: true` so moderation is enforced regardless of tenant settings.
- A **tenant admin** wants to review who is being blocked (category, time, user) without the platform storing the offensive text itself.
- A **portal end user** submitting flagged content gets an immediate, translated rejection message instead of a cryptic provider error.

## Architecture

```
chat API route (/api/ai_assistant/ai/chat)
  └─ runAiAgentText (agent-runtime.ts)
       ├─ resolveAgentModel ──► model-factory.resolveModel
       │     └─ resolution result now carries: provider capability flags,
       │        providerOptions fragment with mapped endUserIdentifier
       ├─ [NEW] moderation gate (pre-SDK-call, pre-loop)
       │     ├─ resolveModerationPolicy(agentDef, tenantOverride)  // enforced | on | off
       │     ├─ ModerationService.checkInput(text) ──► OpenAI /v1/moderations
       │     ├─ flagged ──► persist AiModerationFlag (flags+scores only)
       │     │              emit ai_assistant.moderation_flag.created
       │     │              throw AiModerationBlockedError
       │     └─ not flagged / unsupported provider ──► continue
       └─ AI SDK streamText({ ..., providerOptions: merged })   // safety identifier attached
            └─ existing security-critical prepareStep wrapper (unchanged)
```

- **Contract extension (`packages/shared/src/lib/ai/llm-provider.ts`)** — additive only:
  - `LlmCreateModelOptions` gains optional `endUserIdentifier?: string`.
  - `LlmProvider` gains optional `mapEndUserIdentifier?(identifier: string): Record<string, unknown>` (returns a `providerOptions` fragment) and optional `supportsInputModeration?: boolean`.
  - Adapters not implementing the new members behave exactly as today (BC: ADDITIVE-ONLY on a contract surface).
- **Moderation policy resolution** (precedence, first match wins):
  1. `agentDef.untrustedInput === true` → **enforced on** (tenant cannot disable).
  2. Tenant per-agent override (`ai_agent_runtime_overrides` row with `agent_id`) `input_moderation` → on/off.
  3. Tenant-wide override (row with `agent_id = NULL`) `input_moderation` → on/off.
  4. Env default `OM_AI_INPUT_MODERATION` (boolean, parsed via `parseBooleanWithDefault`) → on/off.
  5. Default **off**.
- **DI**: `ModerationService` registered in `ai_assistant/di.ts`; resolved by the runtime via the container (no `new` at call sites).
- **Module isolation**: everything lives in `ai_assistant` + the shared provider contract; no cross-module ORM links; the audit entity references `userId`/`agentId` as plain FK-style ids.

### Commands & Events

- **Event**: `ai_assistant.moderation_flag.created` — declared via `createModuleEvents` in `ai_assistant/events.ts`; payload `{ id, tenantId, organizationId, agentId, userId, categories }`. Not client-broadcast in MVP.
- **Mutations & undo**: the only new write is the append-only `AiModerationFlag` audit insert — an immutable audit record by design; undo is N/A (deleting audit evidence would defeat its purpose). The flag insert MUST NOT block the rejection: it runs best-effort (failure to persist logs an error but the user still receives the moderation rejection). Tenant settings writes reuse the **existing** `/api/ai_assistant/settings` upsert path (extended schema, same guard rails) — no new mutation surface.

## Data Models

### AiModerationFlag (singular entity, table `ai_moderation_flags`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `tenant_id` | uuid, NOT NULL | tenant scope — every read filters by it |
| `organization_id` | uuid, NULL | org scope when available |
| `agent_id` | text, NOT NULL | `<module>.<agent>` id |
| `user_id` | text, NOT NULL | internal acting-user id from auth context (backoffice user or portal customer account id) |
| `provider_id` | text, NOT NULL | resolved chat provider (e.g. `openai`) |
| `model_id` | text, NOT NULL | resolved model |
| `categories` | jsonb, NOT NULL | `{ [category]: { flagged: boolean, score: number } }` — **no prompt content, ever** |
| `created_at` | timestamptz, NOT NULL | |

Indexes: `(tenant_id, created_at)` for the audit listing; `(tenant_id, user_id)` for per-user abuse review. Append-only — no `updated_at`/`deleted_at`. Access pattern: range scan by tenant + time window, point-ish scan by tenant + user; both covered by the two indexes. No unbounded growth fields; row count growth is bounded by blocked attempts only (see Risks → storage growth).

**Encryption maps**: intentionally none — the entity stores no PII/GDPR content (internal ids + numeric scores only). This is the Q4 data-minimization decision, not an omission.

### `ai_agent_runtime_overrides` (existing table — additive column)

| Column | Type | Notes |
|--------|------|-------|
| `input_moderation` | boolean, NULL | NULL = inherit (env default → off). Existing tenant-wide (`agent_id IS NULL`) and per-agent rows give both override levels with no new table. |

Migration: one additive `ALTER TABLE … ADD COLUMN` + snapshot update via `yarn db:generate` (backward-compatible, no backfill, no downtime).

### `AiAgentDefinition` (additive fields, `ai-agent-definition.ts`)

```typescript
untrustedInput?: boolean   // marks the surface as accepting untrusted end-user input;
                           // forces input moderation ON when the provider supports it
```

## API Contracts

### `GET/PUT /api/ai_assistant/settings` (existing route — extended)

- Guard: existing `ai_assistant.settings.manage` feature (per-method `metadata`, unchanged).
- `runtimeOverrideUpsertSchema` (zod, `settings/route.ts:47`) gains optional `inputModeration: z.boolean().nullable().optional()`.
- GET response additionally returns the effective moderation policy per agent (`enforced` | `on` | `off` | `inherit`) so the UI can render non-editable enforced state.
- `openApi` export updated accordingly.

### `GET /api/ai_assistant/moderation-flags` (new, read-only)

- Guard: `metadata` with `requireAuth` + `requireFeatures: ['ai_assistant.settings.manage']`.
- Query (zod): `page`, `pageSize` (max **100**), optional `agentId`, `userId`, `from`, `to`. All queries filter by the caller's `tenant_id` (and `organization_id` when scoped) — cross-tenant access is structurally impossible.
- Response: `{ items: AiModerationFlagDto[], total, page, pageSize }`.
- Exports `openApi`. Read-only audit listing — `makeCrudRoute` is not used because there are no create/update/delete operations and no query-index entity; a plain guarded route with zod-validated query and parameterized repository reads is the minimal correct shape.

### Chat rejection contract (existing SSE error path — new code)

- `AiModerationBlockedError` → SSE `{ type: 'error', code: 'moderation_blocked' }`.
- Client (`<AiChat>` error handling) maps `moderation_blocked` to `t('ai_assistant.errors.moderationBlocked')`. The raw category list is **not** sent to the end user (no oracle for probing the filter); categories live only in the audit record.

## Internationalization (i18n)

- `ai_assistant.errors.moderationBlocked` — "Your message was blocked by the content safety filter. Please rephrase and try again."
- `ai_assistant.settings.moderation.title`, `….description`, `….enforcedBadge`, `….inheritLabel`, `….onLabel`, `….offLabel`
- `ai_assistant.moderationFlags.title`, `….empty`, column labels (`….columns.agent`, `….columns.user`, `….columns.categories`, `….columns.createdAt`)
- All locales under `packages/ai-assistant/src/modules/ai_assistant/i18n/`; `yarn i18n:check-hardcoded` clean.

## UI/UX

- **Settings (existing `backend/config/ai-assistant` page)**: a "Input moderation" section per agent — three-state control (Inherit / On / Off) rendered with existing form primitives inside the page's settings form (writes go through the existing settings submission path); agents with `untrustedInput` render a non-editable `<StatusBadge>` "Enforced" state with explanatory text. Icon-only controls carry `aria-label`s; lucide-react icons only.
- **Moderation flags audit list**: `<DataTable entityId="ai_assistant.moderation_flag" apiPath="/api/ai_assistant/moderation-flags" columns=… />` with `<EmptyState>` via the `emptyState` prop, category chips rendered as `<StatusBadge>` (semantic status tokens — e.g. `text-status-error-text`; never `text-red-*`), date range filter. `pageSize ≤ 100`.
- **Chat**: blocked input renders the translated rejection inline in the conversation (existing error-message slot in `<AiChat>`), no toast storm, input preserved so the user can rephrase.

## Configuration

- `OM_AI_INPUT_MODERATION` — optional boolean env default for step 4 of policy resolution (parsed with `parseBooleanWithDefault` from `@open-mercato/shared/lib/boolean`).
- `OM_AI_MODERATION_MODEL` — optional, defaults to `omni-moderation-latest`.
- Safety-identifier HMAC secret: derived per process from the existing auth secret with purpose label `ai-safety-identifier` (same memoized pattern as `deriveJwtAudienceSecret`). No new env var; never logged.

## Migration & Compatibility

All changes are **ADDITIVE-ONLY** per `BACKWARD_COMPATIBILITY.md`:

| Contract surface | Change | Class |
|------------------|--------|-------|
| `LlmCreateModelOptions` / `LlmProvider` (shared contract) | new optional members | additive |
| `AiAgentDefinition` | new optional `untrustedInput` | additive |
| DB schema | new column (nullable) + new table | additive, no backfill |
| Events | new event id | additive |
| API | new optional request/response fields + one new read-only route | additive |
| Existing provider adapters / third-party agents | untouched semantics when new members absent | unaffected |

No deprecations, no bridges required. Existing tenants see zero behavior change until an agent declares `untrustedInput` or a tenant/env enables moderation; safety identifiers activate transparently (provider-side metadata only — no response shape change).

## Implementation Plan

### Phase 1 — Safety identifiers (shippable alone)
1. Extend `LlmCreateModelOptions` + `LlmProvider` (`packages/shared/src/lib/ai/llm-provider.ts`) with `endUserIdentifier` / `mapEndUserIdentifier` / `supportsInputModeration`; unit tests for contract defaults.
2. Add `deriveAiSafetyIdentifierSecret` + `computeEndUserIdentifier(tenantId, userId)` helper (memoized HMAC pattern); unit tests (stability, tenant separation, no raw id leakage).
3. Implement `mapEndUserIdentifier` in the OpenAI adapter (`safety_identifier`) and Anthropic adapter (`metadata.user_id`); thread the identifier from `authContext` through `resolveAgentModel` → merged `providerOptions` in `runAiAgentText`; adapter unit tests assert the exact provider-options fragment.
4. `yarn generate && yarn build:packages && yarn typecheck && yarn test` — app works with identifiers silently attached.

### Phase 2 — Moderation gate
1. `ModerationService` (`lib/moderation.ts`, registered in `di.ts`): OpenAI `/v1/moderations` client reusing the resolved provider credentials; zod-parsed response; typed `AiModerationBlockedError` + `AiModerationUnavailableError`; unit tests with mocked HTTP (flagged / clean / timeout / 5xx).
2. Policy resolution `resolveModerationPolicy(agentDef, overrides, env)` implementing the 5-step precedence; exhaustive unit tests.
3. Wire the pre-loop gate into `runAiAgentText` (skip when provider lacks `supportsInputModeration`; fail-closed when enforced, fail-open + warn log when opt-in); add `untrustedInput` to `AiAgentDefinition`.
4. SSE `moderation_blocked` error code + `<AiChat>` translated rendering + i18n keys (all locales). Validation: `yarn typecheck && yarn test && yarn i18n:check-hardcoded`.

### Phase 3 — Tenant settings, audit trail, docs
1. Additive migration: `input_moderation` column on `ai_agent_runtime_overrides` + new `ai_moderation_flags` table (`yarn db:generate`, review SQL + module snapshot; do not run `yarn db:migrate`).
2. `AiModerationFlag` entity + repository; best-effort insert + `ai_assistant.moderation_flag.created` via `createModuleEvents` in `events.ts`; unit tests (insert failure does not mask the rejection).
3. Extend settings GET/PUT (zod + `openApi`) with `inputModeration`; settings UI section (Inherit/On/Off + enforced badge).
4. `GET /api/ai_assistant/moderation-flags` route (guarded, zod query, `openApi`, parameterized reads, `pageSize ≤ 100`) + DataTable audit page.
5. Docs page under `apps/docs/docs/framework/ai-assistant/` (moderation + safety identifiers); update `packages/ai-assistant/AGENTS.md`; `yarn generate` for route/i18n discovery.

### Integration Coverage (required by AGENTS.md)

| Path | Test |
|------|------|
| `PUT /api/ai_assistant/settings` with `inputModeration` | API roundtrip: set per-agent on → GET reflects effective policy; reset to inherit in teardown |
| Chat with moderation enforced + flagged input | Playwright: stubbed moderation response → user sees translated rejection, no model call recorded |
| Chat with moderation off (default) | Playwright: message reaches mock model unchanged (regression guard) |
| `GET /api/ai_assistant/moderation-flags` | API: created flag visible only to its tenant; second tenant gets empty list (isolation probe); fixtures created and cleaned in-test |
| Settings UI moderation section | Playwright: toggle renders, enforced agent shows non-editable badge |

All tests self-contained per `.ai/qa/AGENTS.md` (API-created fixtures, teardown in `finally`, no seeded-data reliance).

### Testing Strategy
- Unit: identifier HMAC (stability/separation), provider-options mapping per adapter, policy precedence matrix, moderation service HTTP edge cases, fail-open vs fail-closed branches, audit insert best-effort.
- Integration: table above.
- No live provider calls in CI — moderation HTTP mocked at the service boundary.

## Risks & Impact Review

#### Moderation API outage blocks enforced surfaces
- **Scenario**: OpenAI `/v1/moderations` is down or times out; agents with `untrustedInput` fail closed, so portal chat rejects all input for the outage duration.
- **Severity**: Medium
- **Affected area**: portal/untrusted chat surfaces only; backoffice opt-in surfaces fail open by design.
- **Mitigation**: short timeout (2–3 s) + one retry; distinct `AiModerationUnavailableError` with its own translated message ("temporarily unavailable", not "blocked"); warn-level structured logs for on-call detection.
- **Residual risk**: enforced surfaces stay degraded during a provider outage — accepted; silently skipping moderation on an untrusted surface is the worse failure.

#### False positives block legitimate users
- **Scenario**: moderation flags benign input (multilingual text and medical/legal topics are known weak spots), frustrating real users.
- **Severity**: Medium
- **Affected area**: enabled/enforced chat surfaces.
- **Mitigation**: default off for trusted surfaces; rejection message invites rephrasing; audit trail (categories + scores) lets operators quantify false-positive rates before widening enforcement.
- **Residual risk**: no per-tenant category thresholds in MVP — deferred until audit data justifies the added settings surface.

#### Provider enforcement despite moderation
- **Scenario**: abusive content passes moderation (jailbreaks, novel phrasing) and OpenAI still issues a violation warning.
- **Severity**: Medium
- **Affected area**: instance owner's provider account.
- **Mitigation**: this is precisely what safety identifiers are for — OpenAI can act on the individual hashed identity instead of the org key; documented operator guidance in docs page.
- **Residual risk**: an org-level ban remains possible under sustained abuse; risk is reduced, not eliminated (real-world precedent exists even with double moderation).

#### Audit table growth
- **Scenario**: a determined abuser hammers a portal agent, generating large volumes of `ai_moderation_flags` rows.
- **Severity**: Low
- **Affected area**: DB storage; audit listing performance.
- **Mitigation**: rows are tiny (ids + jsonb scores, no content); `(tenant_id, created_at)` index keeps listings fast; growth bounded by chat rate limits upstream.
- **Residual risk**: no automatic retention pruning in MVP; acceptable at expected volumes, revisit with a queue-based pruning worker if a tenant exceeds ~1 M rows.

#### Identifier secret rotation changes hashes
- **Scenario**: rotating the auth secret changes every derived `endUserIdentifier`, breaking provider-side abuse-history continuity.
- **Severity**: Low
- **Affected area**: provider-side per-user attribution only; no in-platform impact.
- **Mitigation**: documented in the docs page; identifiers are advisory metadata, not a security control on our side.
- **Residual risk**: post-rotation, provider sees "new" users — accepted; rotation is rare and the alternative (a never-rotating dedicated secret) is worse hygiene.

#### Cross-tenant isolation
- **Scenario**: a bug exposes one tenant's moderation flags or settings to another.
- **Severity**: Critical (if it occurred)
- **Affected area**: `ai_moderation_flags`, settings route.
- **Mitigation**: every query filters `tenant_id` (+ `organization_id` where scoped) — same repository pattern as the existing override repositories; integration test includes an explicit second-tenant isolation probe; identifiers themselves are tenant-salted (`tenantId` inside the HMAC input), so identical users in different tenants produce unrelated hashes.
- **Residual risk**: standard repository-bug risk shared with every scoped entity; covered by the isolation test.

#### Partial failure between flag insert and rejection
- **Scenario**: moderation flags content, but the audit insert or event emit fails mid-flight.
- **Severity**: Low
- **Affected area**: audit completeness only.
- **Mitigation**: rejection is the primary effect and is thrown regardless; insert/emit are best-effort with error logs; no transaction needed because the user-facing outcome never depends on the audit write.
- **Residual risk**: occasional missing audit rows under DB failure — acceptable for an advisory audit trail.

**Blast radius**: feature fails entirely → moderation gates throw/skip per fail-open/fail-closed rules and safety identifiers are simply absent from provider calls; chat for non-enforced agents is unaffected. No other module consumes the new entity or event in MVP. **Detection**: structured warn/error logs on moderation unavailability, flag-insert failures, and identifier-derivation failures.

## Final Compliance Report — 2026-06-04

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/ai-assistant/AGENTS.md` (via Task Router grounding)
- `packages/shared/AGENTS.md` (contract + boolean parsing + i18n)
- `packages/ui/AGENTS.md` / `packages/ui/src/backend/AGENTS.md` (DataTable, settings UI, apiCall)
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `AiModerationFlag` stores plain id columns only |
| root AGENTS.md | Tenant/organization scoping on all scoped queries | Compliant | All reads/writes filter `tenant_id`; isolation probe in integration tests |
| root AGENTS.md | Event IDs `module.entity.action`, singular, past tense | Compliant | `ai_assistant.moderation_flag.created` via `createModuleEvents` |
| root AGENTS.md | Zod validation, types via `z.infer`, no `any` | Compliant | Settings schema extension, flags query schema, moderation response parsing |
| root AGENTS.md | API routes export `openApi`; per-method `metadata` guards | Compliant | Both extended and new routes |
| root AGENTS.md | Feature-gated guards, no `requireRoles` | Compliant | Reuses `ai_assistant.settings.manage` |
| root AGENTS.md | No hard-coded user-facing strings | Compliant | i18n section enumerates keys; `[internal]` prefix for internal errors |
| root AGENTS.md | `pageSize ≤ 100` | Compliant | Flags listing capped |
| root AGENTS.md | Migrations via `yarn db:generate`, no local `yarn db:migrate` | Compliant | Phase 3 step 1 |
| root AGENTS.md | AI mutation approval contract untouched | Compliant | No mutation-tool changes; `prepareStep` wrapper unchanged |
| BACKWARD_COMPATIBILITY.md | Contract surfaces additive-only | Compliant | See Migration & Compatibility table |
| spec checklist §3 | Encryption maps for PII columns | N/A — justified | No PII/content persisted (Q4 decision documented in Data Models) |
| spec checklist §4 | Undo for mutations | N/A — justified | Append-only audit record; settings reuse existing upsert path |
| spec checklist §5 | Canonical primitives (DataTable, apiCall, DI cache, createModuleEvents) | Compliant | DataTable for audit list; apiCall in UI; service via DI; no DIY substitutes |
| spec checklist §5 | `makeCrudRoute` for CRUD APIs | N/A — justified | Read-only audit listing, no mutations, no index entity (rationale in API Contracts) |
| .ai/ds-rules.md | Semantic status tokens, no arbitrary sizes, lucide icons, `aria-label`, dialog keys | Compliant | UI/UX section uses `StatusBadge`/`EmptyState`/semantic tokens; no new dialogs |
| .ai/qa/AGENTS.md | Self-contained integration tests for all affected paths | Compliant | Integration Coverage table |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Flag DTO mirrors entity; settings field present in schema + UI |
| API contracts match UI/UX section | Pass | Settings three-state ↔ schema nullable boolean; audit DataTable ↔ list route |
| Risks cover all write operations | Pass | Flag insert (partial-failure risk), settings upsert (existing path) |
| Commands defined for all mutations | Pass | Audit insert documented as append-only/no-undo; no other new mutations |
| Cache strategy covers all read APIs | Pass | No new cache in MVP; per-turn repository reads reuse existing override-repository pattern (documented) |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — ready for implementation.

## Changelog

### 2026-06-04
- Initial specification (issue #2510). Open Questions resolved: Q1 chat-provider-gated moderation, Q2 secure-by-default for `untrustedInput` agents, Q3 input-only, Q4 categories+scores audit without content, Q5 generic provider-mapped `endUserIdentifier`.

### Review — 2026-06-04
- **Reviewer**: Agent
- **Security**: Passed — no PII persisted or sent (HMAC identifiers), fail-closed enforced surfaces, no category oracle to end users, tenant-salted hashes, parameterized reads
- **Performance**: Passed — one extra HTTP call per enabled turn with timeout+retry bound; indexed audit reads; no per-step re-moderation
- **Cache**: Passed — no new cache surface; documented as N/A with existing repository reads
- **Commands**: Passed — single append-only audit write, undo N/A justified; settings reuse existing upsert
- **Risks**: Passed — outage, false positives, residual ban risk, growth, rotation, isolation, partial failure covered with mitigations
- **Verdict**: Approved
