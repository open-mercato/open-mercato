# Notification Routes — Fail Closed on an Unresolved Tenant Scope

## TLDR

`resolveNotificationContext` coerces a missing tenant to `''`. `notifications.tenant_id` is a NOT NULL uuid, so that sentinel reaches `em.find` / `em.count` / the Kysely writes and the driver rejects the whole statement with `invalid input syntax for type uuid: ""` — a 500 on every notification route for a tenant-less principal. Separately, the organization switcher persists a **blank** `om_selected_tenant` cookie whenever it has no tenant to write; the server reads a blank cookie as a deliberate "no tenant" override and nulls `auth.tenantId` for the whole session on super-admin accounts, which is how a principal ends up tenant-less in the first place. This spec requires a resolved tenant before any notification read or write, and stops the switcher from manufacturing the unresolved scope.

## Status

Implemented — 2026-08-06 · Scope: OSS
Modules: `packages/core/src/modules/notifications/`, `apps/mercato/src/components/`, `packages/create-app/template/src/components/`
Related: [`2026-07-28-audit-log-read-tenant-scope-fail-closed.md`](2026-07-28-audit-log-read-tenant-scope-fail-closed.md) (same fail-closed pattern), [`2026-06-09-attachments-scope-invariant.md`](2026-06-09-attachments-scope-invariant.md), [`2026-05-19-superadmin-users-list-context-scope.md`](2026-05-19-superadmin-users-list-context-scope.md) (the cookie-driven super-admin scope this must not regress)

## Problem Statement

### The server sentinel

`packages/core/src/modules/notifications/lib/routeHelpers.ts` resolved the tenant as:

```ts
const tenantId = organizationScope.tenantId ?? ctx.auth?.tenantId ?? ''
```

Twelve entry points share that scope — `GET`/`POST /api/notifications`, `GET /api/notifications/unread-count`, `PUT /api/notifications/mark-all-read`, `POST /api/notifications/{batch,role,feature}`, `PUT /api/notifications/[id]/{read,dismiss,restore}`, `POST /api/notifications/[id]/action` — plus `POST /api/notifications/settings`, which hand-rolls the same `auth.tenantId ?? ''`. Each of them feeds `scope.tenantId` into one of:

- a `tenantId` predicate on `Notification` (`api/route.ts`, `api/unread-count/route.ts`) or a `.where('tenant_id', '=', ...)` in `notificationService`;
- `notification.tenantId = ctx.tenantId` on insert, into a NOT NULL uuid column;
- `RouteMutationGuardAuth.tenantId`, which drives RBAC feature resolution for the mutation guard.

The first two fail loudly in the driver. The third fails quietly, resolving features against an empty tenant.

### Reachability

`resolveOrganizationScopeForRequest` already falls back to `auth.actorTenantId` (`packages/core/src/modules/directory/utils/organizationScope.ts:434-459`), and `resolveCanonicalStaffAuthContext` only marks a session super-admin when it carries a real tenant (`packages/core/src/modules/auth/lib/sessionIntegrity.ts:139-141`). An interactive super-admin session therefore recovers its own tenant even with a blank selection cookie. `''` is reached by:

1. a genuinely tenant-less principal — an unscoped super-admin **API key**, which `resolveApiKeyAuth` permits with `tenantId: null` (`packages/shared/src/lib/auth/server.ts:244-254`);
2. the degraded paths in `resolveOrganizationScopeForRequest` that return `tenantId: null` without consulting `actorTenantId` (`organizationScope.ts:412-414`, `:424-432`, `:460-462`) — the second of which can still return a non-null `filterIds`, so `''` also reaches `runWithCacheTenant('')` and namespaces those callers into one shared `""` cache bucket.

Like the audit-log finding, this is latent rather than reachable in a default configuration — and, like it, it is reachable by a plausible misconfiguration.

### The client root cause

`persistTenant` in `apps/mercato/src/components/OrganizationSwitcher.tsx` did `const resolved = next ?? ''` and wrote the cookie unconditionally, so a null tenant persisted `om_selected_tenant=` for 30 days. Reachable from `handleChange` before the menu is ready and from three `persistSelection(resolvedTenantId, …)` call sites in `load()`.

A blank cookie is not "unset". `resolveTenantOverride` returns `{ applied: true, value: null }` for it (`packages/shared/src/lib/auth/server.ts:101-108`) and `applySuperAdminScope` applies that override **only when the session is super-admin** (`:128-159`), setting `auth.tenantId = null` and preserving the real tenant under `actorTenantId`. That is why ordinary accounts never saw any of this. The blast radius is wider than notifications: every route that skips a tenant predicate on a falsy tenant widens instead of narrowing for the rest of that session.

The state is not user-intent. The switcher API always resolves a concrete tenant for a super-admin (`packages/core/src/modules/directory/api/organization-switcher/route.ts:145-151`), `TenantSelect` is rendered with `includeEmptyOption={false}`, and the desktop popover is a Radix `Select` that cannot emit an empty value. There is no "all tenants" sentinel for `om_selected_tenant` the way `__all__` exists for `om_selected_org`.

