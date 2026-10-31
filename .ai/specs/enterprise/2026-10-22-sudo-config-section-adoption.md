# Sudo configuration edit/delete section adoption

**Status:** Proposed
**Implementation ownership:** Open Mercato core team members only
**Depends on:** `.ai/specs/2026-10-22-crudform-section-overrides-framework.md`, `.ai/specs/2026-10-22-crudform-section-adoption-inventory.md`, `.ai/specs/enterprise/2026-10-22-sudo-config-optimistic-locking.md`
**Related:** `.ai/specs/enterprise/2026-10-27-sudo-config-create-section-adoption.md`, `.ai/specs/enterprise/2026-10-22-crudform-section-adoption.md`

## TLDR

Adopt the section-override framework on the edit alternative of `SudoConfigCrudPage` with exact update/delete surfaces, two stable sections, mandatory interactive sudo challenge, immutable policy-header composition, and the already-landed sudo-config locking contract. Create adoption is an independent runtime work unit that needs no locking prerequisite; both adopters consume the inventory governance prerequisite.

## Overview

The shared renderer has independently deployable create and edit callers. This spec owns only edit, which renders `target` and `details`, loads an existing record, and exposes update/delete. Every mutation first calls `requireSudo('security.sudo.manage')` and sends `x-sudo-token`. The locking prerequisite already carries `updatedAt`, enforces one command-bound check, returns the refreshed update version, and surfaces standard conflicts. This adopter consumes that contract without owning or duplicating it. `.ai/specs/enterprise/2026-10-27-sudo-config-create-section-adoption.md` owns create.

## Problem Statement

A section policy must not:

- apply create identity to edit or reuse an update mutation binding for delete;
- bypass the interactive challenge or `security.sudo.manage`;
- let caller headers override policy identity;
- lose schema transforms/cross-field validation when a section is hidden/replaced;
- overwrite or delete a config changed after the edit page loaded;
- restore actionable base controls when a configured policy is invalid.

## Goals and Non-goals

### Goals

- Publish exact edit identity and `target`/`details` section contracts.
- Keep existing payload transforms, scope, sudo, command/audit/event, and UI feedback.
- Use the framework immutable client to combine `x-sudo-token` with protected policy and optimistic-lock headers.
- Preserve and consume the prerequisite's update/delete optimistic-lock contract.

### Non-goals

- Changing sudo challenge/session algorithms, config schema, target registry, or data model.
- Adopting MFA-reset or another enterprise form.
- Adding a new generic header-merging helper; the framework prerequisite owns it.
- Implementing optimistic locking, version responses, or conflict UI; the locking prerequisite owns them.
- Adopting the create alternative; its framework-only runtime spec (with shared inventory governance) can ship or roll back independently.

## Stable Contract

| Fact | Edit value |
|---|---|
| host | `crud-form:security.sudo-config` |
| variant / operation | `edit` / `update` |
| resource kind/id | `security.sudo_config` / config id |
| ordered sections | `target`, `details` |
| surface entry | `security.sudo-config.edit.update` |
| parent capability | `security.sudo-config.update/v1` |
| submit mutation surface | `security.sudo-config.update` |
| façade | `PUT /api/security/sudo/configs/:id/section-policy` |
| prior version | required from `updatedAt` |

Edit also publishes surface entry `security.sudo-config.edit.delete`, capability `security.sudo-config.delete/v1`, mutation surface `security.sudo-config.delete`, request operation `delete`, and `DELETE /api/security/sudo/configs/:id/section-policy` with the same record version. The resolver issues one composition policy token covering the accepted edit alternative; update and delete then create distinct immutable bindings with their own surface entry, mutation surface, and request operation. Reusing the update binding for delete fails before I/O even though the composition token is shared.

Data contracts are `security.sudo-config.target/v1` and `security.sudo-config.details/v1`. Exact field ownership:

- `target`: `targetIdentifier`, `label`;
- `details`: `tenantId`, `organizationId`, `ttlSeconds`, `challengeMethod`, `isEnabled`.

The exact schema allocation is:

