# Auth ACL Changes — Route Permission Writes Through the Command Bus

## TLDR

`PUT /api/auth/roles/acl` and `PUT /api/auth/users/acl` mutate permissions by writing straight to the ORM and never reach the command bus, so a permission change produces no `ActionLog` row. Granting a user super-admin, widening a role's feature list, or clearing a per-user override all leave no record of who did it or when. Every other auth mutation (`auth.roles.*`, `auth.users.*`) is audited. This spec adds two log-only commands, `auth.role-acl.update` and `auth.user-acl.update`, and dispatches both routes through them. The commands are deliberately **not** undoable: the undo/redo endpoints are gated on `audit_logs.undo_*`, not on `auth.acl.manage`, so an undoable ACL command would let a caller reverse someone else's permission change without holding the feature that authorizes editing permissions.

## Status

Implemented — 2026-08-07 · Scope: OSS
Module: `packages/core/src/modules/auth/`
Related: `2026-07-28-audit-log-read-tenant-scope-fail-closed.md` (fail-closed audit-log reads — this spec covers the write side)

## Overview

Open Mercato records domain writes in an `ActionLog` table, populated by the command bus: a handler's `buildLog()` returns metadata, and `CommandBus.execute` persists it alongside before/after snapshots and a derived `changes` map. The audit-log UI reads those rows, and entries whose handler is undoable additionally carry an `undoToken` that powers the Undo/Redo actions.

Permission management sits outside that pipeline. RBAC is two-layered — `RoleAcl` rows grant features to a role, `UserAcl` rows override them per user — and both are edited through hand-written routes rather than `makeCrudRoute`, so neither ever acquired a command. This spec brings those two routes onto the same pipeline as the rest of auth, while deliberately declining the undo capability that normally comes with it.

Scope: the write path of two endpoints, two new command handlers, and their i18n labels. No schema change, no wire-format change, no change to who may edit an ACL.

## Problem Statement

Both ACL routes perform their write inline:

```ts
// packages/core/src/modules/auth/api/roles/acl/route.ts (before)
await withAtomicFlush(em, [() => {
  aclToPersist.organizationsJson = requestedOrganizations
  aclToPersist.isSuperAdmin = requestedIsSuperAdmin
  aclToPersist.featuresJson = requestedFeatures
  em.persist(aclToPersist)
}], { transaction: true })
```

Neither file references `commandBus` or `actionLogService` on the write path. `GET` on both routes calls `logCrudAccess`, so reads of an ACL are recorded while writes are not — the omission reads as deliberate but is not.

The consequences:

- **No attribution.** After a privilege escalation there is no record of which admin granted it. The action log — the table the product presents as the trustworthy record of every change — is silent on the most security-relevant class of change it could hold.
- **Inconsistent with the rest of auth.** `auth.roles.create/update/delete` and `auth.users.create/update/delete` are all commands with `buildLog`. ACL editing is the only auth mutation that bypasses the bus, so it is also invisible to command interceptors and to the operation metadata the bus attaches to responses.
- **Not recoverable retroactively.** `RoleAcl` / `UserAcl` carry only the current state plus `updated_at`; the prior grant set is overwritten in place with no history.

## Proposed Solution

Add `packages/core/src/modules/auth/commands/acl.ts` with two handlers, and replace the inline write plus cache invalidation in each route with a single `commandBus.execute(...)`.

| Command id | resourceKind | resourceId | Action label key |
|---|---|---|---|
| `auth.role-acl.update` | `auth.role_acl` | role id | `auth.audit.acl.role_update` |
| `auth.user-acl.update` | `auth.user_acl` | user id | `auth.audit.acl.user_update` |

`resourceKind` reuses the identifiers the routes already use for `logCrudAccess` and for optimistic locking, so access-log entries, action-log entries and record locks agree on one name per resource.

### Command boundary

The command owns the transactional write and the RBAC cache invalidation. The routes keep everything that produces an HTTP-shaped response:

- authentication, `requireFeatures: ['auth.acl.manage']`
- tenant resolution and cross-tenant rejection
- `assertActorCanModifySuperAdminRoleTarget` / `assertActorCanModifySuperAdminUserTarget` / `assertActorCanAccessUserTarget`
- `assertActorCanGrantAcl`
- `enforceCommandOptimisticLockWithGuards`
- the non-superadmin sanitization (`sanitizeTenantFeatures`, the super-admin escalation guard) and the `sanitized` response flag

