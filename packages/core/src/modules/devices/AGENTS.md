# Devices Module — Agent Guidelines

Generic per-tenant device registry: `(tenant, user, device, platform)` plus app/OS metadata and
push-token storage. Channel-agnostic — it owns device identity and the token *field*, but **no push
delivery logic** (sender, providers, delivery rows, workers live in the `push_notifications` module).

> **Spec note (resolves a wording inconsistency):** Spec §"Module 1" line 78 says "push-token storage
> does not live here," but the authoritative sections override that — the `UserDevice` entity lists
> `push_token`/`push_provider`/`push_token_updated_at` (Data Models: *"UserDevice carries push-token
> fields directly"*), and `push_notifications` ships **no** token API, relying on `PUT /api/devices/:id`
> to set/clear tokens. "Channel-agnostic" means no delivery machinery, not "no token column."

## Always

- Scope every query by `tenant_id`. Org is **nullable** — the list route sets `orm.orgField: null`
  (disables org scoping) and keeps `tenantField` for tenant isolation.
- Route all writes through `commands/devices.ts` (`devices.devices.register`, `devices.devices.update`,
  `devices.devices.deactivate`) — they carry undo snapshots, query-index side effects, and domain events.
- Treat `push_token` as a secret: **never** include it in list/response field sets. Only
  `push_provider` and `push_token_updated_at` are exposed.
- Honor the `pushToken` tri-state on `PUT`: absent key = leave unchanged; explicit `null` = clear
  (revoked OS permission) and bump `push_token_updated_at`. The command uses own-property presence.
- Keep the list route's CRUD cache tag aligned with the command's `resourceKind`. The list reads
  through `makeCrudRoute` (org-nullable, custom POST/PUT/DELETE + command bus), so it passes
  `events: { module: 'devices', entity: 'user_device' }` purely to set the cache resource tag to
  `devices.user_device` — matching the `resourceKind` the commands invalidate. Without it the factory
  falls back to the ORM entity name and writes never bust the list cache (stale list under
  `ENABLE_CRUD_API_CACHE`). No events are emitted on GET.

## Never

- Never add push delivery, provider adapters, FCM/APNs SDKs, or send workers here — those belong to the `push_notifications` module.
- Never expose another user's devices unless the caller has `devices.admin` (wildcard-aware RBAC check).
- Never route `PUT`/`DELETE :id` through `makeCrudRoute` — the factory resolves the id from the body/
  query, not the path param. The `[id]` route is a thin guard + command-bus wrapper by design.

## Self-serve vs admin split

Endpoints are split the same way other modules split them (e.g. `customer_accounts/api/admin`,
`staff/api/.../self`): the base path is **self-serve** (always scoped to the acting user) and a
separate `api/admin/devices` tree holds the **cross-user** operations gated by `devices.admin`.

- **Self-serve** (`devices.view` / `devices.manage`):
  - `POST /api/devices` — register/upsert the **caller's own** device. Idempotent on `(tenant, user,
    device_id)`; a soft-deleted row is **revived** (`deleted_at = null`); response `{ id, deviceId,
    revived }`. Uniqueness of active rows enforced by the partial unique index
    `user_devices_tenant_user_device_active_unique ... where deleted_at is null`.
  - `GET /api/devices` — the caller's own devices only. It does **not** honor `?userId`.
  - `PUT` / `DELETE /api/devices/:id` — **owner only** (403 otherwise). Update bumps `last_seen_at`.
- **Admin** (`devices.admin`) under `api/admin/devices`:
  - `GET /api/devices/admin/devices` — tenant-wide list; optional `?userId=` / `?platform=`.
  - `POST /api/devices/admin/devices` — register on behalf of any user (`userId` in body,
    `registerDeviceAdminSchema`). `actorUserId` (the admin) is recorded for the mutation guard/audit.
  - `GET` / `PUT` / `DELETE /api/devices/admin/devices/:id` — read/update/deactivate any device.

Shared write boilerplate (guard → command bus → undo header) lives in `api/deviceOps.ts`
(`executeRegister`/`executeUpdate`/`executeDeactivate`); the list schema/fields/openapi item live in
`api/deviceList.ts`. Both list routes pass `events: { module:'devices', entity:'user_device' }` so any
write busts both caches (see cache-tag note above).

- Never route `PUT`/`DELETE :id` through `makeCrudRoute` — the factory resolves the id from the body/
  query, not the path param. The `[id]` routes are thin guard + command-bus wrappers by design.

## Backend pages (`/backend/devices`, gated by `devices.admin`, settings → Auth)

- `backend/devices/page.tsx` — cross-user list via `GET /api/devices/admin/devices`, with a Register
  button and per-row Edit (`/backend/devices/:id`) + Deactivate (`DELETE …/admin/devices/:id`).
- `backend/devices/create/page.tsx` — `CrudForm` → `POST /api/devices/admin/devices` (admin registers
  for a user; `userId` is a required field).
- `backend/devices/[id]/page.tsx` — `CrudForm` edit (app/OS version, push provider) via
  `PUT /api/devices/admin/devices/:id`, loaded from the admin `GET :id`. Never renders `push_token`.

## Events

- `devices.user_device.registered` — emitted on register/revive.
- `devices.user_device.deactivated` — emitted on soft-delete.
- `devices.user_device.created|updated|deleted` — CRUD lifecycle events from `emitCrudSideEffects`.

## ACL

`devices.view`, `devices.manage` (self-serve), `devices.admin` (cross-user). Defaults in `setup.ts`:
`superadmin`/`admin` get `devices.*`; `employee` gets `view` + `manage`. Run
`yarn mercato auth sync-role-acls` after changing `acl.ts`/`setup.ts` to backfill existing tenants.

## Validation Commands

```bash
yarn generate
yarn db:generate          # schema-diff probe — partial unique index is hand-authored in the migration
yarn workspace @open-mercato/core build
```
