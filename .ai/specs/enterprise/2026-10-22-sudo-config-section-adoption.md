# Sudo configuration section adoption

**Status:** Proposed
**Implementation ownership:** Open Mercato core team members only
**Depends on:** `.ai/specs/2026-10-22-crudform-section-overrides-framework.md`, `.ai/specs/enterprise/2026-10-22-sudo-config-optimistic-locking.md`
**Related:** `.ai/specs/enterprise/2026-10-22-crudform-section-adoption.md`

## TLDR

Adopt the section-override framework on `SudoConfigCrudPage` with exact create/edit surfaces, two stable sections, mandatory interactive sudo challenge, immutable policy-header composition, and the already-landed sudo-config locking contract. This work is independent of both MFA reset and the prerequisite locking implementation.

## Overview

The shared renderer has create and edit callers. Both render `target` and `details`; edit additionally loads a record and exposes delete. Every mutation first calls `requireSudo('security.sudo.manage')` and sends `x-sudo-token`. The locking prerequisite already carries `updatedAt`, enforces one command-bound check, returns the refreshed update version, and surfaces standard conflicts. This adopter consumes that contract without owning or duplicating it.

## Problem Statement

A section policy must not:

- apply edit identity to create or reuse an update mutation binding for delete;
- bypass the interactive challenge or `security.sudo.manage`;
- let caller headers override policy identity;
- lose schema transforms/cross-field validation when a section is hidden/replaced;
- overwrite or delete a config changed after the edit page loaded;
- restore actionable base controls when a configured policy is invalid.

## Goals and Non-goals

### Goals

- Publish exact create/edit identity and `target`/`details` section contracts.
- Keep existing payload transforms, scope, sudo, command/audit/event, and UI feedback.
- Use the framework immutable client to combine `x-sudo-token` with protected policy and optimistic-lock headers.
- Preserve and consume the prerequisite's update/delete optimistic-lock contract.

### Non-goals

- Changing sudo challenge/session algorithms, config schema, target registry, or data model.
- Adopting MFA-reset or another enterprise form.
- Adding a new generic header-merging helper; the framework prerequisite owns it.
- Implementing optimistic locking, version responses, or conflict UI; the locking prerequisite owns them.

## Stable Contract

| Fact | Create | Edit |
|---|---|---|
| host | `crud-form:security.sudo-config` | `crud-form:security.sudo-config` |
| variant | `create` | `edit` |
| operation | `create` | `update` |
| resource kind/id | `security.sudo_config` / absent | `security.sudo_config` / config id |
| ordered sections | `target`, `details` | `target`, `details` |
| surface entry | `security.sudo-config.create.create` | `security.sudo-config.edit.update` |
| parent capability | `security.sudo-config.create/v1` | `security.sudo-config.update/v1` |
| submit mutation surface | `security.sudo-config.create` | `security.sudo-config.update` |
| façade | `POST /api/security/sudo/configs/section-policy` | `PUT /api/security/sudo/configs/:id/section-policy` |
| prior version | forbidden | required from `updatedAt` |

Edit additionally publishes surface entry `security.sudo-config.edit.delete`, capability `security.sudo-config.delete/v1`, mutation surface `security.sudo-config.delete`, request operation `delete`, and `DELETE /api/security/sudo/configs/:id/section-policy` with the same record version. The resolver issues one composition policy token covering the accepted edit alternative; update and delete then create distinct immutable bindings with their own surface entry, mutation surface, and request operation. Reusing the update binding for delete fails before I/O even though the composition token is shared.

Data contracts are `security.sudo-config.target/v1` and `security.sudo-config.details/v1`. Exact field ownership:

- `target`: `targetIdentifier`, `label`;
- `details`: `tenantId`, `organizationId`, `ttlSeconds`, `challengeMethod`, `isEnabled`.

The exact schema allocation is:

| Rule | Owner | Required behavior |
|---|---|---|
| `targetIdentifier` trim + non-empty | `target` | projected value is trimmed before payload |
| `label` trim/empty-to-null/max 200 | `target` | explicit null clears on update |
| tenant/organization empty-to-null and UUID shape | `details` | explicit null clears; omitted leaf preserves on update |
| `ttlSeconds` numeric coercion, integer, configured min/max/default | `details` | normative source is `lib/security-config.ts`: minimum 30, `OM_SECURITY_SUDO_MAX_TTL` default 1800 and floored at 30, `OM_SECURITY_SUDO_DEFAULT_TTL` default 300 and clamped to that range; defaults are create-only; update omission preserves |
| `challengeMethod` enum/default and `isEnabled` boolean/default | `details` | normative enum is `data/constants.ts` `ChallengeMethod`: `auto`, `password`, `mfa`; default `auto`; `isEnabled` default `true`; defaults are create-only; update omission preserves |
| organization requires tenant | composition plus authoritative server validator | exact error targets `tenantId`; hidden current leaves still participate |
| tenant selection change clears organization | `details` UI adapter | server still rejects an incompatible complete state |