The route therefore hands the command **post-guard, post-sanitization** values, and the persisted state can never diverge from what the log records. Keeping the guards in the route also keeps their existing unit coverage intact.

### Undo policy

Both commands set `isUndoable: false` and define no `undo` / `redo`. The command bus mints an `undoToken` only for a handler that defines `undo()` and does not opt out, so these entries are fully audited but carry no undo verb.

An ACL change *is* reversible, so this is not an "irreversible by design" exemption. The reason is separation of duties:

- `POST /api/audit_logs/audit-logs/actions/undo` requires `audit_logs.undo_self` or `audit_logs.undo_tenant`; the redo endpoint mirrors it. Neither requires `auth.acl.manage`.
- `audit_logs.undo_self` is a **default `employee` grant**, and `audit_logs.undo_tenant` reaches every `admin` through the `audit_logs.*` wildcard.
- An undoable ACL command would therefore let a caller holding only an audit-log feature reverse or replay another user's permission change — including re-granting a super-admin flag that was just revoked — without ever holding the feature that authorizes editing permissions.

Reversal remains available to the callers actually authorized for it: re-submitting the ACL form, gated on `auth.acl.manage` and validated by `assertActorCanGrantAcl`. That correction is itself audited.

This mirrors the documented `Undo Policy` header block in `packages/core/src/modules/wms/commands/inventory-actions.ts`; `commands/acl.ts` carries the equivalent block.

## Architecture

```
PUT /api/auth/roles/acl
  ├─ guards, tenant resolution, optimistic lock, grant checks   (route — unchanged)
  └─ commandBus.execute('auth.role-acl.update', { input, ctx })
       ├─ prepare()      → before-snapshot (forked em)
       ├─ execute()      → withAtomicFlush(..., { transaction: true, label })
       │                   then rbacService.invalidateTenantCache + cache tag purge
       ├─ captureAfter() → after-snapshot re-read from the committed row
       └─ buildLog()     → ActionLog row (no undoToken)
```

Cache invalidation runs inside `execute()` but strictly **after** the atomic flush commits, per the rule in `packages/core/AGENTS.md`. Each `withAtomicFlush` call passes `{ label: '<command id>' }` so the pending-changes guard warning is actionable.

Both commands are discovered by `yarn generate`, which scans `<module>/commands/*.ts` into `command-loaders.generated.ts`; no manifest edit is required.

## Data Models

No schema change. `RoleAcl` and `UserAcl` are unmodified; the only new persisted data is `ActionLog` rows the bus already knows how to write.

Audit snapshot shape, identical for both commands:

```ts
type AclSnapshot = {
  isSuperAdmin: boolean
  features: string[]              // canonically sorted, codepoint order
  organizations: string[] | null  // null (all organizations) ≠ [] (none)
}
```

**Canonical ordering is load-bearing.** Grants are sets, but `features_json` / `organizations_json` preserve the client's insertion order, and the bus derives `changes` from the snapshots with an order-sensitive deep equality check. Without sorting, re-saving an unmodified ACL form would report a phantom `features` change on every submit. Sorting uses an explicit codepoint comparator rather than `localeCompare`, because the snapshot is a persisted record whose ordering must not shift with the runtime's default locale.

The after-snapshot is re-read from the committed row rather than echoed from the request, so a grant that the route sanitized away cannot appear in the log as if it had been applied. On the user-ACL clear path the row is deleted, and the empty snapshot `{ isSuperAdmin: false, features: [], organizations: null }` is the correct post-state.

`changes` is left to the bus to derive from the two snapshots — the handler returns no `changes` of its own.

### Entry context

Three optional keys ride in `context_json`, which the audit dialog already renders as a collapsible JSON section:

```ts
type AclAuditContext = {
  target?:
    | { kind: 'user'; id: string; email: string | null; name: string | null }
    | { kind: 'role'; id: string; name: string | null }
  effect?: 'granted' | 'changed' | 'revoked'
  sanitizedRequest?: { isSuperAdmin: boolean; features: string[] }
}
```