## Proposed Solution

**Server — require a resolved tenant at the route boundary.**

```ts
export async function requireResolvedNotificationTenantScope(
  scope: { tenantId?: string | null },
): Promise<Response | null> {
  if (scope.tenantId) return null
  const { t } = await resolveTranslations()
  return Response.json({ error: t('api.errors.forbidden', 'Forbidden') }, { status: 403 })
}
```

Applied in two places, which between them cover all twelve entry points:

- inside `runGuardedNotificationWrite`, before `runRouteMutationGuards` — every write route funnels through it, including `settings`;
- inside `resolveGuardedNotificationContext`, the wrapper the two polled read routes use instead of `resolveNotificationContext`. It returns a discriminated `{ ok: true, … } | { ok: false, response }`, so a read route cannot reach the query without handling the rejection. Writes are structurally safe through their shared helper; reads had no such choke point, and a convention ("remember to call the guard") would have been silently breakable by the next read route added.

Both run before the container resolve and before the cache lookup, so an unresolved tenant never opens a `""` cache scope either.

**Client — expire the cookie instead of blanking it.** `persistTenant(null)` now writes `max-age=0` and reports `hasCookie: false`, so the session falls back to the tenant carried in the token. The `load()` branch that previously only touched React state now calls `persistTenant(null)` — scoped to `value === ''`, which is what remediates a cookie an earlier build already left blank. The old condition was `value !== ''`, excluding exactly the blank cookie it needed to clear; scoping to the blank value clears the poisoned cookie without discarding an explicit tenant selection when the switcher API happens to return `tenantId: null`.

## Design Decisions

