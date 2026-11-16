# AI provider policy: staged enforcement for tenant model calls

> **Program:** provider-policy part of F1 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md), issue open-mercato/open-mercato#8593. [`2026-11-16-ai-model-input-minimisation.md`](2026-11-16-ai-model-input-minimisation.md) records the model-input part: option B (DEC-11), no field-level model-input control, with G5's disclosure of what the assistant sends to a model.
> **Status:** proposed; no implementation. Current-code evidence was checked in the read-only repository at the supplied spec commit. Tests below are delivery requirements, not results.

Extends: .ai/specs/GDPR/2026-11-15-gdpr-ready-deployments-program.md

## 📝 TLDR

The tenant allow-list is advisory for typed agents and absent from several other model paths. This design adds a shared policy check, covers both enterprise runners, and separates local attachment extraction from extraction by a model. Enforcement for every covered feature is opt-in for one minor. Embeddings remain outside this acceptance contract until the named search-settings work lands.

## 📝 Overview

The list constrains a feature's own provider and model; it does not choose another vendor for it. The operator still controls endpoints. OSS owns the shared helper, schema and core callers. Enterprise callers change inside `packages/enterprise`; OSS never imports that package.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | What the list constrains | Provider and model, never a replacement choice | Each feature retains its own selection and resolution precedence. |
| 2 | A forbidden choice | Refuse when enforcement is enabled | A list that never refuses does not constrain egress, so F1 needs the refusal. It changes advisory behavior, so it ships behind the shared opt-in bridge of assumption 3 under the ordinary protocol (DEC-5). |
| 3 | Rollout | One `enforceForCalls` setting for all covered paths, default false for the bridge minor | Includes legacy chat, moderation and enterprise runners. No non-chat feature starts refusing policy violations merely on upgrade. |
| 4 | Policy storage unavailable | A typed unavailable result; refuse when the mode is unknown or enforcement is on; preserve legacy advisory list-read failure once the flag is known off | An unreadable policy is never read as no policy. Without the flag the helper cannot tell an enforcing tenant from an advisory one, so a failed flag read refuses. This is a declared availability change even in the bridge minor, named in the upgrade note; it adds little outage surface, because covered calls already depend on the same database. Once advisory mode is established, a later legacy list-read failure keeps its current fail-open behavior. In enforced mode every list-read failure refuses. |
| 5 | Module environment override | Retained, but checked before provider/key resolution in enforced mode | It cannot silently override the tenant restriction. |
| 6 | Sending files to a model | A separate partition switch, false on new partitions; existing partitions copy `requires_ocr` | New partitions send no file to a model until an administrator turns the switch on, which is privacy by default. Existing partitions keep their effective behavior, so the upgrade changes nothing that already runs. `requires_ocr` keeps controlling local extraction. |
| 7 | Endpoints | Operator-controlled; no tenant endpoint constraint | The list stores providers and models only. A tenant base-URL override is accepted and used only inside the operator's `AI_RUNTIME_BASEURL_ALLOWLIST`, re-checked on every read (`packages/ai-assistant/src/modules/ai_assistant/lib/baseurl-allowlist.ts`), so the endpoint stays the operator's choice. Settings and docs name the endpoint and that responsibility; the doctor warns on a non-EU provider choice (DEC-6). |
| 8 | OpenCode without an explicit model | In enforced mode resolve, check and pass a concrete pair on every send | Covers legacy chat and the enterprise OpenCode runner, including its nudge. Advisory mode keeps existing selection. |
| 9 | Inbox fallback | Keep `OPENCODE_*`; check its pair before building a client in enforced mode | Removal follows the ordinary deprecation protocol; policy refusals are never factory errors. |
| 10 | Organization fallback | Use one new effective-policy repository method for helper and typed runtime | Organization row wins, then tenant row, so a tenant's restriction reaches every organization that has not set its own. An organization row, including an explicit empty list, replaces the tenant row; both rows sit behind the same feature ACL. The exact existing getters remain available. |

### Alternatives considered