`target` exists because `action_logs` stores only `resource_id` and has no label column (`formatResource` renders `kind · uuid`), so an entry degrades to a bare UUID the moment the account or role is deleted — exactly when the trail matters most. It lives in `context` rather than in the snapshots: the bus derives `changes` from the snapshots with a deep comparison, so a target renamed between two ACL edits would otherwise be reported as a permission change, and the no-op guard below would stop recognising an unchanged ACL. The user lookup goes through `findOneWithDecryption` scoped to `input.tenantId` (or a null-tenant global account), so an id from another tenant is never decrypted under this scope and stamped into this tenant's trail; the role lookup is by id alone, since the entry already names that role and a tenant predicate would only blank the label for a legitimate cross-tenant super-admin edit. Raw email matches the encryption posture of the row itself — `snapshot_*` and `context_json` are both in `audit_logs`' `defaultEncryptionMaps`. The lookup is wrapped: the write has already committed by the time `buildLog` runs, so a failed enrichment costs the label, never the entry.

This is deliberately **not** routed through `loadAuditLogDisplayMaps`, the read-time resolver behind `actorUserName` / `tenantName` / `organizationName`. That helper filters `deletedAt: null`, so it blanks out in precisely the case this block exists for, and it knows nothing about `resourceKind` — teaching it to resolve `resource_id` would make `audit_logs` learn auth's resource kinds, the coupling direction `packages/core/AGENTS.md` forbids. Write-time capture instead follows the convention the entity commands already use (`loadPersonSnapshot` embeds the record so its entries survive deletion). A reader rendering the block should apply the same rule as that helper: `name` when present, `email` otherwise.

`effect` is set only when the ACL actually changed, so a sanitized-only entry cannot assert a permission change that never happened. It is orthogonal to the `actionType` projection, which derives `edit` from the `.update` command-id suffix and stays correct either way. Neither key collides with the two reserved ones: `context.source` (read by `deriveActionLogSource`) and `context.cacheAliases` (read by the bus).

### No-op suppression

`buildLog` returns `{ skipLog: true }` when both snapshots are present and equal, matching the convention `customers.people.update` and `customers.companies.update` already follow, and reusing the shared `snapshotsEqual` (the sorted snapshots make its order-sensitive comparison a set comparison). Returning `null` instead would **not** work: the bus re-attaches the snapshots to an empty metadata object (`command-bus.ts`) and `persistLog` writes a row carrying nothing but `command_id`.

The guard is load-bearing rather than cosmetic. `backend/users/[id]/edit/page.tsx` PUTs the ACL on every user save — even when only the name or the roles changed — and most accounts carry no per-user override at all, so without it the real permission changes are buried under identical `{ isSuperAdmin: false, features: [], organizations: null }` entries.

One request must survive the guard. `sanitizeTenantFeatures` trims a restricted grant instead of refusing it, which leaves `before` and `after` identical, so suppressing no-ops would make a silent escalation attempt *less* visible than before. The route therefore passes what the caller asked for as `input.requested` whenever it wrote less than was submitted, and the command records it as `context.sanitizedRequest` and exempts the entry. That flag is deliberately **not** the route's `sanitized` response flag: `hasRestrictedChanges` returns false when the trimmed result equals the existing ACL, to avoid nagging the user about a save that changed nothing — but that is precisely an attempt the trail must keep. Organizations are excluded from the block: they are never why the route trims, but they differ from `after.organizations` on every organizations-only save, which would invite a reader to diff the two and conclude a grant was refused. Only the user route sanitizes; the role route reports `sanitized: false` unconditionally and passes no such block.

When the post-write re-read finds no row and the command did not intend a removal, `captureAfter` returns `null` rather than falling back to the request. The bus tolerates a null after-snapshot, so the entry records "unknown" instead of a post-state that was never verified as persisted.

### Log scope

The entry's `tenantId` is the tenant that was edited; its `organizationId` is the actor's organization **only when the actor belongs to that same tenant**, and `null` otherwise.

Achieving that null takes both halves, because `CommandBus.persistLog` resolves the organization as `metadata.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId`. That is a `??` chain, so a handler returning an explicit `null` is indistinguishable from returning nothing and the actor's organization wins regardless. The **route** therefore strips the organization from the command context on a cross-tenant edit, and the handler's own `resolveOrganizationId` keeps the command correct for any other caller. Asserting only the handler's return value would prove nothing about the row that gets written, so the coverage sits at both the route (context stripping) and the bus (persisted payload). A super admin may edit a role in another tenant, and `ActionLogService.buildListQuery` filters `organization_id` with strict equality on top of the tenant predicate — so pairing tenant B with an organization from tenant A yields a row that no reader can ever match, silently hiding exactly the cross-tenant permission change worth recording. `null` still reaches tenant-scoped readers whose organization filter is unset.

## API Contracts

Request schemas and success response bodies (`{ ok, sanitized }`) are unchanged.

