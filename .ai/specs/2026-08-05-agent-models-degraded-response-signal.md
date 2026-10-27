# Agent models route reports a degraded response

## TLDR

`GET /api/ai_assistant/ai/agents/{agentId}/models` deliberately keeps answering `200` when its per-tenant allowlist snapshot cannot be loaded, so the model picker does not break. It must also **say** that it happened, so no caller mistakes an environment-only provider list for the tenant's authoritative entitlement.

**Scope:** two additive response fields on one existing read endpoint, the matching OpenAPI description, and one client recovery rule in the chat model picker. No data model, migration, permission, event, or route-URL change.

## Overview

The picker endpoint composes its effective allowlist from environment configuration intersected with a per-tenant snapshot (`ai_tenant_model_allowlists`) and per-agent runtime overrides (`ai_agent_runtime_overrides`). The tenant/override reads are wrapped in a `try/catch` that logs and continues with environment-only data — a deliberate availability tradeoff, since a failed allowlist lookup should not blank the operator's model picker. The gap is observability: the response is byte-shape-identical to a fully resolved one, so the only evidence is a server log line. This specification adds a machine-readable degradation marker to the response and teaches the one in-repo consumer to stop treating a degraded list as authoritative.

## Problem Statement

`packages/ai-assistant/src/modules/ai_assistant/api/ai/agents/[agentId]/models/route.ts` catches a failed snapshot load, logs `AI Agents Models — Failed to load tenant allowlist`, and leaves `tenantAllowlistSnapshot` / `agentRuntimeOverrideAllowlist` at `null`. The effective allowlist then collapses to environment-only and the handler returns a normal `200`. Two consequences follow:

- **In-app.** `useAgentModels` in `packages/ui/src/ai/AiChat.tsx` sees `ok: true`, so no failure state fires. The stored-selection cleanup effect then prunes the user's persisted `om-ai-model-picker:<agent>` choice against a provider list that was built without their tenant's allowlist — a transient database problem can silently discard a still-valid model selection.
- **Third-party consumers.** The endpoint is a documented contract surface (`operationId: aiAssistantGetAgentModels`, RBAC `ai_assistant.view`), so external apps and modules build their own pickers against it. They have the same blind spot with no server log to fall back on.

The sibling chat dispatcher (`api/ai/chat/route.ts`) already treats this exact failure as significant: it fails closed with `503` / `tenant_allowlist_unavailable` rather than dispatching against a widened allowlist. The picker route is the remaining surface that degrades silently.

## Proposed Solution

Keep the fallback and make it self-describing. Track the caught failure in a local flag and emit two additive fields on the existing `200` body:

```jsonc
{
  "agentId": "catalog.merchandising_assistant",
  "providers": [ /* … */ ],
  "degraded": false,
  "degradedReason": null
}
```

On the degraded path, `degraded` is `true` and `degradedReason` is `"tenant_allowlist_unavailable"` — the same code the chat dispatcher already returns for the same underlying failure. The client then treats a degraded response as "render what you got, but do not prune the stored selection against it," which is exactly the recovery a hard failure gets.

### Design decisions

| Decision | Rationale |
| --- | --- |
| Additive optional response fields rather than a status-code change | `BACKWARD_COMPATIBILITY.md` §7 permits new optional response fields and forbids changing an existing operation's semantics. Returning `503` like the dispatcher would blank the picker for every operator during a partial outage — the opposite of the fallback's intent. |
| Always emit both fields (`false` / `null` on the healthy path) | A stable response shape lets consumers read `degraded` directly instead of distinguishing "absent" from "false", and it keeps the healthy payload from leaking whether a tenant snapshot exists. |
| Reuse `tenant_allowlist_unavailable` as the reason code | The chat dispatcher already publishes that code for this failure; a second name for one condition would fragment client handling. A `degradedReason` string (not a boolean-only marker) leaves room for future, additively-named causes. |
| One flag for the whole tenant-scoped block | The snapshot read and both runtime-override reads share one `try/catch` and one consequence — the effective allowlist lost its tenant narrowing. Splitting them would imply a per-source recovery that no consumer can act on differently. |
| Client change scoped to the stored-selection cleanup effect | Returning early from that whole effect preserves user state on both of its clearing paths — an unavailable stored value and the "override disabled / no providers" reset — which is what the UI/UX section describes. Suppressing more (e.g. hiding the picker) would degrade a surface the fallback exists to keep usable, and `effectiveModelPickerValue` still gates `allowRuntimeOverride` and a non-empty provider list, so a suppressed prune never lets a stale value reach a request. |