| Alternative | Why not chosen |
|---|---|
| Keep the list advisory (assumption 2) | It never refuses, so F1 would have no enforceable provider control. |
| Treat a failed flag read as advisory (assumption 4) | A transient database error would silently turn an enforcing tenant fail-open. |
| New partitions copy the OCR seed default (assumption 6) | New tenants' files would reach a model with no administrator choice. |
| A per-tenant `allowed_base_urls` column (assumption 7) | Tenant endpoints are already bounded by the operator's allow-list, so the column would constrain nothing new. |
| Exact organization matching for every caller (assumption 10) | A tenant row would never reach organizations without their own row, so the tenant's restriction would fail open. |

## 📝 Problem Statement

| Current path | Behavior verified in code | Evidence |
|---|---|---|
| Typed agents | Factory intersects the tenant list, can replace a forbidden pair, and keeps a forbidden provider when none permitted is configured | `packages/ai-assistant/src/modules/ai_assistant/lib/model-factory.ts:761-800`, `:870-897` |
| Inbox | Throwaway container without tenant; any `AiModelFactoryError` reaches the legacy structured-client fallback | `packages/core/src/modules/inbox_ops/lib/llmProvider.ts:140-196`; extraction caller is `subscribers/extractionWorker.ts`, not `lib/` |
| Warranty, judge, query routing, web search | Own model-resolution paths; all must join the helper | `packages/core/src/modules/warranty_claims/lib/aiAssist.ts`; assistant `api/route/route.ts`; enterprise `lib/eval/llmJudge.ts` and `lib/webSearch/registry.ts` |
| Native enterprise runner | Actual egress is `runAiAgentObject`; its direct factory use only obtains a budget key | `packages/enterprise/src/modules/agent_orchestrator/lib/runtime/nativeAgentRunner.ts:393-406`, `:567-572` |
| Enterprise OpenCode runner | Tenant run creates a session; both initial send and nudge pass an agent and timeout, without a model | `packages/enterprise/src/modules/agent_orchestrator/lib/runtime/openCodeAgentRunner.ts:157-182`, `:603-605`, `:638-643` |
| Legacy chat | Application handlers send to OpenCode, which can pick its own configured model | `packages/ai-assistant/src/modules/ai_assistant/api/chat/route.ts`; `lib/opencode-handlers.ts` |
| Moderation | Direct request using the chat resolution's key and endpoint, with a separate moderation model | assistant `lib/moderation.ts`; `lib/agent-runtime.ts:1737-1747` |
| Attachment OCR | Direct OpenAI client; queue returns early without its key and looks up a partition by code alone | `packages/core/src/modules/attachments/lib/ocrService.ts`; `lib/ocrQueue.ts:71-85` |

The private `resolveTenantAllowlistSnapshot` takes a container, resolves its entity manager, and returns null for absent scope, absent storage or lookup failure (`agent-runtime.ts:1171-1194`). `AiTenantModelAllowlistRepository.getForTenant` matches organization exactly, including null; it has no tenant fallback today. Both behaviors need explicit new contracts rather than being described as existing loaders.

### Embeddings handoff — search-settings owner

The owning design is [`2026-06-15-tenant-scoped-search-settings.md`](../2026-06-15-tenant-scoped-search-settings.md), under **Architecture**, **2. Tenant-scoped search settings + env-derived defaults (Q2)**, **2a. Runtime configuration isolation** and **Implementation Plan — Phase 2 — Tenant-scoped search settings + env-derived defaults**. It specifies `resolveEmbeddingConfig(resolver, { scope, defaultValue })` and `saveEmbeddingConfig(resolver, config, { scope })`, trusted tenant resolution in all four readers, operation-scoped immutable configuration/service snapshots, and removal of first-party process-wide `vectorEmbeddingService.updateConfig` writes. The readers are `packages/search/src/modules/search/workers/vector-index.worker.ts:228` (batch), `:344` (single job), `packages/search/src/modules/search/api/search/route.ts:104` and `packages/search/src/modules/search/api/search/global/route.ts:108-111`. The fifth call site is the settings-save mutation in `packages/search/src/modules/search/api/embeddings/route.ts:341-345`. The owner's Phase 2 also requires interleaved two-tenant worker/query/save tests. This is specified work awaiting implementation and verification; scoping `module_configs` alone does not close the defect.

