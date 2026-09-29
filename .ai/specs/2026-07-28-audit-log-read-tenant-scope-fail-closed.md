# Audit-Log Read Routes — Fail Closed on Unresolved Tenant Scope

## TLDR

The audit-log read routes apply the DB `tenant_id` predicate only when `auth.tenantId` is truthy. For a caller holding `audit_logs.view_tenant` whose `tenantId` is null, the tenant, organization and actor filters all resolve away at once, leaving a query scoped by nothing but `deleted_at is null` — it returns decrypted action-log rows for every tenant in the instance. The cross-tenant read is intended for superadmins but is gated on the caller's tenant being empty rather than on `isSuperAdmin`. This spec requires a resolved tenant (or an explicit superadmin) before listing, completing the fail-closed sweep already applied to the undo and redo endpoints.

## Status

Implemented — 2026-07-28 · Scope: OSS
Module: `packages/core/src/modules/audit_logs/`
Issues: [#3817](https://github.com/open-mercato/open-mercato/issues/3817) (action-log reads), [#3818](https://github.com/open-mercato/open-mercato/issues/3818) (access-log `actorUserId` override)
Related: PR #2829 (`#2685` — undo fail-closed), PR #2944 (`#2931` — redo scope guard), `2026-06-09-attachments-scope-invariant.md` (same fail-closed pattern in another module)

## Problem Statement

Three read surfaces share the same scope-resolution code:

- `api/audit-logs/actions/route.ts` — action-log list
- `api/audit-logs/actions/export/route.ts` — CSV export of the same rows
- `api/audit-logs/access/route.ts` — access-log list

Each passes `tenantId: auth.tenantId ?? undefined` into its service, and `ActionLogService.buildListQuery` applies the predicate only `if (parsed.tenantId)`. A null tenant therefore adds **no** `tenant_id` clause — not a clause matching nothing.

Three narrowing filters fail together for the same caller:

1. **Tenant** — the predicate is skipped entirely for a falsy `tenantId`.
2. **Actor** — `actorUserId` is deliberately set to `undefined` when `canViewTenant` is true; that is the intended meaning of `audit_logs.view_tenant`.
3. **Organization** — `resolveOrganizationScope` returns `filterIds/allowedIds: null` when no tenant resolves.

The result is an unscoped read of decrypted `snapshotBefore/After`, `changes` and `context` across every tenant. The CSV route leaks the same data as a downloadable file.

This is **latent**: it requires a principal that is both tenant-less (an unscoped API key or a global account) *and* holds `audit_logs.view_tenant` through a direct user-ACL grant. It is not reachable in a default configuration, but it is reachable by a plausible misconfiguration, in the table that is supposed to be the trustworthy record of every change.

## Proposed Solution

Require a resolved tenant scope, or an explicit superadmin, before listing:

```ts
export function requireResolvedTenantScope(auth: ResolvedAuth): NextResponse | null {
  if (auth.tenantId || isSuperAdmin(auth)) return null
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
```

Applied in all three routes immediately after the authentication check, before any container or RBAC work. A single hardening closes both #3817 and #3818: once a tenant-less caller cannot list at all, the access-log route's caller-supplied `actorUserId` override can no longer be used to reach another tenant's rows, and for a tenant-bound caller the surviving tenant predicate already confines results to their own tenant.

## Design Decisions

- **Gate on `isSuperAdmin`, never on tenant nullness.** The two are not equivalent: a superadmin has no tenant, but so does an unscoped API key. Gating on the wrong one is the defect.
- **Reject rather than force self-only.** The issue permits either. Forcing `actorUserId = auth.sub` would leave the tenant predicate genuinely absent — a subtler invariant that could silently regress if actor handling changes. Rejecting keeps the guarantee local and legible.
- **Guard at the route boundary, not in `resolveOrganizationScope`.** The null-tenant scope widening in `resolveOrganizationScope` is the shared root cause, but it has 268 call sites across 111 files; changing it is a platform-wide behavior change and belongs in its own spec. The boundary guard matches the accepted precedent in #2829.
- **`isSuperAdmin` is read through the `AuthContext` index signature.** It is not part of the declared `AuthContext` shape, so it is read exactly the way `shared/lib/auth/server.ts` reads it, rather than widening a shared contract surface from a module-local fix.
- **Helper lives in the API layer** (`api/audit-logs/readScope.ts`, beside `display.ts`) because it returns a `NextResponse`; `lib/` stays framework-free.

## Testing

Unit coverage on all three routes (`api/__tests__/{actions,export,access}.route.test.ts`):

- Tenant-less non-superadmin holding `view_tenant` → `403`, and the service is never called. Parameterized over **explicit null, omitted, and empty-string** `tenantId`, per the `.ai/lessons.md` entry of 2026-07-11 requiring tenant-scope tests to cover omitted scope and not only null.
- Tenant-less **superadmin** → unchanged cross-tenant read.
- Tenant-scoped caller → unchanged, still filtered on their own tenant.
- Access route additionally: a foreign `actorUserId` override from a tenant-less caller is rejected rather than served.

Integration coverage is not included: the vulnerable principal cannot be constructed through the API. `createApiKeyFixture` issues keys via `POST /api/api_keys/keys` under an authenticated token, so a key always inherits the creator's tenant, and there is no fixture path to a tenant-less caller. The guarded branch is therefore unreachable from an integration test.

## Backward Compatibility

No contract surface changes under `BACKWARD_COMPATIBILITY.md` §7 — no route renamed or removed, no HTTP method changed, no response field removed. The `403` is added to each route's documented `openApi.errors` (additive).

One intentional behavior change: a tenant-less non-superadmin holding `audit_logs.view_tenant` now receives `403` instead of unscoped results. That population is exactly the vulnerability. Preserved and covered by tests: superadmin cross-tenant reads, tenant-scoped admins reading their own tenant, and `view_tenant` continuing to widen actor visibility within a tenant.

## Follow-up (not in this change)

`resolveOrganizationScope` still returns `filterIds/allowedIds: null` for a null tenant, which is the shared root cause behind this class of finding. Hardening it requires auditing 268 call sites and warrants its own spec.

## Changelog

- **2026-07-28** — Initial spec + implementation: `requireResolvedTenantScope` guard applied to the action-log list, CSV export and access-log routes; `403` documented in each route's `openApi.errors`; regression tests parameterized over null, omitted and empty-string tenant scope. Closes #3817 and #3818.