### Alternative considered

Emitting a `Warning` HTTP header instead of body fields was rejected: headers are lossy through the repository's `apiCall`/`apiFetch` helpers, invisible in the OpenAPI response contract that third-party pickers are generated from, and awkward to assert in the route's existing unit tests.

## User story

An operator whose tenant allowlist lookup fails mid-session still sees the model picker, and their previously chosen provider/model survives the incident instead of being reset to the agent default. An integrator building a picker against the public endpoint can detect the degraded response and decide whether to trust the list.

## Architecture

Unchanged request flow; one new value carried through it:

`GET …/models` → auth + RBAC → agent lookup → tenant allowlist + runtime overrides (`try/catch` → `tenantAllowlistDegraded`) → effective allowlist (env ∩ tenant ∩ per-agent) → provider list → `200 { …, degraded, degradedReason }`

Client: `useAgentModels` → `degraded` state → stored-selection cleanup effect (skipped while degraded) → `<ModelPicker>` renders the received providers.

### Frontend architecture contract

- **Server/client boundary:** unchanged. `AiChat.tsx` is already a client component owning this hook and its effects.
- **`"use client"` ledger:** no new client files, no new boundary.
- **Client blob and dependencies:** no new production dependency, provider, or shared state; one boolean of local state added to an existing hook.
- **Bundle, route, and memory budget:** no measurable bundle change; no additional request — the marker rides the response the hook already fetches.
- **Hydration/interactivity evidence:** a jsdom render test proves the picker mounts and the persisted selection survives a degraded response.
- **Provider/bootstrap scope:** unchanged.

| Budget | Target |
| --- | --- |
| New generated backend page-root client boundaries | 0 |
| New heavy browser libraries or root imports | 0 |
| Additional network requests | 0 |
| New response fields | 2, both optional for consumers |

### Market reference

This follows the degraded-read convention used by systems that prefer partial availability over hard failure — for example Elasticsearch search responses, which stay `200` while reporting `_shards.failed` and `timed_out` so a client can tell a complete result from a partial one, and Kubernetes' `PartialObjectMetadata`/warning channel. The shared rule those adopt: a partial answer is still an answer, but it must be labelled as partial in-band.

## Data Models

No entity, column, relation, migration, tenant-scoping rule, or encryption-map change. `ai_tenant_model_allowlists` and `ai_agent_runtime_overrides` are read exactly as before.

## API Contracts

| Surface | Change |
| --- | --- |
| `GET /api/ai_assistant/ai/agents/{agentId}/models` | **Additive.** Adds `degraded: boolean` and `degradedReason: string \| null` to the `200` body. All existing fields (`agentId`, `allowRuntimeOverride`, `allowRuntimeModelOverride`, `defaultProviderId`, `defaultModelId`, `defaultProviderName`, `defaultModelName`, `providers`) keep their names, types, and meaning. Status codes (`200`/`400`/`401`/`403`/`404`/`500`), the HTTP method, the route URL, `operationId`, and the `ai_assistant.view` RBAC guard are unchanged. |
| `openApi` block on the same route | Documents when the response is degraded, what the reason code means, and that a degraded list MUST NOT be treated as the tenant's authoritative entitlement. |