Embeddings are explicitly excluded from this spec's policy guarantee and guard enforcement. The program's F1 and B4 rows link that owner; its B4 inventory and Phase 6 handoff must include all five call sites and cite the established runtime-isolation design. Those remaining program edits are tracked under Needed elsewhere; the handoff is not evidence the fix has landed.

## 📝 Proposed Solution

### Policy loading and selection

Add `getEffectivePolicy(scope: { tenantId: string; organizationId?: string | null })` to `AiTenantModelAllowlistRepository`; keep `getForTenant` and `getSnapshot` exact-match contracts. The new method reads the organization's active row, then the tenant's null-organization row only when the organization row is absent. An explicit empty list is loaded and denies all; it never falls through. A null provider list with no model restrictions is loaded and inherits the operator constraints. Its promise resolves to `{ status: 'loaded', snapshot, enforceForCalls, source }`, `{ status: 'none' }`, or `{ status: 'unavailable', code }`; `snapshot` keeps the existing `AiTenantModelAllowlistSnapshot` shape. `source` is `organization` or `tenant`; errors contain no content or credentials. The helper and typed runtime use this same method in enforced mode. Advisory mode retains the old exact getter and fail-open chat loader during the bridge, so organization inheritance for provider enforcement is opt-in; the effective loader and its fallback are delivered once, not duplicated. No row means legacy behavior; unreadable is never none. Failure to establish the mode returns unavailable and refuses. Once the mode is successfully established as advisory, the old chat loader may still return null on its subsequent list-read failure; that legacy result is not treated as an enforced-policy read. With enforcement on, every list-read failure refuses.

The model-input sibling records option B (DEC-11): no field-withholding member is added to this result, and no field-level model-input control is built. Provider permission is never presented as field minimisation; G5's disclosure states what reaches a model.

`resolveTenantModel` takes explicit tenant or system scope. It does not apply an agent override to a non-agent feature. In enforced mode it first derives the requested/default provider-model candidate using the factory's existing precedence, without resolving credentials, constructing a model, consulting the tenant list for replacement, or falling back. Extract that pure candidate selection into an additive factory utility; keep existing factory behavior for old callers. Check this candidate against the effective tenant list before any key lookup. A forbidden candidate produces `ai_provider_not_permitted` even when no provider key exists. The additive utility can inspect provider identity/defaults and configured-availability metadata; it must not require a key merely to recognize an explicit forbidden pair. Then call the factory without `tenantAllowlist`, and verify its final pair again before returning or sending. Operator constraints and fallback must never turn a forbidden initial feature choice into an allowed one. If no candidate can be selected, return the existing configuration error; do not invent a pair for the policy check.

With enforcement off, preserve each path's existing factory/fallback behavior, including chat's advisory tenant-list replacement. Report which covered features would be refused on the settings page without constructing clients or sending content. The enforcement setting is installed in Phase 1, before any caller changes. The one-minor bridge applies to non-chat as well as chat calls.

### Callers

- Inbox, warranty, query routing in both branches, enterprise judge and web-search model adapter use the helper in Phase 1, carrying the tenant and optional organization from the real request/job. Inbox's fallback uses the check-only method before client creation; its refusal is not an `AiModelFactoryError`.
- Legacy chat and enterprise `OpenCodeAgentRunner` use the check-only method. Legacy `api/chat/route.ts` runs preflight before opening its SSE response and forwards the checked pair to the handler; handlers also check direct in-process calls so no unwrapped caller bypasses policy. In enforced mode they resolve a concrete pair from the feature/agent choice and configured defaults, check it before session content leaves, and pass it as the model option on both the initial `sendMessage` and every nudge. If selection/check fails, no send occurs. They never permit OpenCode's configuration to select another pair after the check. Advisory mode preserves current behavior.
- Native enterprise runs are typed-agent calls. Their actual `runAiAgentObject` path gains enforcement in Phase 3 with the other typed agents. Their budget-key resolution remains a send-nothing exception; it is not enforcement. The caller inventory and rollout must say so until Phase 3 lands.
- Moderation checks the provider only, using the same effective scope and enforcement flag. A permitted provider's moderation endpoint is permitted even if its chat-model list omits `omni-moderation-latest`; no settings entry for that moderation model is required. A forbidden provider causes no request and follows today's moderation-unavailable handling. Enforcement off preserves today's moderation behavior.
- Attachment model extraction uses the event's tenant, scopes partition and attachment reads to the permitted tenant/organization or explicit shared partition, and checks policy before the old no-key early return. Local extraction stays independent.