| Rule | Owner | Required behavior |
|---|---|---|
| `targetIdentifier` trim + non-empty | `target` | projected value is trimmed before payload |
| `label` trim/empty-to-null/max 200 | `target` | explicit null clears on update |
| tenant/organization empty-to-null and UUID shape | `details` | explicit null clears; omitted leaf preserves on update |
| `ttlSeconds` numeric coercion, integer, configured min/max | `details` | normative source is `lib/security-config.ts`: minimum 30 and `OM_SECURITY_SUDO_MAX_TTL` default 1800/floored at 30; update omission preserves |
| `challengeMethod` enum and `isEnabled` boolean | `details` | normative enum is `data/constants.ts` `ChallengeMethod`: `auto`, `password`, `mfa`; update omission preserves |
| organization requires tenant | composition plus authoritative server validator | exact error targets `tenantId`; hidden current leaves still participate |
| tenant selection change clears organization | `details` UI adapter | server still rejects an incompatible complete state |

A replacement must publish compatible validators/transforms for every leaf it owns. Cross-field composition runs after section parsing and before any request; the server repeats validation over the complete state.

## Proposed Solution

The renderer's authored `edit` finite alternative points to this work unit; its sibling `create` alternative points to the separate create adopter. Edit consumes the prerequisite's `updatedAt` state and headers; the bound section client applies its exact request operation so delete cannot inherit update identity.

Update submits only active authorized leaves. Inside the prerequisite transaction, the domain adapter reloads the authoritative scoped row with `PESSIMISTIC_WRITE`, deep-merges submitted leaves into that locked snapshot, treats omission as preserve, treats explicit `null` as clear only for nullable `tenantId`, `organizationId`, and `label`, rejects unknown/duplicate leaves, and validates the complete merged state. Immediately before mutation it runs the prerequisite's single DI-aware guard against that same locked row, then mutates and flushes through the same transaction manager. A hidden leaf is never accepted from the browser.

The adopter also consumes the prerequisite's locked-state audit/undo contract unchanged: `prepare()` captures no before snapshot; the transaction carrier supplies the exact locked predecessor and committed successor/delete facts to `buildLog`, undo metadata, and post-commit events. A policy façade cannot reintroduce a pre-lock browser or scope-read snapshot.

For each submit/delete:

1. validate active section projections and composition;
2. acquire `requireSudo('security.sudo.manage')`;
3. on cancellation, return without creating a bound client or request;
4. build the framework immutable client with policy, operation, `security.sudo_config`, resource id, and edit/delete expected version;
5. add `x-sudo-token` as an ordinary required header; framework protected policy headers apply last;
6. middleware auth/`security.sudo.manage` and scoped record authorization run before the framework recomputes host/target/operation/surface policy facts;
7. after strict initial route/body/header validation, the mandatory façade helper collects `getAllMutationGuardInstances()`, appends `bridgeLegacyGuard(container)`, and runs `runMutationGuards(...)` with the exact `update`/`delete` operation and `{ userFeatures }`; block responses use the framework's stable 422 envelope, while modified payload is merged and revalidated against active leaves, the accepted resource/policy facts, and the complete sudo-config schema;
8. `requireSudo(req, 'security.sudo.manage')` validates the step-up token against the post-guard request;
9. update/delete pass the expected version to the existing command, whose prerequisite optimistic-lock guard is the only authoritative version check; the façade performs no competing version read and every route delegates once;
10. guard `afterSuccessCallbacks` run once after command success with the validated target id; callback failure is reported/logged without changing an already committed success response.

The ready façade requires a well-formed expected header for update/delete even when an operator disables comparison through `OM_OPTIMISTIC_LOCK`; the prerequisite matrix controls whether the command enforces it. No-policy legacy routes retain the prerequisite's headerless compatibility behavior.

## Architecture

| Area | Change |
|---|---|
| `form-sections.ts` / `form-sections.client.tsx` | Server-safe discovered security facts plus lazy create/edit runtime descriptors |
| `SudoConfigCrudPage.tsx` | Finite identity/descriptor consumption, prerequisite version state, challenge then bound mutations |
| enterprise security facts | Exact edit surface, update/delete capabilities, data contracts, and operations |
| section-policy façades | Auth/scope/policy/body/mutation-guard/sudo gates, strict metadata/OpenAPI, expected-token parsing, then existing commands |
| update command adapter | Reuse the prerequisite's transaction-held row lock; merge/validate, guard, mutate, and flush against one locked snapshot |
| tests | Schema, header precedence, security/scope/lock, command events/audit, browser |