`degradedReason` is an open string enum. `"tenant_allowlist_unavailable"` is the only value emitted today; further causes may be added additively, so consumers MUST treat an unrecognized reason as "degraded, cause unknown" rather than as healthy.

No other route changes. In particular the chat dispatcher keeps failing closed with `503 tenant_allowlist_unavailable` — the picker's soft-degrade and the dispatcher's hard-fail are intentionally different, because only one of them can perform a model call.

## UI/UX

- The picker keeps rendering the providers it received during a degraded response; no new visual component, dialog, badge, or copy is introduced.
- While a response is degraded, the stored `om-ai-model-picker:<agent>` selection is left untouched — neither cleared for an unavailable value nor cleared by the "override disabled / no providers" branch.
- The degradation is logged client-side through the existing `createLogger('ui')` child logger with the agent id and reason code, matching how the surrounding hook reports problems.
- Fully resolved responses keep pruning stale selections exactly as before, so allowlist edits still self-heal a stale localStorage choice.

Surfacing degradation to the operator visually (for example an inline picker warning) is deliberately out of scope: it needs new copy in every shipped locale and a design decision about a partial-availability affordance, and the endpoint contract has to exist first.

## Internationalization

No new user-facing strings or locale keys. The reason code is a machine identifier, never rendered.

## Migration & Compatibility

Backward-compatible and deployment-safe in either order:

- **Old client, new server:** the extra fields are ignored; behavior is byte-identical to today.
- **New client, old server:** `degraded` is absent, the hook's `result.degraded === true` check is false, and pruning behaves exactly as before.

No persisted state, migration, or cache invalidation. Rollback is a code revert.

## Implementation Plan

### Phase 1 — Route marker and contract

1. In `packages/ai-assistant/src/modules/ai_assistant/api/ai/agents/[agentId]/models/route.ts`, add a `tenantAllowlistDegraded` flag beside the existing tenant-scoped locals and set it in the existing `catch (snapshotError)` handler, keeping the `logger.error` call.
2. Add `degraded` and `degradedReason` to the success payload, deriving the reason from the flag.
3. Extend the `openApi` description and the `200` response description with the degraded contract and the consumer rule.

### Phase 2 — Route regression tests

1. In `…/models/__tests__/route.test.ts`, assert a rejected `getSnapshot` still returns `200` with `degraded: true`, `degradedReason: 'tenant_allowlist_unavailable'`, an environment-only provider list, and `tenantAllowlist: null` passed to the model factory.
2. Assert the same marker for a rejected per-agent runtime-override read (`getExact`), since it shares the `try/catch`.
3. Assert that when only the override read fails — a restricting snapshot already resolved, then `getExact` rejects — the response is still `degraded: true` **and** the provider list stays tenant-clipped, with the snapshot passed to the model factory. This is the case that pins the reason code's documented meaning to the whole tenant-scoped block instead of promising an environment-only list.
4. Assert a fully resolved response reports `degraded: false` / `degradedReason: null`.

### Phase 3 — Client recovery

1. In `packages/ui/src/ai/AiChat.tsx`, add `degraded?: boolean` / `degradedReason?: string | null` to `ModelsApiResponse`, track a `degraded` state in `useAgentModels`, reset it per agent change, log a warning when set, and return it.
2. Skip the stored-selection cleanup effect while `degraded` is set, adding it to the dependency list.
3. In `packages/ui/src/ai/__tests__/AiChat.test.tsx`, assert a degraded `200` leaves the persisted `om-ai-model-picker:customers.account_assistant` entry intact while the picker still renders the agent default title.

### Verification