| Decision | Rationale |
|---|---|
| Keep the `?? ''` sentinel; guard on truthiness | `NotificationScope` is an exported interface that third-party callers construct and pass to `notificationService`. Adding a required field breaks them; adding an optional one fails **open** for anyone who omits it. `''` is precisely the value that breaks downstream, so plain truthiness rejects exactly the right set — the same reasoning already recorded in `audit_logs/api/audit-logs/readScope.ts`. |
| `NotificationScope.tenantId` stays `string` | Widening to `string \| null` breaks assignability at eight call sites into `NotificationServiceContext.tenantId: string`, plus `RouteMutationGuardAuth.tenantId: string`. A contract change for no behavioral gain. |
| **No** `isSuperAdmin` escape hatch | The audit-log guard admits a tenant-less super-admin because audit logs have an intended cross-tenant read mode. Notifications do not — rows are per-recipient and per-tenant — and admitting one here would walk straight into the same uuid failure the guard exists to prevent. |
| **No** `actorTenantId` fallback in `resolveNotificationContext` | `resolveOrganizationScopeForRequest` already prefers `actorTenantId`, so a second fallback would be dead code that implies a safety it does not add. |
| Guard at the route boundary, not in `resolveOrganizationScope` | The null-tenant widening in `resolveOrganizationScope` is the shared root cause across modules, but it has hundreds of call sites; changing it is a platform-wide behavior change and belongs in its own spec. Matches the precedent set for the undo, redo and audit-log routes. |
| Helper lives in `lib/routeHelpers.ts` | It returns a web-standard `Response` (the module's own convention — `notificationCrudErrorResponse` does the same), and the two route factories that need it live in that file. `audit_logs` put its guard under `api/` only because it returns a `NextResponse`. |
| Reads go through a guarded context wrapper, not a bare guard call | An opt-in guard on reads is skippable by omission — nothing fails if a future read route forgets it. `resolveGuardedNotificationContext` makes the rejection part of the return type instead of the convention. |
| 403 body is translated | Every other error body in this module routes through `resolveTranslations`. `api.errors.forbidden` already exists in all shipped locales, so no new keys. |
| Client expires rather than blanks | A blank value is indistinguishable from a deliberate override server-side, and the UI offers no tenant-less selection to preserve. An absent cookie and a blank one are already equivalent to `parseSelectedTenantCookie`, so the documented global super-admin views are unaffected. |

## API Contracts

No route added, renamed or removed; no request or response field changed.

One added status: the twelve entry points above answer **403** when the request cannot be resolved to a tenant. It is documented explicitly on `GET /api/notifications`, the one affected method whose generated spec does not already carry a 403 — `buildResponses` auto-appends "Forbidden – missing required features" for any method declaring `requireFeatures`, which covers the writes.

## Migration & Backward Compatibility

No contract surface under `BACKWARD_COMPATIBILITY.md` is touched — no auto-discovery file, public type, import path, event ID, route URL, DB column, DI key or ACL feature changes. `requireResolvedNotificationTenantScope` is a new export (additive).

Two intentional behavior changes:

- A tenant-less principal receives `403` where it previously received a `500` from the driver (or, on the settings route, had its features resolved against an empty tenant). Nothing functional is lost; that path never worked.
- A super-admin session running tenant-less because of a blank cookie is scoped back to its own tenant. No UI produces that state, and `/api/auth/users` keeps its global view because it keys on `parseSelectedTenantCookie`, which already treats a blank cookie as no selection. Browsers already holding a blank cookie are healed on the next switcher load rather than needing a manual reset.

The switcher fix is mirrored byte-for-byte into `packages/create-app/template/src/components/OrganizationSwitcher.tsx` (Template Sync Checklist item 3), and a test now enforces that parity.

## Testing

Unit coverage, parameterized over **explicit null, omitted, and empty-string** tenant scope per the established convention:

- `lib/__tests__/routeHelpers.scope.test.ts` — the guard itself, plus the previously untested branch where both the organization scope and the auth context are tenant-less and the scope falls back to the `''` sentinel.
- `__tests__/mutation-guard.test.ts` — all ten mutating entry points (create, batch, role, feature, read, dismiss, restore, action, mark-all-read, settings) answer 403, the mutation-guard registry is never reached, and no service method runs. Verified to fail against the previous code.
- `api/__tests__/route.read-scope.test.ts` — `GET /api/notifications` answers 403 without touching `em.find` / `em.count`.
- `api/unread-count/__tests__/cache.test.ts` — same for the unread count, additionally asserting the cache is neither read nor written.
- `apps/mercato/src/components/__tests__/OrganizationSwitcher.tenantCookie.test.tsx` — no blank cookie is written when the switcher resolves no tenant; a cookie an earlier build left blank is cleared; a resolved tenant is still persisted. The first two fail against the previous component.
- `apps/mercato/src/components/__tests__/starter-chrome-ds.test.ts` — app and template switchers stay byte-identical, and neither writes a blank tenant cookie.

No integration coverage: the vulnerable principal cannot be constructed through the API. `createApiKeyFixture` issues keys under an authenticated token, so a key always inherits its creator's tenant, and there is no fixture path to a tenant-less caller — the same limitation recorded in the audit-log spec.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| A tenant-less principal loses notification access entirely | Low | That principal received a driver-level 500 on every one of these routes before; there is no working behavior to preserve | A 403 instead of a 500 for a genuinely tenant-less account |
| The bell renders a visible error rather than degrading quietly | Low | `apiFetch` throws `ForbiddenError` on 403 where the previous 500 returned `ok: false`, so `useNotificationsPoll`/`useNotificationsSse` land in their `catch` and `setError(...)`. No redirect fires (the 403 is not on a login/portal route) and no flash toast fires (the body carries no `requiredRoles`/`requiredFeatures` hints), but the inline error state is user-visible and repeats each poll | An unactionable inline error for a session that cannot resolve a tenant. Deliberate: this is an anomaly an operator should see, not hide. Sending the two polls with `x-om-forbidden-redirect: 0` (or branching on `status === 403` in the hooks) is the one-line lever if quiet degradation is preferred later |
| Expiring the cookie discards an intended "no tenant" scope | Low | No UI can select one (`includeEmptyOption={false}`, no `__all__` equivalent for tenants), and the switcher API always resolves a concrete tenant for a super-admin | None found; re-check if an all-tenants selection is ever introduced |
| Template drift leaves scaffolded apps writing the blank cookie | Medium | Mirrored in the same change and enforced by a byte-identical parity test | None while the test stands |
| The guard hides a genuine scope-resolution regression behind a 403 | Low | The guarded branch is unreachable for any principal with a tenant, and the unit tests pin the resolved-tenant path | A future scope regression surfaces as 403 rather than 500 |

## Follow-up (not in this change)

- The same `tenantId ?? ''` coercion appears roughly 85 more times across `packages/core`, `packages/shared`, `packages/enterprise` and `packages/ai-assistant` (perspectives, dashboards, workflows, staff, sales, messages, business rules). Most feed guard, enricher or cache contexts rather than a raw ORM filter, so the failure mode varies from a driver error to silent mis-scoping. Auditing them warrants its own spec.
- `resolveOrganizationScope` still returns `filterIds`/`allowedIds: null` for a null tenant — the shared root cause behind this class of finding, already recorded as a follow-up by the audit-log spec.
- Five notification route files export hand-written `openApi` objects that are not `OpenApiRouteDoc`-shaped (no `methods` key), so the generator silently discards them and emits stubs instead. Unrelated to this defect, but worth correcting.

## Changelog

- **2026-08-06** — Initial spec + implementation: `requireResolvedNotificationTenantScope` applied to every notification read and write, 403 documented on `GET /api/notifications`, the organization switcher no longer persists a blank `om_selected_tenant` cookie (and clears one left by an earlier build), template mirrored and parity-tested, regression tests parameterized over null, omitted and empty-string tenant scope.