A replacement must publish compatible validators/transforms for every leaf it owns. Cross-field composition runs after section parsing and before any request; the server repeats validation over the complete state.

## Proposed Solution

The renderer declares two finite alternatives rather than independent mode arrays. Create rejects any prior version and never publishes delete. Edit consumes the prerequisite's `updatedAt` state and headers; the bound section client applies its exact request operation so delete cannot inherit update identity.

Payload semantics are explicit. Create has no current record: a policy that merely hides either writable section is invalid, because required/defaulted payload would become implicit. A create replacement is accepted only if it provides the complete compatible data contract for that section. Update submits only active authorized leaves. Inside the command transaction, the domain adapter first loads one authoritative scoped current row, deep-merges submitted leaves into that same row snapshot, treats omission as preserve, treats explicit `null` as clear only for nullable `tenantId`, `organizationId`, and `label`, rejects unknown/duplicate leaves, and validates the complete merged state. Immediately before delegation/write it runs the prerequisite's single DI-aware guard against that same loaded row, then delegates once. A hidden leaf is never accepted from the browser.

For each submit/delete:

1. validate active section projections and composition;
2. acquire `requireSudo('security.sudo.manage')`;
3. on cancellation, return without creating a bound client or request;
4. build the framework immutable client with policy, operation, `security.sudo_config`, resource id, and edit/delete expected version;
5. add `x-sudo-token` as an ordinary required header; framework protected policy headers apply last;
6. middleware auth/`security.sudo.manage` and scoped record authorization run before policy facts; the façade then validates host/target/operation/surface, body shape, and sudo token before delegating once;
7. update/delete pass the expected version to the existing command, whose prerequisite guard is the only authoritative lock check; the façade performs no competing version read.

The ready façade requires a well-formed expected header for update/delete even when an operator disables comparison through `OM_OPTIMISTIC_LOCK`; the prerequisite matrix controls whether the command enforces it. No-policy legacy routes retain the prerequisite's headerless compatibility behavior.

## Architecture

| Area | Change |
|---|---|
| `SudoConfigCrudPage.tsx` | Finite identity/descriptors, prerequisite version state, challenge then bound mutations |
| enterprise security facts | Exact two surfaces, capabilities, data contracts, submit/delete operations |
| section-policy façades | Auth/scope/policy/body/sudo gates, expected-token parsing, then existing commands |
| update command adapter | Load one scoped row, merge/validate against it, then run the single prerequisite guard immediately before write |
| tests | Schema, header precedence, security/scope/lock, command events/audit, browser |

No security-specific logic enters OSS framework packages.

## Data Models

No migration. `SudoChallengeConfig.updated_at`, version transport, mutation response, and conflict handling are all supplied by the locking prerequisite.

## API Contracts

Legacy `/api/security/sudo/configs` and item routes retain the exact compatibility matrix in the locking prerequisite. Additive policy façades accept projected active-leaf bodies plus protected policy headers. Edit/delete require the standard expected-version header built from the loaded record and delegate its enforcement to the command.

Policy mismatch returns exact HTTP `409` `extension_policy_mismatch` after auth/feature/scoped-record authorization and before body/sudo/command. Compound-invalid auth or scope failures never expose policy state. Version mismatch/record gone returns the standard `optimistic_lock_conflict` body and reaches `surfaceRecordConflict`. Other established response shapes remain unchanged.

Exact successes are `POST 201 { id }`, `PUT 200 { ok: true, updatedAt }`, and `DELETE 200 { ok: true }`. Create/delete remove no existing response field; update uses the prerequisite's additive refreshed version.

## UI/UX

- no policy: current form/challenge/flash/navigation behavior plus transparent conflict protection;
- pending: `LoadingMessage`, no submit/delete;
- ready: accepted section topology and operation-specific controls;
- configured failure: blocking `ErrorMessage`, `crud_form_section_policy_invalid`, no submit/delete;
- conflict: unified record-conflict bar, no generic flash conversion first;
- cancelled challenge: existing localized cancellation flash, no request.