**One new failure response.** `PUT /api/auth/users/acl` now answers `400 { error: 'Tenant required' }` — but only when *neither* the actor nor the target user has a tenant.

`user_acls.tenant_id` is NOT NULL while `users.tenant_id` is nullable, so a global account legitimately signs in with `auth.tenantId === null`. Previously the handler proceeded with an undefined tenant predicate, which MikroORM drops: the update and clear paths matched whichever override row happened to exist in any tenant, and the create path hit a NOT NULL violation. Scope now resolves the actor's tenant first and falls back to the target user's, mirroring how the role ACL route derives its own scope (`parsed.tenantId ?? roleTenantId ?? authTenantId`) before refusing. A tenant-less admin therefore keeps the ability to edit and clear an override — now correctly scoped instead of arbitrary — and only an unresolvable pair is rejected. `openApi` documents the new status.

The observable differences:

- A `PUT` to either endpoint appends an `ActionLog` row whenever it changes the stored ACL — or leaves it unchanged only because the route trimmed the request — visible through `GET /api/audit_logs/audit-logs/actions` filtered by `resourceKind=auth.role_acl` / `auth.user_acl`. A submit that changes nothing writes no row.
- Those rows have `undoToken: null` and are absent from `?undoableOnly=true` listings; the audit-log UI renders no Undo action for them.
- Both endpoints now emit the standard command operation metadata header, as every other command-backed route does.

Two new i18n keys, added across all five shipped locales (`en`, `de`, `es`, `ko`, `pl`): `auth.audit.acl.role_update`, `auth.audit.acl.user_update`.

## Risks & Impact Review

| Failure scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Cache invalidation throws after the write commits, suppressing the audit entry | High | Audit completeness under infrastructure failure | The bus persists the log only after `execute` resolves, so invalidation is wrapped and logged at error level instead of propagating. `RbacService.deleteCacheByTags` awaits the adapter without a guard of its own, so an outage does reach the command. Covered by "still returns a loggable result when cache invalidation fails". | The grant stays cached until its TTL, and the caller sees a 200. That staleness occurs either way once the adapter is down; the error log is the alarmable signal. |
| A guard is dropped while moving code, letting a caller edit an ACL they may not touch | Critical | `auth.acl.manage` authorization | Every guard, the tenant resolution and the sanitization stay in the route, untouched; only the write and cache invalidation move. `tenant-scoping.test.ts` and `grant-check.test.ts` still cover them, and the roles route test now also asserts that a rejected write never reaches the bus. | Low — the guard code is byte-identical to the previous revision |
| The roles route no longer pre-creates the `RoleAcl` entity, so a first-time grant silently no-ops | High | First grant on a role with no ACL row | The command creates the row when absent; `existing*` reads in the route became null-safe. Covered by "creates the role ACL row when none exists". | Low |
| Optimistic lock or the enterprise record lock stops firing | High | Concurrent ACL edits | `enforceCommandOptimisticLockWithGuards` still runs in the route against the loaded row before dispatch, so the 409 body and the record-lock guard on `auth.role_acl` are unchanged. Covered by `optimistic-lock.test.ts`. | Low |
| The audit write fails and blocks a legitimate permission change | Medium | ACL save availability | The bus persists the log inside the same command execution, so a log failure fails the request rather than committing an unaudited write. This is the intended trade-off: an audit trail with silent holes is worse than a visible error. | Accepted by design |
| Phantom diffs make the log unreadable | Medium | Audit-log usefulness | Snapshots sort `features` / `organizations` with an explicit codepoint comparator, so a re-save with a reordered grant list produces no `changes`. Pinned by the canonical-ordering test. | Low |
| A sanitized grant is logged as if applied | Medium | Audit accuracy | The after-snapshot is re-read from the committed row rather than echoed from the request. | Low |
| Log volume growth | Low | `action_logs` table | One row per ACL save; negligible against existing per-request access-log volume. | None |
| Cross-tenant exposure through the new rows | Low | Audit-log reads | Rows carry the resolved `tenantId` and the caller's organization; audit-log reads are already tenant-scoped fail-closed. | Low |

Non-goals, deliberately left out:

- The two routes still do not wire the mutation-guard registry (`runMutationGuards`) that `packages/core/AGENTS.md` requires of custom write routes. Pre-existing and unrelated; a separate change.
- No backfill of historical ACL changes is possible — the prior state was never recorded.

## Final Compliance Report