No security-specific logic enters OSS framework packages.

## Data Models

No migration. `SudoChallengeConfig.updated_at`, version transport, mutation response, and conflict handling are all supplied by the locking prerequisite.

## API Contracts

Legacy item routes retain the exact compatibility matrix in the locking prerequisite. The additive edit policy façades accept at most 16 KiB of `application/json`; a larger body returns 413 before parsing. `PUT` uses `sudoConfigUpdateSchema.strict()` plus the active-leaf and complete-state validators, and `DELETE` rejects a non-empty body. Item params use `z.object({ id: z.string().uuid() }).strict()`. Both use the framework protected-header schemas plus `x-sudo-token: z.string().min(3).max(4096).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)`, matching the existing signed token format; duplicate/comma-joined protected/sudo headers are rejected. Update/delete require the standard ISO expected-version header built from the loaded record and delegate its enforcement to the command.

The routes export exact metadata: `PUT` and `DELETE` each require auth plus `security.sudo.manage`. Their `openApi` entries use the strict schemas and declare `PUT 200 { ok: true, updatedAt }` and `DELETE 200 { ok: true }` plus established `400/401/403/404/409/413/422/500` errors. The PUT 409 schema includes `extension_policy_mismatch`, `optimistic_lock_conflict` and the existing localized domain-conflict body for updating onto a duplicate target/tenant/organization tuple; DELETE retains the policy/optimistic conflict union. Preserve domain conflicts through the existing security route error mapper rather than translating them into a policy or locking error. Add duplicate-update API/OpenAPI-parity coverage proving the established 409, unchanged row/version and no success callbacks, audit success or events. HTTP 422 is the framework's stable `{ error: 'mutation_guard_rejected', code: 'mutation_guard_rejected', details?: unknown }` guard envelope. A registered guard's original body is preserved under `details`; its arbitrary `errorStatus` is diagnostic-only at this façade boundary, so runtime guard registration cannot change the static OpenAPI status set.

Policy mismatch returns exact HTTP `409` `extension_policy_mismatch` after auth/feature/scoped-record authorization and before body/sudo/command. Compound-invalid auth or scope failures never expose policy state. Version mismatch/record gone returns the standard `optimistic_lock_conflict` body and reaches `surfaceRecordConflict`. Other established response shapes remain unchanged.

Exact successes are `PUT 200 { ok: true, updatedAt }` and `DELETE 200 { ok: true }`. Delete removes no existing response field; update uses the prerequisite's additive refreshed version.

## UI/UX

- no policy: current form/challenge/flash/navigation behavior plus transparent conflict protection;
- pending: `LoadingMessage`, no submit/delete;
- ready: accepted section topology and operation-specific controls;
- configured failure: blocking `ErrorMessage`, `crud_form_section_policy_invalid`, no submit/delete;
- conflict: unified record-conflict bar, no generic flash conversion first;
- cancelled challenge: existing localized cancellation flash, no request.

No configured policy uses the complete base form and legacy routes from the locking prerequisite. Pending exposes no actions. Ready uses only the policy façades. Invalid configuration blocks. Removing policy returns to legacy behavior after the next resolver load; prior façade carriers no longer match current facts.

## Frontend Architecture Contract

The server route root `packages/enterprise/src/modules/security/backend/security/sudo/[id]/edit/page.tsx` remains server-owned and passes only config/id props into the existing client island.

| Client file | Boundary reason | Importer | Heavy dependencies / provider scope | Cleanup and hydration risk | Rejected alternative |
|---|---|---|---|---|---|
| `components/SudoConfigCrudPage.tsx` | existing form/router state, `CrudForm`, sudo challenge, update/delete handlers | edit server root above (and sibling create root outside this work unit) | existing `SudoProvider`, UI, router; no new provider/dependency | one resolver subscription and isolated operation bindings; pending blocks controls | converting the server root or splitting another page island adds boundaries without ownership benefit |
| `form-sections.client.tsx` | lazy React/Zod security descriptors for the edit alternative | generated CrudForm-section runtime registry only | descriptor/render imports only; no provider | lazy loader cleanup, fingerprint/hydration blocking, no editable flash | eager/global provider import would load security policy on unrelated routes |

