# Sudo configuration create section adoption

**Status:** Proposed
**Implementation ownership:** Open Mercato core team members only
**Depends on:** `.ai/specs/2026-10-22-crudform-section-overrides-framework.md`, `.ai/specs/2026-10-22-crudform-section-adoption-inventory.md`
**Related:** `.ai/specs/enterprise/2026-10-22-sudo-config-section-adoption.md`, `.ai/specs/enterprise/2026-10-22-crudform-section-adoption.md`

## TLDR

Adopt the section-override framework on the create alternative of `SudoConfigCrudPage` with `target` and `details` sections, mandatory interactive sudo, strict policy/mutation-guard contracts, and the existing `security.sudo.config.create` command. This work has no record version and does not depend on sudo-config optimistic locking; edit/delete adoption is a separate work unit.

## Overview

The reusable renderer has create and edit callers that can ship independently. Create has no loaded record, no delete action, no optimistic token, and create-only defaults/replacement rules. It still requires `security.sudo.manage`, a successful `requireSudo('security.sudo.manage')` challenge, current tenant/organization scope, strict schema validation, command audit/event behavior, and configured-policy fail-closed behavior.

The enterprise inventory assigns the renderer's finite `create` alternative to this spec and its `edit` alternative to `.ai/specs/enterprise/2026-10-22-sudo-config-section-adoption.md`.

## Problem Statement

Bundling create with edit/delete forces a framework-only runtime capability to wait for an independently deployable locking prerequisite. Inventory remains a governance prerequisite for stable work-unit evidence, not a runtime coupling to edit/delete. Bundling also obscures create-specific safety: there is no resource id or version before mutation, hiding required/defaulted sections is unsafe, and guard success callbacks must receive the persisted id returned by the command rather than an empty placeholder.

## Goals and Non-goals

### Goals

- Publish only the exact create host/variant/operation and two section contracts.
- Preserve create transforms, defaults, cross-field validation, scope, sudo, command, audit, event, response, and UI feedback.
- Use the framework immutable request client and mandatory mutation-guard/legacy-bridge lifecycle.
- Pass the actual persisted config id to every create success callback.
- Ship and roll back independently from edit/delete and optimistic locking.

### Non-goals

- Adopting update or delete.
- Adding optimistic locking, a prior-version header, conflict UI, or a database migration.
- Changing sudo challenge/session algorithms, target registry, command ids, events, or audit contracts.
- Adding a generic header helper outside the framework prerequisite.

## Stable Contract

| Fact | Stable value |
|---|---|
| inventory alternative | `create` work unit for the `SudoConfigCrudPage` invocation |
| host | `crud-form:security.sudo-config` |
| variant / operation | `create` / `create` |
| resource kind/id | `security.sudo_config` / absent |
| ordered sections | `target`, `details` |
| surface entry | `security.sudo-config.create.create` |
| capability | `security.sudo-config.create/v1` |
| mutation surface | `security.sudo-config.create` |
| façade | `POST /api/security/sudo/configs/section-policy` |
| delegated command | `security.sudo.config.create` |
| prior version | forbidden |

Data contracts are `security.sudo-config.target/v1` and `security.sudo-config.details/v1`. `target` owns `targetIdentifier` and `label`; `details` owns `tenantId`, `organizationId`, `ttlSeconds`, `challengeMethod`, and `isEnabled`.

Create transformations are exact:

- trim and require non-empty `targetIdentifier`;
- trim `label`, convert empty to null, and enforce maximum 200;
- convert empty tenant/organization to null and validate UUID shape; organization requires tenant;
- coerce `ttlSeconds` to an integer using `lib/security-config.ts`: minimum 30, `OM_SECURITY_SUDO_MAX_TTL` default 1800/floored at 30, and `OM_SECURITY_SUDO_DEFAULT_TTL` default 300/clamped to the range;
- validate `ChallengeMethod` as `auto | password | mfa`, default `auto`, and default `isEnabled` to true.