- Automated: `yarn workspace @open-mercato/ai-assistant test` (route suite) and `yarn workspace @open-mercato/ui test src/ai` (picker suite), plus the repository's configured validation gate.
- Regression proof: each new case fails against the unmodified source (no `degraded` field → the route assertions fail; no prune guard → the persisted selection is deleted).
- Existing behavior: the pre-existing route cases (401/403/404, `allowRuntimeModelOverride: false`, allowlist clipping, tenant runtime override) and the "clears a stale stored model picker value" UI case must stay green, proving the healthy path is untouched.
- Integration coverage: `packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-RUNTIME-OVERRIDES-006-model-picker.spec.ts` already asserts the `200` contract for this endpoint; its API-contract case gains `degraded: false` / `degradedReason: null` assertions so the "always emit both fields" decision is locked at the contract level and a third-party picker cannot regress to reading an absent field.
- Integration-test rationale for the degraded branch specifically: no new `.ai/qa/tests/` Playwright case is added for it. That branch is reachable only by making the allowlist repository throw, which the integration harness cannot induce without fault injection into a live database session; the route-level unit tests exercise it deterministically, and the jsdom render test covers the user-visible consequence (a surviving selection).

## Risks & Impact Review

#### A degraded response is mistaken for a healthy one by an unaware consumer

- **Scenario:** An existing third-party picker ignores `degraded` and keeps trusting an environment-only list.
- **Severity:** Low
- **Affected area:** External consumers of `aiAssistantGetAgentModels`.
- **Mitigation:** This is strictly better than today, where the information does not exist at all; the OpenAPI description states the consumer rule explicitly.
- **Residual risk:** Accepted — an additive field cannot force old clients to react.

#### Suppressing the prune leaves a genuinely invalid selection in place

- **Scenario:** An allowlist edit removes a model, and the next picker load happens to be degraded, so the stale selection survives.
- **Severity:** Low
- **Affected area:** Chat model picker state for one user/agent.
- **Mitigation:** The suppression lasts only as long as the degradation; the next healthy response prunes as before. A stale selection cannot escalate privileges — the chat dispatcher re-validates `?provider=`/`?model=` against the effective allowlist and rejects out-of-allowlist values, and it refuses to dispatch at all (`503`) while the allowlist lookup is failing.
- **Residual risk:** Low and self-correcting.

#### The marker leaks tenant configuration detail

- **Scenario:** The response reveals something about a tenant's allowlist to a caller who should not see it.
- **Severity:** Low
- **Affected area:** Endpoint response.
- **Mitigation:** The fields describe the *request's own* failure, not configuration content; the healthy path always emits `false`/`null`, so the payload does not disclose whether a tenant snapshot exists. The caller is already authenticated and holds the agent's required features.
- **Residual risk:** None identified.

#### Merge collision with in-flight picker work