### Guard

`packages/ai-assistant/src/__tests__/model-egress-guard.test.ts` scans `packages/*/src` outside tests. It rejects provider-client construction, registry `createModel`, recognized direct provider requests, direct factory resolution, and OpenCode `sendMessage` outside named files. Permit provider adapters/bootstrap/factory, `tenant-model.ts`, the deliberately uncovered embedding service, and checked moderation/legacy OpenCode handlers. The enterprise OpenCode runner is permitted only with tests proving both sends receive the checked pair. Send-nothing factory exceptions remain the settings probe, agent model picker and native budget resolver.

Temporary entries are explicit: `attachments/lib/ocrService.ts`, introduced 2026-11-16, expires on Phase 2 completion; `agent-runtime.ts`, introduced 2026-11-16, unchecked factory bypass expires on Phase 3 completion (its explicitly tested advisory branch remains during the bridge); `inbox_ops/lib/llmProvider.ts`, introduced 2026-11-16, direct-client fallback expires at removal in the minor after the bridge release. Each has a reason and removal milestone in a typed guard fixture. The milestone test fails if an entry remains after its phase/removal version; sample tests reject unlisted factory calls and OpenCode sends. Guard phases ship with their matching caller tests. Per-file allowances are not proof that every call in a file is safe.

### Attachments

Add `attachment_partitions.model_extraction_enabled`, backfilled from `requires_ocr`; new rows default false. `requires_ocr` continues to control local extraction. The settings page uses locale keys, shared components and guarded writes, shows both switches, and names the selected provider/endpoint. Model refusal never loses the upload or local text. Store `attachments.storage_metadata.modelExtraction = { status, reason }`, where status is `off | refused | unavailable | complete` and reason is a bounded code, never text or credentials. `GET /api/attachments` exposes this as additive `modelExtraction`; the client cannot overwrite this server-owned metadata key.

## 📝 Delta

### Capability: ai-provider-policy

#### MODIFIED Requirement: Provider selection for covered model calls
When `enforceForCalls` is true, covered non-chat paths SHALL check their selected provider-model pair before credential lookup or fallback and refuse forbidden choices. Typed agents and the native runner gain the same behavior in Phase 3. Legacy chat and the OpenCode runner SHALL pass the checked pair explicitly on every send. Moderation checks provider eligibility only. Embeddings are excluded. With enforcement false, existing model selection remains available for the bridge minor. Endpoints remain operator-controlled.

##### Scenario: Forbidden A, permitted B
- WHEN enforcement is on, a feature selects A, and B is permitted and configured
- THEN the call returns `ai_provider_not_permitted`, with no replacement or provider request, even if A has no key

##### Scenario: Bridge mode
- WHEN enforcement is off
- THEN covered paths retain their prior advisory behavior, and settings show the enforcement coverage and preview

##### Scenario: Scope and loader
- WHEN an organization has no row but its tenant does
- THEN helper and typed runtime read the same tenant row; an organization row, including an empty deny-all list, wins; neither row means no tenant restriction
- WHEN mode loading fails or an enforced list read fails
- THEN the typed unavailable error is distinct from no row, and no model request is made
- WHEN advisory mode was successfully established and its legacy list read later fails
- THEN the existing advisory fallback remains available during the bridge

##### Scenario: OpenCode
- WHEN enforcement refuses a legacy turn or enterprise OpenCode run
- THEN neither its initial send nor its nudge is made
- WHEN it permits the pair
- THEN every send carries that same pair

##### Scenario: Moderation
- WHEN the provider is permitted and only its chat models are listed
- THEN moderation may run without adding its separate model id to that list

##### Scenario: Missing scope
- WHEN a tenant caller loses its tenant id
- THEN validation refuses it; only explicit system scope uses installation defaults