- **Backward compatibility** — no contract surface changed. Two command ids and two i18n keys are additive; no API route, DB column, DI name, event id or ACL feature was modified or removed.
- **`packages/core/AGENTS.md`** — domain write implemented as a command; `withAtomicFlush` used with `{ transaction: true }` and a `label`; cache invalidation after commit, never inside the flush.
- **i18n** — no hardcoded user-facing strings; both action labels resolve through `resolveTranslations()` with fallbacks, and all five locales carry the keys.
- **Testing** — unit coverage for both commands (write paths, transaction commit/rollback, cache invalidation ordering, audit metadata, canonical ordering, and the log-only policy) plus route dispatch assertions; integration coverage in `TC-AUTH-058-acl-audit-log.spec.ts`.
- **Enterprise boundary** — nothing under `packages/enterprise/` is modified.

### Integration coverage

| Surface | Test |
|---|---|
| `PUT /api/auth/roles/acl` | `TC-AUTH-058` — role grant produces an entry with before/after snapshots and no undo token |
| `PUT /api/auth/users/acl` (grant) | `TC-AUTH-058` — per-user override produces an entry with the granted feature |
| `PUT /api/auth/users/acl` (clear) | `TC-AUTH-058` — clearing every grant is audited with the emptied after-snapshot |
| `GET /api/audit_logs/audit-logs/actions` | `TC-AUTH-058` — entries are retrievable by `resourceKind` + `resourceId` |
| `PUT /api/auth/users/acl` (unchanged re-save) | `TC-AUTH-058` — re-submitting an unchanged ACL adds no entry |
| Entry context | `TC-AUTH-058` — role and user entries name their target and carry `granted` / `revoked` |

## Changelog

- **2026-08-07** — Initial spec and implementation. Added `packages/core/src/modules/auth/commands/acl.ts` with the log-only `auth.role-acl.update` and `auth.user-acl.update` commands; dispatched both ACL routes through the command bus; added `auth.audit.acl.*` keys to five locales; added command unit tests, route dispatch assertions, and `TC-AUTH-058-acl-audit-log.spec.ts`.
- **2026-08-07** — Review follow-ups. Stopped stamping the actor's organization onto a foreign-tenant log entry (the pair was unmatchable by any reader); `captureAfter` now records `null` instead of echoing the request when the post-write re-read misses; added the `Tenant required` guard to `PUT /api/auth/users/acl` so its typed `tenantId` is honest and an unscoped lookup cannot cross tenants; routed the best-effort cache-tag failure through the logging facade; extracted the shared handler shape into one factory so the two audit-entry shapes cannot drift; extended tests to assert lookup scoping, the foreign-tenant organization rule, and the unknown-post-state path.
- **2026-08-07** — Narrowed the user-ACL tenant guard so it stops removing a working capability. `users.tenant_id` is nullable, so a tenant-less global account is reachable through normal login, and refusing on the actor's tenant alone would have broken its ability to edit or clear an existing override. Scope now falls back to the target user's tenant, matching the role route's derive-then-refuse pattern; only an unresolvable pair returns 400.
- **2026-08-07** — Completed the foreign-tenant organization fix. The handler's explicit `organizationId: null` was silently overridden by `persistLog`'s `??` fallback to the actor's organization, so the earlier change had no effect on the persisted row; the route now strips the organization from the command context on a cross-tenant edit. Added route-level and bus-level coverage, since the original test asserted only the handler's return value and passed either way.
- **2026-08-07** — Stopped cache-invalidation failures from suppressing the audit entry. The bus persists the log only after `execute` resolves, so a throw from `invalidateTenantCache` / `invalidateUserCache` committed the permission change and then lost its record — the same hole these commands close, opening exactly when infrastructure is degraded. Invalidation is now wrapped and logged at error level.
- **2026-08-12** — Made the entries worth reading. Unchanged ACLs are no longer recorded: the user-edit page PUTs the ACL on every user save and most accounts carry no override, so identical empty entries were burying the real permission changes; `buildLog` now returns `{ skipLog: true }` through the shared `snapshotsEqual`, following `customers.people.update`. Entries name their target (`context.target`, resolved tenant-scoped through `findOneWithDecryption` and best-effort so a failed lookup costs the label, never the entry) and label the change `granted` / `changed` / `revoked` (`context.effect`). A grant the user route trims rather than refuses is exempt from the no-op guard and recorded as `context.sanitizedRequest`; without it, suppressing no-ops would have made a silent escalation attempt *less* visible than before.