A create policy may not merely hide a writable section because that would make required/defaulted payload implicit. A replacement is accepted only when it supplies the complete compatible data contract for that section. Composition validation runs after both section projections and again on the server.

## Proposed Solution

The authored finite `create` alternative points to this work unit; it never inherits edit facts, delete capability, a resource id, or a version header. A configured policy resolves the two sections and binds one create mutation client.

The exact submit sequence is:

1. validate active section projections and complete create composition;
2. acquire `requireSudo('security.sudo.manage')`; cancellation sends no request;
3. build the immutable framework client with create policy/operation, `security.sudo_config`, no resource id, no expected version, and `x-sudo-token` as an ordinary required header;
4. middleware authenticates and checks `security.sudo.manage`, then establishes tenant/organization scope before policy recomputation;
5. strict body/header schemas reject unknown input, duplicate/comma-joined protected/sudo headers, any optimistic-lock header, and bodies above 16 KiB;
6. the mandatory façade helper runs `getAllMutationGuardInstances()`, the optional `bridgeLegacyGuard(container)`, and `runMutationGuards(...)` with operation `create` and `{ userFeatures }`; blocks use the stable HTTP 422 envelope and modified payload is revalidated against active leaves, scope, and the complete create schema;
7. `requireSudo(req, 'security.sudo.manage')` validates the post-guard request token;
8. delegate once to `security.sudo.config.create`;
9. extract the persisted id from the command's `201 { id }` result and pass that exact non-empty id to every `afterSuccessCallbacks` item; callback failure is reported without changing committed success.

Policy grants no authority. Compound-invalid tests prove auth/feature/scope failures win before policy details and no configured failure restores the legacy create control.

## Architecture

| Area | Change |
|---|---|
| `form-sections.ts` / `form-sections.client.tsx` | Server-safe discovered security facts plus lazy create runtime descriptors |
| `SudoConfigCrudPage.tsx` create caller | Explicit create identity, descriptor consumption, challenge then one bound create mutation |
| enterprise security facts | Create-only capability, data contracts, mutation surface, and alternative-level inventory ownership |
| `POST .../section-policy` | Auth/scope/policy/body/guard/sudo gates, strict metadata/OpenAPI, command delegation |
| `security.sudo.config.create` | Existing domain command/event/audit behavior, unchanged |
| tests | Create schema/default/replacement, scope/sudo/guard, callback id, command effects, browser |

No edit/delete or locking implementation is changed. No security-specific type enters an OSS package.

## Data Models

No migration or record-shape change. The existing command creates the authoritative `SudoChallengeConfig` and returns its persisted id.

## API Contracts

The existing `POST /api/security/sudo/configs` remains unchanged for the no-policy path. The additive policy façade accepts at most 16 KiB JSON and uses `sudoConfigSchema.strict()` plus the active-section and complete-state validators. It requires framework protected headers and `x-sudo-token: z.string().min(3).max(4096).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)`; any optimistic-lock header is a 400.

It exports `metadata = { POST: { requireAuth: true, requireFeatures: ['security.sudo.manage'] } }` and OpenAPI with exact `201 { id }` plus `400/401/403/404/409/413/422/500`. HTTP 409 includes both `extension_policy_mismatch` and the existing localized domain-conflict body for a duplicate target/tenant/organization configuration, preserved through the security route error mapper without relabeling it as a policy or optimistic-lock conflict. HTTP 422 is `{ error: 'mutation_guard_rejected', code: 'mutation_guard_rejected', details?: unknown }`. Runtime guard statuses do not alter this static matrix. Add duplicate-create API/OpenAPI-parity coverage proving the existing domain 409, no new row, and no success callbacks, audit success or events.

## UI/UX