Frozen by: proposed `llm-provider-resolution.characterization.test.ts` and `model-factory-allowlist.characterization.test.ts` under their owning modules' `lib/__tests__/` directories.

#### MODIFIED Requirement: Attachment text extraction
The system SHALL send files to a model only when the new switch is on and, when enforcement is enabled, the policy permits the pair. Local extraction remains independent. Existing partitions keep their effective value; new partitions default to no model extraction.

##### Scenario: Model off or refused
- WHEN a file is uploaded with model extraction off or a forbidden pair under enforcement
- THEN it is stored, local extraction still runs, and `modelExtraction.reason` explains why no model was used

Frozen by: `packages/core/src/modules/attachments/lib/__tests__/ocr-config.test.ts`.

## 📝 Architecture

New assistant helper and pure selection utility; additive repository loader; existing caller modules integrate through package exports, never another module's tables. Enterprise runner changes remain enterprise-owned. The shared helper reads its own repositories through the scoped container. Use encryption-aware helpers for entity reads. No content enters policy errors or preview results. Settings lists keep `pageSize` at most 100.

## 📝 Data Models

| Table | Additive change |
|---|---|
| `ai_tenant_model_allowlists` | `enforce_for_calls boolean NOT NULL DEFAULT false`, exposed as `enforceForCalls`; reuse existing `updated_at` |
| `attachment_partitions` | `model_extraction_enabled boolean`, existing-row backfill from `requires_ocr`, new-row default false; reuse `updated_at` |
| `attachments` | Server-owned `storage_metadata.modelExtraction`; no new column |

Include migrations and snapshots. The allow-list and partition settings responses return `updatedAt`; their edit/delete paths use the shared optimistic-lock headers and conflict UI. No new settings table or vague 'tenant AI settings' row is introduced.

## 📝 API Contracts

```ts
type ModelCallScope =
  | { kind: 'tenant'; tenantId: string; organizationId?: string | null }
  | { kind: 'system'; reason: string }
resolveTenantModel({ container, moduleId, scope, provider?, model? })
assertTenantModelPermitted({ em, moduleId, scope, providerId, modelId?, check: 'pair' | 'provider' })
```

These are new package exports; define their Zod schemas and inferred types before implementation. Tenant scope requires a non-empty UUID; missing scope never means system. System reason is an internal bounded code. Pair checks require a model; provider-only checks are reserved for moderation. The resolver returns the factory resolution with provider/model ids and endpoint. `AiProviderNotPermittedError` has code `ai_provider_not_permitted`; unreadable policy uses `ai_policy_unavailable`, and missing scope uses `ai_scope_required`. Policy refusals are not factory errors. HTTP callers map policy refusal to 403 `{ code: 'ai_provider_not_permitted' }` and storage failure to 503 `{ code: 'ai_policy_unavailable' }` before starting a stream; workers/runners record the same bounded code without prompt text.

`PUT /api/ai_assistant/settings/allowlist` accepts optional `enforceForCalls`; the settings read returns it, its effective source, coverage by phase and `updatedAt`. Keep existing feature-based authorization and organization-scoped writes. Exact API prefix is the module route mapping; do not introduce a separate settings endpoint. Partition API adds `modelExtractionEnabled`; attachment list adds `modelExtraction`. `OM_DEFAULT_ATTACHMENT_MODEL_EXTRACTION_ENABLED=false` seeds only new partitions; mirror its documentation in `apps/mercato/.env.example` and the create-app template. Preserve `OM_DEFAULT_ATTACHMENT_OCR_ENABLED` for local extraction.

## 📝 Edge Cases & Failure Scenarios

| Case | Behavior |
|---|---|
| Explicit empty list | Enforced mode denies all; no fallback to tenant row or other provider |
| Mode unknown or enforced list unavailable | `ai_policy_unavailable`, never absence; no egress; availability decision in assumption 4 |
| Flag known false, later advisory chat list read fails | Existing fail-open advisory loader; no claim of enforced policy |
| Forbidden pair and missing key | Policy refusal precedes `api_key_missing` |
| Factory changes the pair under operator constraints | Check the final pair too; never revive an initially forbidden choice |
| Inbox factory error | Check the `OPENCODE_*` pair before creating the fallback client |
| Native runner before Phase 3 | Advisory, stated on settings coverage; not counted as enforced |
| Missing tenant in job | Reject tenant scope rather than creating a throwaway system container |
| No tenant row | Existing behavior; operator constraints still apply |
| Explicit system job | Installation defaults, internal reason, no tenant inheritance |
| Permitted provider with unexpected endpoint | Allowed; operator controls it, as stated in settings and docs |

