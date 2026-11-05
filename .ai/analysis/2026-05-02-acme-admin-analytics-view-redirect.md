# Diagnosis: dashboard kicks users to login with `requireFeature=analytics.view`

**Date:** 2026-05-02
**Reporter:** Patryk Lewczuk
**Environment:** `demo.openmercato.com` and `develop` (locally)
**Symptom:** After successful login, the dashboard renders for ~1–2 seconds, then a toast appears (`Insufficient permissions. Redirecting to login…`) and the browser is redirected to `/login?requireFeature=analytics.view&redirect=%2Fbackend`. The behaviour is "random" — sometimes the dashboard loads fine; sometimes it doesn't. Some users report being unable to log back in once they're in the loop. `admin@comerito.com` (a freshly-provisioned tenant) is also affected the moment they explicitly add an analytics widget such as Pipeline Summary.

> **Note on previous version of this document.** An earlier draft attributed the issue to `acme` being an "old tenant whose `RoleAcl` was seeded before `analytics.view` was added to `defaultRoleFeatures`". That theory was disproved when `admin@comerito.com` (a tenant created on the current code) hit the same 403 immediately after adding Pipeline Summary. Both tenants do have `analytics.view` in storage; the bug is at runtime, not in seeding. The corrected diagnosis is below.

## Root cause

`packages/core/src/modules/auth/services/rbacService.ts:393` — `userHasAllFeatures` strips a granted feature whose owning module is not in the enabled-modules registry **before** the check, and the function it uses to derive the owning module (`getOwningModuleId`) computes it from the feature-id **prefix** rather than from the registry's declared `module` field.

The single feature where this matters is `packages/core/src/modules/dashboards/acl.ts:5`:

```ts
{ id: 'analytics.view', title: 'View analytics widgets', module: 'dashboards' },
```

- `id` prefix is `analytics`
- declared owning module is `dashboards`
- there is no module called `analytics` in `apps/mercato/src/modules.ts`

So at every check:

1. `loadAcl(...)` returns `acl.features` correctly including `analytics.view`.
2. `userHasAllFeatures` calls `filterGrantsByEnabledModules(acl.features)`.
3. `filterGrantsByEnabledModules` (`packages/shared/src/security/enabledModulesRegistry.ts:43`) walks each grant; for `analytics.view` it computes `getOwningModuleId('analytics.view') === 'analytics'`, sees that `analytics` is not in the enabled set, and **drops the grant**.
4. `hasAllFeatures(['analytics.view'], [/* analytics.view removed */])` returns `false`.
5. The catch-all guard in `apps/mercato/src/app/api/[...slug]/route.ts:225` returns:
   ```json
   { "error": "Forbidden", "requiredFeatures": ["analytics.view"] }
   ```
   …with HTTP 403.
6. `packages/ui/src/backend/utils/api.ts:71` (`redirectToForbiddenLogin`) reads `requiredFeatures` from the body, flashes `'Insufficient permissions. Redirecting to login…'`, and pushes the user to `/login?requireFeature=analytics.view&redirect=%2Fbackend`. Exactly the URL in both screenshots.

### Why the dashboard appears to render briefly first

The dashboard layout endpoint (`packages/core/src/modules/dashboards/api/layout/route.ts`) does **not** go through the same filter. It uses `acl.features` directly when building `allowedIds`. So:

- `GET /api/dashboards/layout` → succeeds (and even includes analytics widgets in the returned catalog because `acl.features` still has `analytics.view`).
- Frontend renders the cards.
- Each tile fires `POST /api/dashboards/widgets/data`, which has `requireFeatures: ['analytics.view']`.
- Catch-all guard runs `userHasAllFeatures` → `filterGrantsByEnabledModules` strips `analytics.view` → 403.
- The first 403 trips the redirect.

That inconsistency between the layout API (raw `acl.features`) and the catch-all guard (filtered grants) is what makes the bug feel non-deterministic to users:

- A user whose saved `DashboardLayout` contains *any* analytics tile gets kicked immediately on every dashboard visit.
- A user whose layout has none never triggers the widget data POST and never sees the bug — until they explicitly add an analytics widget (which the layout API readily offers them, because it doesn't filter).

This explains every observation in the bug report and the Discord thread:

- "Random — sometimes the main page loads fine" → depends on the user's saved layout.
- "Once it kicks me out, I can't log in at all" → not a credentials problem; it's a redirect loop. Login succeeds, post-login dashboard fetches a tile, 403, back to `/login`, repeat.
- "Everyone on develop has it" → confirmed; this is purely a code regression, not a data issue.
- "`admin@comerito.com` worked fine, but kicked me out when I added Pipeline Summary" → comerito's default layout has zero analytics widgets (`defaultEnabled: false` for all of them), so the bug is dormant. Adding any analytics tile fires the widget data POST → 403.

## When the regression landed

Commit **`d219402e0` ("fix(auth): hide UI and gate APIs when backing module is disabled (#1641)", 2026-04-22)** added the `filterGrantsByEnabledModules` call inside `userHasAllFeatures`:

```ts
// before d219402e0
return this.hasAllFeatures(required, acl.features)
// after
return this.hasAllFeatures(required, filterGrantsByEnabledModules(acl.features))
```

That PR's intent is correct — features whose backing module has been disabled in `modules.ts` should not act as live grants — but the implementation derives the owning module from the feature id prefix and so it strips features whose id doesn't match their declared module. `analytics.view` is the only such feature in core today, but the same trap will catch any future feature with an off-convention name.

The Discord thread (4/27) puts the user-visible onset within five days of the merge, which fits.

## Confirmed unrelated

Commit `e12c33b01` ("fix(zod): restore optional-key behavior under zod 4.4.x", 2026-04-30) only changes `.optional()` placement around `z.preprocess(...)` for four schema helpers in `packages/checkout/.../validators.ts` and `optionalBooleanQuery` in `packages/core/src/modules/integrations/data/validators.ts`. It does not touch RBAC, role ACLs, the feature matcher, or the enabled-modules registry, and cannot affect what `userHasAllFeatures` returns.

## Fix

Make `getOwningModuleId` consult the registry's declared `module` field on the feature definition first, falling back to the id prefix only when the feature is unknown to the registry.

Edits:

- `packages/shared/src/security/enabledModulesRegistry.ts` — replace the prefix-only `getOwningModuleId` with a registry-aware variant. Build a `Map<featureId, moduleId>` from `getModules().flatMap((m) => m.features ?? [])` (each entry has `{ id, title, module }`); use it in `getOwningModuleId(featureId)` and `filterGrantsByEnabledModules`. Cache lazily and invalidate when modules are re-registered.
- `packages/shared/src/security/__tests__/enabledModulesRegistry.test.ts` — extend the existing test for the off-convention case (a feature whose id prefix doesn't match its declared module).

This is purely a code fix. No database migration. No `sync-role-acls` run required: existing `RoleAcl.featuresJson` already carries `analytics.view`. After deploy, the dashboard works again for every tenant.

### Why not (b) hard-coded `analytics → dashboards` alias

Cheap but leaks the alias forever and only fixes the one symptom we know about today.

### Why not (c) rename the feature to `dashboards.analytics.view`

`BACKWARD_COMPATIBILITY.md` lists ACL feature IDs as FROZEN (category 10). Renaming requires a data migration and a deprecation window for downstream modules. Not justified for one feature when the underlying helper can simply respect the registry.

## References

- `packages/core/src/modules/dashboards/api/widgets/data/route.ts:18` — `requireFeatures: ['analytics.view']`
- `apps/mercato/src/app/api/[...slug]/route.ts:191`/`:225` — feature guard and 403 response shape
- `packages/ui/src/backend/utils/api.ts:71` — `redirectToForbiddenLogin`
- `packages/core/src/modules/auth/services/rbacService.ts:393` — `userHasAllFeatures` (regression site)
- `packages/shared/src/security/enabledModulesRegistry.ts:19` — `getOwningModuleId` (the prefix-derivation bug)
- `packages/shared/src/modules/registry.ts:222` — `Module.features: Array<{ id, title, module }>` (the source of truth that should be consulted)
- `packages/core/src/modules/dashboards/acl.ts:5` — the off-convention feature declaration
- `apps/mercato/src/modules.ts` — enabled module list (no `analytics` entry)
- Commit `d219402e0` (2026-04-22) — introduced `filterGrantsByEnabledModules` in `userHasAllFeatures`
- Commit `e12c33b01` (2026-04-30) — **unrelated** zod 4.4 fix