- no policy: unchanged create form, challenge, legacy POST, flash, and navigation;
- pending: `LoadingMessage`, no submit;
- ready: accepted create sections and policy façade only;
- configured invalid: blocking `ErrorMessage` with `crud_form_section_policy_invalid`, no submit;
- cancelled challenge: existing localized cancellation flash, no request.

## Frontend Architecture Contract

The server route root `packages/enterprise/src/modules/security/backend/security/sudo/create/page.tsx` remains server-owned and passes only configuration props into the existing client island.

| Client file | Boundary reason | Importer | Heavy dependencies / provider scope | Cleanup and hydration risk | Rejected alternative |
|---|---|---|---|---|---|
| `components/SudoConfigCrudPage.tsx` | existing form/router state, `CrudForm`, sudo challenge, create handler | create server root above (and sibling edit root outside this work unit) | existing `SudoProvider`, UI, router; no new provider/dependency | one resolver subscription and one bound submit; pending blocks controls | converting the server root or adding a second client island duplicates ownership |
| `form-sections.client.tsx` | lazy React/Zod security descriptors for the create alternative | generated CrudForm-section runtime registry only | descriptor/render imports only; no provider | lazy loader cleanup, fingerprint/hydration blocking, no editable flash | eager/global provider import would load security policy on unrelated routes |

- no new page-root client boundary, provider, subscription, or shared-bootstrap route code;
- `CrudForm` remains owner and uses framework-bound `createCrud`; no raw `fetch`, ambient header state, edit/delete branch, or conflict state is added;
- no-policy adds no resolver request; a configured create host makes one resolver request and one POST per accepted submit;
- Strict Mode proves one challenge, request, command, persisted-id extraction, and callback sequence;
- keep net create wiring under 70 LOC, add no dependency, record `yarn check:client-boundaries`, browser-chunk diff, hydration, and request-count evidence;
- use shared loading/error components, localized flashes, and existing design-system primitives.

## Edge Cases & Failure Scenarios

| Case | Required behavior |
|---|---|
| Edit policy/route used from create | Reject before I/O |
| Create carries resource id or version | Local/schema rejection before I/O |
| Writable section hidden without full replacement | Configured policy invalid; no submit |
| Challenge cancelled/invalid | No command |
| Protected header supplied by caller | Local rejection before I/O |
| Guard blocks | Stable 422 envelope; no sudo validation/command/event/audit/callback |
| Guard modifies payload | Revalidate strict active leaves, scope, defaults, and complete state |
| Guard injects hidden/resource leaf | Reject before sudo/command |
| Command returns persisted id | Every success callback receives that exact id once |
| Persisted id absent/empty | Report callback-contract failure, skip callbacks, preserve committed 201 result |
| Callback fails | Report once; preserve committed 201 result |

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Policy bypasses auth/scope/sudo | Critical | Independent ordered gates and compound-invalid tests | None accepted |
| Hidden create fields gain implicit defaults | High | Complete compatible replacement requirement | Approved replacements may redesign the input UI |
| Callback receives empty/pre-create id | High | Required result extractor and exact-id assertion | None accepted |
| Create/edit readiness leaks across one invocation | High | Alternative-level work units and separate adopter specs | Shared renderer changes require both regression suites |
| Configured failure restores submit | Critical | Blocking configured-host state | Policy removal deliberately restores legacy after reload |

Rollback removes only create host eligibility/façade advertisement and returns its alternative work unit to planned/deferred. Edit/delete readiness and the independent locking prerequisite remain unchanged.

## Migration & Backward Compatibility

All route/capability/fact additions are optional and versioned. The legacy create route, command, payload, event, audit, flash, and navigation stay compatible. The new create façade and ids become stable after publication and follow the deprecation protocol if changed. No locking prerequisite or edit/delete rollout is required.

## Phasing and Implementation Plan