## 📝 Migration & Backward Compatibility

All enforcement paths use the same opt-in flag, off for one minor, with a startup/settings warning naming the next minor. Preview lists inbox, warranty, routing, web search, legacy chat, OpenCode, moderation, attachments, and typed/native agents with their delivery phase. Retain old factory getters and signatures; export candidate selection additively. Mark `createStructuredModel` deprecated with guidance and a removal version, preserve it for at least one minor and document it in `UPGRADE_NOTES.md`. Organization inheritance is a declared new behavior shared across callers; the old exact getters remain stable. The upgrade note also names the unknown-mode refusal of assumption 4 as an availability change that applies even before a tenant opts in. Use program DEC-5's ordinary protocol, not a security exception.

F1's enforcement deliverable closes at Phase 3 with the bridge explicitly documented; it does not claim a default flip or embedding protection. The release after the bridge minor is a separately reviewed follow-up: turn the default on, retain explicit advisory opt-out, update docs and remove only expired exceptions. Its release version must be recorded before implementation of the flip. No automatic flip occurs in these phases.

## 📋 Phasing

| Phase | Outcome | Ships alone |
|---|---|---|
| 1 | Flag, shared loader/helper/preflight, non-chat and both OpenCode integrations, guard, API integration | Yes, with advisory bridge default |
| 2 | Attachment switch, outcome API and mandatory attachment integration | Yes, after Phase 1 |
| 3 | Typed-agent and native runner enforcement, final coverage tests | Yes, after Phase 1; provider-policy deliverable closes with stated exclusions; F1's model-input part is G5's disclosure under DEC-11 |

## 📋 Implementation Plan

### Phase 1
1. Characterize factory swaps/forbidden-provider behavior, exact organization getter and advisory typed runtime before modification.
2. Add flag/schema migration, effective loader and pure candidate utility. Unit suites `tenant-model.test.ts` and `effective-policy.test.ts`: organization row, tenant-only row, neither, explicit empty row, database error, forbidden A with configured B, forbidden A without key, final-pair change, explicit system scope, missing tenant and refusal type.
3. Wire direct callers, legacy handlers and enterprise OpenCode runner. Unit suites `open-code-policy.test.ts`, `inbox-policy.test.ts` and `moderation-policy.test.ts`: initial/nudge carry checked pair; refusal makes zero sends/clients; inbox cannot swallow refusal; chat-model-only list permits moderation on that provider; provider refusal makes zero moderation requests; flag off preserves behavior.
4. Add milestone-aware guard samples and TC-AI-POLICY-002. Upgrade note and settings preview/UI test; no Phase 1 delivery with unit tests alone.

### Phase 2
1. Partition migration/backfill, switches, optimistic-lock conflict handling, server-owned extraction outcome and additive list projection. Unit suites cover backfill, all switch combinations and policy-before-key ordering.
2. Route OCR through helper using event scope and remove its guard exception. Deliver TC-AI-POLICY-001 in this phase; update both environment examples and docs.

### Phase 3
1. Typed runtime uses the effective loader and preflight/final checks only when flag is on; native `runAiAgentObject` inherits it. Remove the unchecked runtime guard bypass; retain only the tested enforced/advisory dispatcher during the bridge. Unit tests cover flag on/off, organization fallback, unreadable policy and forbidden pair with an allowed alternative.
2. Deliver TC-AI-POLICY-003; docs show complete covered inventory and embedding exclusion. Record the next-minor default follow-up, and archive Delta only if the capability directory has been adopted.