No configured policy uses the complete base form and legacy routes from the locking prerequisite. Pending exposes no actions. Ready uses only the policy façades. Invalid configuration blocks. Removing policy returns to legacy behavior after the next resolver load; prior façade carriers no longer match current facts.

## Edge Cases & Failure Scenarios

| Case | Required behavior |
|---|---|
| Edit policy on create | Rejected; create identity remains exact |
| Create carries prior version | Local/schema rejection before I/O |
| Delete reuses update operation | Binding/façade rejection before command |
| Sudo challenge cancelled/failed | No bound request/command |
| Caller supplies protected policy header | Local rejection before I/O |
| Sudo and policy headers present | Both arrive; neither overwrites the other |
| Stale update/delete version | Exact optimistic 409; no mutation/audit/event |
| Record deleted after load | Standard record-gone conflict without scope leakage |
| Create hides a payload-owning section | Policy invalid unless a replacement supplies the complete compatible contract |
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
| Create/edit/delete identity collision | High | Finite alternatives and distinct operation facts | New modes need explicit contract |
| Invalid policy restores destructive controls | Critical | Blocking configured-host failure | Policy removal deliberately restores no-policy path |

Rollback removes host eligibility/façade advertisement while retaining stable published contracts. The independently deployed optimistic-lock prerequisite remains.

## Migration & Backward Compatibility

All route/capability additions are optional. Existing legacy route behavior remains as pinned by the prerequisite. New host/surface/section/data/capability/mutation ids and façade routes become stable. Policy façades requiring a version do not change the headerless legacy contract.

## Phasing and Implementation Plan

1. Add finite create/edit facts, explicit section validators/composition, and exact field ownership; pin no-policy behavior.
2. Add exact create/update/delete façades and transactional update sequence—load scoped row, merge/validate, single guard against that row, delegate/write—and bind them only after a successful sudo challenge through the framework immutable client.
3. Add unit/API tests for create replacement requirements, update omission/null semantics, exact schema rules, header precedence, policy/resource/operation, auth/feature/scope/sudo, inherited lock modes, events/audit, and responses.
4. Add self-contained enterprise browser coverage for create/edit isolation, hide/replace, pending/failure, challenge cancellation, inherited conflict behavior, update/delete, and cleanup.
5. Run focused enterprise tests/build/typecheck, generated inventory gate, `git diff --check`, and configured validation with recorded command/status/artifacts.

## Integration Coverage

- create/update/delete façade success and every policy/resource/operation mismatch;
- sudo challenge success/cancel/failure and header precedence;
- auth/feature/tenant/org scope and non-leaking missing record;
- prerequisite lock contract through façades: stale update/delete, record gone, gate modes, exact 409, conflict UI;
- exact transform/refinement table with create-hide, update-hide, null-clear, and stale-hidden-leaf cases;
- command audit plus `security.sudo.config.created|updated|deleted` exactly once;
- browser create/edit identity, two successive saves, delete, blocking failure.

## Acceptance Criteria

1. Create/edit publish only the exact stable facts above; delete exists only on edit.
2. No mutation bypasses policy (when configured), auth, `security.sudo.manage`, scope, or successful sudo challenge.
3. Edit/delete consume the prerequisite's own-record version, single command guard, standard conflict body, and unified conflict UI without duplicating them.
4. Framework-owned immutable header precedence preserves both policy and `x-sudo-token` without ambient leakage.
5. Configured failure exposes no submit/delete; no-policy payload/routes/commands/events/audit remain pinned.
6. Focused unit/API/browser and named validation gates pass.
7. Implementation and review are performed by Open Mercato core team members.

## Final Compliance Report

| Area | Status | Evidence required before implementation PR approval |
|---|---|---|
| Scope cohesion | Ready | One sudo-config CRUD form family |
| Security | Ready | Policy/auth/feature/scope/sudo negative matrix |
| Concurrency | Ready | Landed prerequisite, exact façade propagation, successive-save proof |
| Compatibility | Ready | Legacy/no-policy golden evidence and additive façades |
| Ownership | Ready | Core-team-only implementation and review |

## Changelog

- **2026-10-22:** Split sudo-config section adoption from MFA reset and its optimistic-locking prerequisite; pinned exact create/edit/delete identity, payload semantics, protected header composition, blocking failure behavior, and test evidence.