- add no page-root client boundary, global-provider import, or route-specific code to shared bootstrap; enterprise descriptors stay lazy and host-local;
- retain `CrudForm` as the form owner, use its framework-bound `updateCrud`/`deleteCrud` transports, and add no raw `fetch`, ambient headers, or duplicated conflict state;
- the no-policy path adds no resolver request or descriptor cloning; a configured host makes one resolver request and exposes no controls while pending/failed;
- Strict Mode and overlap tests prove cleanup, one sudo challenge and one request per action, isolated update/delete bindings, one command, and one guard callback sequence;
- keep net page/form wiring under 120 LOC by placing generic schema/header/guard behavior in framework helpers; record `yarn check:client-boundaries`, browser-chunk diff, and hydration evidence;
- continue using shared `LoadingMessage`, `ErrorMessage`, localized flashes, and the unified conflict bar without new design-system primitives.

## Edge Cases & Failure Scenarios

| Case | Required behavior |
|---|---|
| Create policy or route used from edit | Rejected; edit identity remains exact |
| Delete reuses update operation | Binding/façade rejection before command |
| Sudo challenge cancelled/failed | No bound request/command |
| Caller supplies protected policy header | Local rejection before I/O |
| Sudo and policy headers present | Both arrive; neither overwrites the other |
| Mutation guard blocks | Stable 422 guard envelope with registered body under `details`; no sudo validation, command, event/audit, or callback |
| Mutation guard modifies active payload | Strict route, active-leaf, scope, and complete-state schemas revalidate it before sudo/command |
| Mutation guard injects hidden/resource leaf | Reject before sudo/command; policy/resource facts cannot be rewritten |
| Guard success callback fails | Report/log once; preserve the already committed success response |
| Stale update/delete version | Exact optimistic 409; no mutation/audit/event |
| Record deleted after load | Standard record-gone conflict without scope leakage |
| Update omits hidden leaf | Command preserves scoped current leaf; browser value is ignored |
| Update sends explicit null | Only nullable tenant/organization/label clear; required leaves reject null |
| Hidden field participates in invariant | Command merges scoped current state and validates; no unreachable client error |
| Two successive saves | First response refreshes `updatedAt`; second succeeds |

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Policy bypasses sudo/auth/scope | Critical | Independent server gates and negative matrix | None accepted |
| Header collision drops policy or sudo token | Critical | Framework immutable client and precedence tests | None accepted |
| Concurrent edit/delete is overwritten | High | Landed locking prerequisite and required façade token | Explicit gate off disables comparison by operator choice |
| Create/edit work-unit identity collision | High | Alternative-level inventory ownership and distinct specs/operation facts | New modes need explicit contract |
| Invalid policy restores destructive controls | Critical | Blocking configured-host failure | Policy removal deliberately restores no-policy path |

Rollback removes host eligibility/façade advertisement while retaining stable published contracts. The independently deployed optimistic-lock prerequisite remains.

## Migration & Backward Compatibility

All route/capability additions are optional. Existing legacy route behavior remains as pinned by the prerequisite. New host/surface/section/data/capability/mutation ids and façade routes become stable. Policy façades requiring a version do not change the headerless legacy contract.

## Phasing and Implementation Plan

1. Add the finite edit fact, explicit section validators/composition, exact field ownership, and alternative-level inventory work-unit link; pin no-policy behavior.
2. Add exact update/delete façades and reuse the prerequisite sequence—scope preauthorization, transaction-held row reload, merge/validate, single guard, same-manager mutate/flush—and bind them only after a successful sudo challenge through the framework immutable client.
3. Add unit/API tests for update omission/null semantics, strict params/body/header schemas, raw limits, metadata/OpenAPI parity, header precedence, policy/resource/operation, auth/feature/scope/sudo, mutation-guard block/modify/legacy/callback behavior, inherited lock modes, events/audit, and responses.
4. Add self-contained enterprise browser coverage for edit versus sibling-create identity, hide/replace, pending/failure, challenge cancellation, inherited conflict behavior, update/delete, and cleanup.
5. Run focused enterprise tests/build/typecheck, generated inventory gate, `git diff --check`, and configured validation with recorded command/status/artifacts.

## Integration Coverage