| File | Action |
|---|---|
| `packages/ai-assistant/src/modules/ai_assistant/lib/{tenant-model.ts,model-factory.ts,agent-runtime.ts,opencode-handlers.ts}` | New helper/utility, runtime and handler checks |
| Assistant `api/chat/route.ts`, `data/{entities.ts,repositories/AiTenantModelAllowlistRepository.ts}`, `api/settings/{route.ts,allowlist/route.ts}`, `api/route/route.ts`, migrations, settings UI and locale files | Effective loader, flag, preview, optimistic locking |
| `packages/core/src/modules/inbox_ops/lib/{llmProvider.ts,translationProvider.ts}`, `subscribers/extractionWorker.ts`, `ai-tools.ts` | Thread tenant, checked fallback |
| `packages/core/src/modules/warranty_claims/lib/aiAssist.ts` | Helper |
| `packages/enterprise/src/modules/agent_orchestrator/lib/{eval/llmJudge.ts,runtime/nativeAgentRunner.ts,runtime/openCodeAgentRunner.ts,webSearch/registry.ts}`, `api/web-search/settings/route.ts` | Enterprise-owned integration |
| `packages/core/src/modules/attachments/{data/entities.ts,lib/ocrService.ts,lib/ocrQueue.ts,lib/partitions.ts,api/route.ts,components/AttachmentPartitionSettings.tsx,migrations/*}` | Switch, outcome, scoped reads |
| `packages/ai-assistant/src/__tests__/model-egress-guard.test.ts`; owning modules' unit suites and `__integration__/TC-AI-POLICY-00{1,2,3}.spec.ts` | Mandatory validation |

## 🧪 Integration Coverage

Every test owns tenant, organization, user/ACL and records, uses API fixture creation, and removes fixtures in `finally`. No seeded data or external provider is required for denied-path tests. Set `allowedProviders: []` and `enforceForCalls: true` through the allow-list route; the empty list is valid independently of operator keys. Do not use a nonexistent provider key as the proof of refusal.

| Test | Delivery and assertions |
|---|---|
| TC-AI-POLICY-002 | Phase 1: read/write allow-list and settings preview with own admin; settings UI lists the refused features and current delivery coverage; legacy chat request names no model, causing the existing `resolveAiProviderIdFromEnv` / `resolveOpenCodeModel` configuration-only defaults to select a concrete pair without any key lookup, and returns exact `ai_provider_not_permitted`, never configuration unavailable; both routing branches and enterprise OpenCode-run API in enterprise lane refuse identically; no model send occurs; another tenant remains advisory; stale settings edit gets conflict |
| TC-AI-POLICY-001 | Phase 2: create own partition; edit both switches through API and UI; deny all with enforcement on; upload file to that partition; poll `GET /api/attachments` for `modelExtraction.status=refused` and exact `ai_provider_not_permitted`; local text remains; stale partition edit conflicts; delete uploads, partition and policy in cleanup |
| TC-AI-POLICY-003 | Phase 3: own typed agent fixture and native-run fixture in enterprise lane; flag on refuses selected pair before generation, flag off preserves advisory behavior with a deterministic test adapter; organization override and tenant-only fallback agree across helper/chat; settings page lists native enforcement and explicit embedding exclusion |

Permitted direct callers also require unit tests with fake adapters; enterprise tests ship with the enterprise caller changes. Each changed route is exercised in its phase, with preview and partition UI paths included.

## 📝 Risks & Impact Review

| Scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Tenant enabled enforcement and features stop | High | All covered calls | Shared opt-in bridge, preview, exact policy error, explicit advisory opt-out | Administrator can deliberately restrict a needed model |
| Mode read or enforced policy load fails | Medium | Scoped AI availability | Typed unavailable result; no egress; advisory list reads preserve legacy fallback once mode is known; the unknown-mode refusal is named in the upgrade note (assumption 4) | Database incidents can stop AI even during bridge |
| New caller bypasses checks, especially OpenCode | High | Tenant input | Guard covers sends and factory calls; initial/nudge unit tests | Plain HTTP patterns and additional calls within permitted files need review |
| Embeddings use another tenant's configuration | High | Search input | Named owning spec and exact readers/singleton write; explicit exclusion | Live defect remains until that owner delivers scoped instances |
| Tenant assumes list constrains location | Medium | Processing endpoint | Endpoint shown, operator responsibility documented | Vendor processing cannot be verified here |
| OpenCode's own model differs from application defaults | Low | Enforced legacy/enterprise runs | Concrete checked pair passed on every send | Opt-in can change the model previously selected by OpenCode |