1. Add create-only finite facts, alternative-level inventory link, descriptors, transforms/defaults, and complete replacement rules.
2. Add the strict POST façade, metadata/OpenAPI, guard/sudo sequence, command delegation, and required persisted-id extractor.
3. Add unit/API tests for every transform/default, hidden/replaced sections, strict limits/headers, auth/feature/scope/policy/sudo, guard block/modify/legacy/callback behavior, exact persisted callback id, event/audit, and response.
4. Add self-contained browser coverage for no-policy, pending, ready, invalid, cancellation, one submit, and isolation from the edit alternative.
5. Run focused enterprise tests/build/typecheck, inventory gate, `yarn check:client-boundaries`, `git diff --check`, and configured validation.

## Integration Coverage

- POST façade success and every policy/operation/resource mismatch;
- auth/feature/tenant/org scope, sudo success/cancel/failure, and header precedence;
- strict schema/default/body-limit/metadata/OpenAPI parity;
- mutation-guard block/modify/legacy/after-success/callback-failure, including exact persisted POST id delivery;
- `security.sudo.config.create`, `security.sudo.config.created`, and command audit exactly once;
- browser create/edit identity isolation, hide/replace, pending/invalid, one request, and cleanup.

## Acceptance Criteria

1. Only the create alternative and its exact stable facts are published by this work unit.
2. Create's runtime depends on the framework only, its readiness evidence depends on inventory governance, and it can ship/rollback independently from edit/delete and locking.
3. No create bypasses configured policy, auth, feature, scope, strict validation, mutation guards, or sudo.
4. No resource id or optimistic-lock header is accepted before create.
5. Every success callback receives the exact persisted id returned by the POST command once.
6. Configured failure exposes no submit; no-policy behavior remains pinned.
7. Strict API and measurable frontend gates pass with named evidence.
8. Focused unit/API/browser and configured validation pass.
9. Implementation and review are performed by Open Mercato core team members.

## Final Compliance Report — 2026-10-27

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/enterprise/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root security rules | Preserve auth, feature, tenant/org scope, sudo, guards, and non-enumerating failures | Compliant | Exact create gate order and negative matrix are specified |
| `packages/core/AGENTS.md` → API Routes | Export metadata/OpenAPI and strict validated input | Compliant | Exact schemas, limits, feature metadata, statuses, and stable guard envelope are pinned |
| UI guides | Use CrudForm/shared requests/loading/error patterns | Compliant | Create uses bound `createCrud`, one resolver/POST, shared states, and measurable boundary budgets |
| `.ai/specs/AGENTS.md` | One independently deployable capability | Compliant | Only sudo-config create adoption is included; edit/delete and locking are separate |
| `BACKWARD_COMPATIBILITY.md` | Keep legacy routes and stable ids additive | Compliant | No-policy transport stays and all new contracts are versioned/additive |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Existing create command returns the persisted id required by façade/callbacks |
| API contracts match UI/UX | Pass | Ready alone uses policy POST; pending/invalid block; no-policy stays legacy |
| Risks cover all write paths | Pass | Auth, scope, sudo, validation, guard, id extraction, callbacks, and fail-closed states are covered |
| Commands defined for all mutations | Pass | Existing `security.sudo.config.create` is delegated once |
| Cache strategy covers all read APIs | N/A | No cache change |
| Frontend architecture contract is measurable | Pass | Boundary, provider, request, Strict Mode, LOC, chunk, and hydration gates are explicit |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — ready after the framework runtime and inventory governance prerequisites land.

## Changelog

### 2026-10-27 — Mechanical re-review corrections

- Preserve the existing localized duplicate-configuration domain 409 alongside policy conflicts, with duplicate-create API/OpenAPI parity and zero-success-side-effect coverage.

- **2026-10-27:** Added the exact create route/client-island/data-owner map and file-level client-boundary ledger.
- **2026-10-27:** Split sudo-config create from independently deployable edit/delete adoption; pinned framework-only runtime behavior plus inventory governance, create defaults/replacement rules, guard/sudo/OpenAPI behavior, and exact persisted callback identity.