- **Scenario:** PR #4967 reshapes `useAgentModels` state (adding a failure/status field) in the same file and hook.
- **Severity:** Low
- **Affected area:** `packages/ui/src/ai/AiChat.tsx`.
- **Mitigation:** Whichever change lands second resolves the overlap; the two recoveries are the same rule ("do not prune") and collapse cleanly into one guard.
- **Outcome:** #4967 landed on `develop` first, so this branch merged it forward and landed `degraded` **on top of** its shape rather than beside the old `loaded` flag. #4967's tri-state `status: 'loading' | 'ready' | 'failed'`, its `cancelled` guard and effect cleanup, its `.catch()` arm, and its severity-routing `logModelsFailure()` (401/403 at warning level) are all preserved; `degraded` resets alongside `setStatus('loading')` and is only set inside the already-cancellation-guarded success arm. The cleanup effect now carries **both** guards (`status !== 'ready'` from #4967, `degraded` from this spec) and both dependencies, so neither recovery overwrites the other — proven by #4967's failure-path tests and this change's degraded-path test passing together.
- **Residual risk:** Accepted — resolution was slightly more than mechanical (#4967 added cancellation and severity routing that had to survive), but it is covered by both PRs' tests.

### Operational impact

No migration, background work, event emission, write path, queue, or cache behavior changes. Tenant isolation is untouched: the same scoped reads run with the same parameters. Detection improves — a degraded picker response is now visible to clients and in client-side logs, not only in server logs. The blast radius is one read endpoint plus one client hook.

## Final Compliance Report — 2026-08-05

### AGENTS.md files reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/ai-assistant/AGENTS.md`
- `packages/ui/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance matrix

| Rule source | Rule | Status | Notes |
| --- | --- | --- | --- |
| Root `AGENTS.md` | Preserve behavior unless a behavior change is requested | Compliant | The deliberate env-only fallback is preserved; only its observability and the destructive prune change. |
| Root `AGENTS.md` | Follow `BACKWARD_COMPATIBILITY.md` before touching a contract surface | Compliant | §7 permits additive optional response fields; no route, method, or existing field changes. |
| Root `AGENTS.md` | No `any` types; no unnecessary inline comments | Compliant | Typed boolean/string-or-null fields; the one comment added extends an existing explanatory comment on the same fallback. |
| Root `AGENTS.md` | Never expose cross-tenant data or skip tenant scoping | Compliant | Identical scoped reads; the marker describes only the current request. |
| `.ai/specs/AGENTS.md` | Required sections, risks, compliance, changelog; no `SPEC-*` prefix | Compliant | All sections present, N/A surfaces explicit, date+slug filename. |
| `packages/ai-assistant/AGENTS.md` | Route model selection through `createModelFactory` | Compliant | The factory call and its `tenantAllowlist` argument are unchanged. |
| `packages/ai-assistant/AGENTS.md` | Never log credentials, tokens, or raw tenant data | Compliant | Only a reason code and agent id are logged; the existing error log is unchanged. |
| `packages/ai-assistant/AGENTS.md` | Update the module guide on notable changes | Compliant | The allowlist surface table row for this endpoint records the degraded marker. |
| `packages/ui/AGENTS.md` | Use `apiCall` for data calls; keep loading flags local | Compliant | The existing `apiCall` fetch and hook-local state are reused. |
| `packages/ui/AGENTS.md` | Never hard-code user-facing strings | Compliant | No user-facing copy added. |
| Design-system rules | Shared primitives, semantic tokens | N/A | No markup, styling, or control changes. |

### Internal consistency check

| Check | Status | Notes |
| --- | --- | --- |
| Data models match API contracts | Pass | Neither changes; reads are unchanged. |
| API contracts match UI/UX | Pass | The two fields are exactly what the client recovery rule consumes. |
| Risks cover all changed behavior | Pass | Marker semantics, prune suppression, disclosure, and merge overlap are covered. |
| Commands defined for mutations | N/A | Read-only endpoint; no mutation introduced. |
| Cache strategy covers read APIs | N/A | The endpoint is uncached today and stays uncached. |
| Frontend boundary and performance budgets | Pass | No new boundary, dependency, or request. |

### Non-compliant items

None.

### Verdict

**Fully compliant: Approved — additive contract change with regression coverage in the same change.**

## Changelog

### 2026-08-05

- Initial specification for marking a partially degraded agent-models response (`degraded` / `degradedReason`) and teaching the chat model picker not to prune a stored selection against a degraded provider list. Filed from issue #5021, carved out of the review of PR #4967.

### 2026-08-06

- Second review pass on PR #5028. Merged `develop` forward and recorded the actual resolution of the anticipated #4967 collision: `degraded` now sits on top of #4967's tri-state `status`, cancellation guard and severity routing rather than beside the removed `loaded` flag, with the cleanup effect carrying both guards.
- Corrected the documented meaning of `degradedReason: "tenant_allowlist_unavailable"`: it marks a failure anywhere in the tenant-scoped block, so the list may be missing the tenant allowlist and/or the per-agent override narrowing. It no longer promises an environment-only list, which was false when only the runtime-override read threw.
- Aligned the design-decision row for the client change with the UI/UX section: the guard scopes to the whole stored-selection cleanup effect, not only its destructive prune branch.
- Added the discriminating route case (restricting snapshot + rejected `getExact` keeps the tenant clipping) and the integration-level assertion that both degradation fields are always emitted.