## Final Compliance Report — 2026-11-16

| Rule | Status | Notes |
|---|---|---|
| Ordinary behavior bridge | Compliant design | All covered features opt-in for one minor; default flip separate; the unknown-mode refusal is a declared availability change, named in the upgrade note (assumption 4) |
| Tenant and organization scope | Compliant design | Explicit discriminated scope, shared effective loader, no cross-module table reads |
| Additive contracts | Compliant design | Old getters/factory behavior retained; schema and exports additive; legacy helper bridged |
| Optimistic locking, ACL, i18n | Required delivery gate | Settings/partition versions, feature guards, shared UI calls and translated labels |
| Integration coverage | Required delivery gate | Mandatory tests in each phase, own fixtures and cleanup; enterprise lane covers both runners |
| Product decisions | Decided | Assumptions 1–10 are settled; each phase PR goes through ordinary maintainer review |

**Verdict:** design decided; implement by phase. The provider-policy part of F1 is scoped to the staged coverage above; embeddings and the default flip remain explicit follow-ups. F1's separate model-input part is option B (DEC-11): G5's disclosure ships before #8593 closes.

## Changelog

### 2026-11-16
- Written autonomously as "AI data protection", covering provider policy, text extraction, embeddings and a filter on tool results.
- Rewritten after independent review, and narrowed. The allow-list never refuses today, so "refuse" is now an explicit check after the factory and a marked behaviour change. The tenant's list constrains each feature's own model instead of replacing it. The attachment change is a second switch, because the existing one is a stored per-partition value that also gates local extraction, and its environment default only seeds new rows. Saving embedding settings installation-wide is dropped: it would have reintroduced a cross-tenant overwrite fixed by two earlier specs. The legacy chat route, moderation and a legacy helper were missing from the inventory and are added. The tool-result filter moved to its own spec.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: g6-03 — the tenant's list has no endpoint field, so the requirement and the helper now check provider and model only; endpoints stay the operator's, marked for confirmation as assumption 7 with a per-tenant `allowed_base_urls` fallback. g6-06 — inbox's `OPENCODE_*` fallback on any `AiModelFactoryError` is named in the inventory; for tenant calls its pair passes the same check, and the refusal is an error the fallback cannot swallow (assumption 9). g6-07 — a check-only `assertTenantModelPermitted` for moderation, which uses the chat resolution's provider and the moderation model, and for the legacy chat handlers, which pass the checked pair explicitly when a tenant with a list sends a turn naming no model (assumption 8). g6-08 — the guard also fails on calls to `createModelFactory` or `resolveModel` outside the helper and three named send-nothing callers; the routing route and the web-search model adapter are added to the inventory and moved to the helper. Scenarios, edge cases, API contracts, unit tests, risks and compliance rows are updated to match.

- Council round two fixes (GPT-6.1 Sol workers): r2iqa-03 — checked OpenCode initial/nudge sends; r2iqa-06 — named embedding owner and exclusion; r2iqa-07 — preflight before fallback; r2iqa-08 — phase-local policy integrations; r2iqa-14 — moderation provider eligibility; r2iqa-15 — staged acceptance and closure; r2iqa-27 — shared organization fallback; r2iqa-28 — native runtime Phase 3; g6-12 — shared opt-in bridge; g6-13 — explicit system scope; g6-23 — typed loader outcomes; g6-36 — expiring guard entries; g6-37 — named flag and outcome storage; corrected inbox paths and loader arguments.
- Council round two fixes, pass two (GPT-6.1 Sol workers): corrected the search-settings section and phase references and named the missing runtime extension; qualified the sibling's option B default; named the shared effective-policy method and its conditional, independently applied withholding member.
- Council round two fixes, pass three (GPT-6.1 Sol workers): aligned the search owner's actual section and Phase 2 names, recognized its specified runtime-isolation design and tests, and included both query routes in the five-call-site handoff without claiming delivery.