- update/delete façade success and every policy/resource/operation mismatch;
- sudo challenge success/cancel/failure and header precedence;
- auth/feature/tenant/org scope and non-leaking missing record;
- strict schemas/body limits, metadata/OpenAPI parity, and mutation-guard block/modify/legacy/after-success/callback-failure behavior;
- prerequisite lock contract through façades: stale update/delete, record gone, gate modes, exact 409, conflict UI, and barrier-controlled contenders proving the row remains locked through commit;
- locked-state audit/undo parity, including headerless/gate-off contenders proving each predecessor snapshot is the state the command actually replaced;
- exact transform/refinement table with update-hide, null-clear, and stale-hidden-leaf cases;
- command audit plus `security.sudo.config.updated|deleted` exactly once;
- browser edit/sibling-create identity isolation, two successive saves, delete, blocking failure.

## Acceptance Criteria

1. Edit publishes only the exact stable facts above; delete exists only on edit, and create remains owned by its separate work unit.
2. No mutation bypasses policy (when configured), auth, `security.sudo.manage`, scope, strict validation, mutation guards, or successful sudo challenge.
3. Edit/delete consume the prerequisite's own-record version, single command guard, standard conflict body, and unified conflict UI without duplicating them.
4. Framework-owned immutable header precedence preserves both policy and `x-sudo-token` without ambient leakage.
5. Guard success callbacks run once with the validated target id, and callback failure is reported without replacing a committed success.
6. Configured failure exposes no submit/delete; no-policy payload/routes/commands/events/audit remain pinned.
7. Strict route schemas, raw-body limits, metadata, OpenAPI, and the measurable frontend contract pass their named gates.
8. Focused unit/API/browser and named validation gates pass.
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
| root security rules | Preserve auth, feature, tenant/org scope, interactive sudo, and non-enumerating failures | Compliant | Exact façade order and negative matrix are specified for update/delete |
| root optimistic-lock rule | Edit/delete use their own version and the DI-aware lock seam | Compliant | The landed prerequisite's transaction-held row, single guard, exact 409, and refreshed version are reused |
| `packages/core/AGENTS.md` → API Routes | Every route exports metadata/OpenAPI and validates exact input | Compliant | Strict params/body/header schemas, raw-body limits, full status matrices, and the stable guard-rejection envelope are specified |
| UI guides | `CrudForm` mutations use immutable shared helpers, loading/error states, and conflict UI | Compliant | Policy/sudo/lock headers cannot collide; pending/failed controls block; `surfaceRecordConflict` is retained |
| `.ai/specs/AGENTS.md` | One deployable adopter with API/UI coverage | Compliant | Only the sudo-config edit/delete alternative is in scope; create, locking, and MFA reset remain separate |
| `BACKWARD_COMPATIBILITY.md` | Keep legacy routes and stable ids additive | Compliant | No-policy transport stays; new host/surface/capability/façade contracts are versioned/additive |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Existing config/version fields match update/delete payload and response tables |
| API contracts match UI/UX section | Pass | Edit/delete identity and ready/pending/invalid/no-policy behavior align |
| Risks cover all write operations | Pass | Header, scope, sudo, validation, lock, and configured-failure paths are covered |
| Commands defined for all mutations | Pass | Existing update/delete commands are delegated once through exact façades |
| Cache strategy covers all read APIs | N/A | No cache change |
| Frontend architecture contract is measurable | Pass | Client-boundary, request-count, Strict Mode, LOC, chunk, and hydration gates are explicit |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — ready after the locking, framework, and inventory governance prerequisites land.

## Changelog

### 2026-10-27 — Mechanical re-review corrections

- Preserve the existing localized duplicate-configuration domain 409 for PUT alongside policy/optimistic conflicts, with duplicate-update API/OpenAPI parity and zero-success-side-effect coverage.

- **2026-10-27:** Added the route/client-island ownership ledger and required policy update/delete to consume locked transaction audit/undo snapshots.
- **2026-10-27:** Split create into its own framework-only runtime adopter with shared inventory governance; retained edit/delete on the transaction-held row-lock prerequisite with mandatory mutation guards, strict façade/OpenAPI contracts, measurable frontend gates, and barrier proof.
- **2026-10-22:** Split sudo-config section adoption from MFA reset and its optimistic-locking prerequisite; initially pinned create/edit/delete identity before the alternative-level split.
