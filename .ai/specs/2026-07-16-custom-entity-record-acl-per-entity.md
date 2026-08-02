# SPEC — Per-Entity ACL for Custom Entity Records (Opt-In Restriction)

**Scope:** OSS
**Status:** Draft
**Tracking issue:** [#3857](https://github.com/open-mercato/open-mercato/issues/3857)
**Related guides:** `packages/core/src/modules/entities/AGENTS.md`, `packages/core/src/modules/auth/AGENTS.md`, `packages/shared/AGENTS.md`, `BACKWARD_COMPATIBILITY.md`

---

## TLDR

`assertEntityAclForRequest` returns early for custom entities
(`packages/core/src/modules/entities/lib/entityAcl.ts:91`), so the ONLY
authorization on the custom-entity records API is the coarse route-level
feature `entities.records.view` / `entities.records.manage`. A user granted
that one feature can call `GET/POST/PUT/DELETE /api/entities/records` with any
`entityId` in their tenant and read/modify/delete those records. Sensitive
custom entities (salaries, board minutes) cannot be compartmentalized from
ordinary ones. This is an **intra-tenant horizontal-privilege** issue;
cross-tenant access remains blocked by existing tenant/org scoping.

This spec adds **opt-in per-entity access control** for custom-entity records:

- A custom entity can be flagged `access_restricted`. Default is `false`, so
  **every existing entity and grant keeps working unchanged** (zero BC break).
- A restricted entity additionally requires a **synthesized** per-entity
  feature `entities.records.<entityId>.view` / `.manage`, enforced inside
  `assertEntityAclForRequest` instead of the current short-circuit.
- The feature catalog (`/api/auth/features`) is extended to surface those
  synthesized features so admins can grant them in the Role/User ACL editor.
- An optional tenant-level policy
  (`entities.newEntitiesRestrictedByDefault`, default OFF) lets a tenant make
  new custom entities restricted-by-default without forcing that posture on
  anyone else.

The composition is a **prerequisite model**: a restricted entity requires the
coarse feature (route guard, unchanged) **plus** the per-entity feature. This
solves the filed problem (hide sensitive entities from ordinary holders)
without relaxing the route-level guard contract. Stronger "scope a user to
*only* one entity" is called out as a future extension, explicitly out of
scope here.

---

## Overview

Custom entities are a self-service EAV feature: tenants define their own data
models (`custom_entities` rows plus module-declared `ce.ts` entities) and their
records are served by a single shared engine at `/api/entities/records`. In
practice most custom entities are ordinary (vendors, assets, projects) and a
minority are sensitive (salaries, board minutes).

Today all custom-entity records share one pair of features. The records route
enforces those at the metadata layer
(`packages/core/src/modules/entities/api/records.ts:98-102`):

```ts
export const metadata = {
  GET:    { requireAuth: true, requireFeatures: ['entities.records.view'] },
  POST:   { requireAuth: true, requireFeatures: ['entities.records.manage'] },
  PUT:    { requireAuth: true, requireFeatures: ['entities.records.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['entities.records.manage'] },
}
```

Each verb then calls `assertEntityAclForRequest`, which is the intended
per-entity gate — but it returns immediately for custom entities:

```ts
// packages/core/src/modules/entities/lib/entityAcl.ts:90
export async function assertEntityAclForRequest(args: AssertEntityAclArgs): Promise<void> {
  if (args.isCustomEntity) return
  // ... system-entity requirement lookup + wildcard-aware feature check
}
```

`ENTITY_ACL_REQUIREMENTS` only maps *system* entity ids
(`directory:*`, `customers:*`, `catalog:*`, `sales:*`, `auth:*`). There is no
per-entity requirement, and no place to declare one, for custom entities.

This spec introduces the missing per-entity gate as an **opt-in** so the fix is
additive and low-risk, matching the issue's own guidance ("confirm against
product intent … likely requires a new per-entity ACL scheme").

## Problem Statement

- `assertEntityAclForRequest` short-circuits for custom entities
  (`entityAcl.ts:91`), so all four record verbs
  (`records.ts:177`, `:401`, `:475`, `:574`) fall back to the coarse
  route-level feature as the sole authorization.
- The coarse feature is entity-agnostic: `entities.records.view` grants read on
  **every** custom entity in the caller's tenant/org scope;
  `entities.records.manage` grants write/delete on every one.
- Sensitive custom entities cannot be compartmentalized from ordinary ones.
- The `CustomEntity` model (`entities/data/entities.ts`) carries no ACL
  metadata (`entityId`, `label`, org/tenant scope only), and the feature
  catalog `/api/auth/features` is built statically from each module's `acl.ts`
  — so custom entities contribute no grantable features today.

Non-goals / already-correct behavior (must be preserved):

- Cross-tenant isolation: record queries resolve `resolveOrganizationScope`
  and are tenant/org-scoped. This spec does not touch that.
- System (ORM table-backed) entity ids remain rejected by the records route
  (`systemEntityRecordsRejection`).

## Proposed Solution

### Access model

1. **Restriction flag.** Add `access_restricted` (nullable boolean, default
   `false`/null) to `custom_entities`. Module-declared (`ce.ts`) custom
   entities may declare the same flag in their definition; the runtime resolves
   an effective boolean for any custom `entityId`.

2. **Synthesized per-entity features.** For a restricted entity, two logical
   features exist, keyed on the immutable `entityId`:

   ```
   entities.records.<entityId>.view
   entities.records.<entityId>.manage
   ```

   Example: `entities.records.hr:salaries.view`. These are dynamic (never in
   `acl.ts`). `entities.records.<id>.manage` declares
   `dependsOn: ['entities.records.<id>.view', 'entities.records.manage']`;
   `entities.records.<id>.view` declares
   `dependsOn: ['entities.records.view']`.

3. **Enforcement.** `assertEntityAclForRequest` stops short-circuiting on
   `isCustomEntity`. For a custom entity it branches on the effective
   restricted flag:
   - **Not restricted** → allow. The route-level `requireFeatures` guard
     already enforced the coarse feature. **Byte-for-byte today's behavior.**
   - **Restricted** → additionally require the per-entity feature via the
     shared wildcard-aware matcher
     `hasAllFeatures(acl.features, ['entities.records.<entityId>.<action>'])`.
     Super admin returns early (unchanged).

4. **Prerequisite composition.** A restricted entity needs the coarse feature
   (prerequisite, still enforced by the route metadata) **plus** the per-entity
   feature. Consequence: a role granted a restricted entity also sees all
   *non-restricted* entities. That is acceptable for v1 and solves the filed
   issue. Scoping a principal to *only* one entity (dropping the coarse
   prerequisite) would require the route guard to accept "coarse OR
   per-entity", which `requireFeatures` (AND-only) cannot express — deferred as
   a future extension (see § Out of Scope).

### Why the wildcard matcher makes this fall out cleanly

`matchFeature(required, granted)`
(`packages/shared/src/lib/auth/featureMatch.ts`) treats `*` as global,
`prefix.*` as recursive (`required.startsWith(prefix + '.')`), and everything
else as exact string match. Against a synthesized
`entities.records.<entityId>.<action>`:

| Granted to the role | Access to a restricted entity | Why |
|---|---|---|
| `entities.records.view` / `.manage` (coarse only) | **No** | exact match only; string differs |
| `entities.records.<entityId>.view` (per-entity) | **Yes** | exact match |
| `entities.records.*` | Yes | recursive prefix |
| `entities.*` | Yes | recursive prefix |
| `*` / super admin | Yes | global grant / early return |

This is precisely the desired outcome: ordinary coarse-feature holders lose
visibility of restricted entities, while explicit per-entity holders and broad
wildcard/admin grants retain it — with no change to existing admin grants.

### Feature catalog surface

Extend `GET /api/auth/features`
(`packages/core/src/modules/auth/api/features.ts`) to append synthesized
per-entity feature items for the **calling tenant's** restricted custom
entities, after the static module features. Each item:

- `id`: `entities.records.<entityId>.<action>`
- `title`: e.g. `View records: <label>` / `Manage records: <label>`
- `module`: `entities`
- `dependsOn`: as in § Access model

The endpoint already runs with auth context; it becomes tenant-aware for the
synthesized tail only (static module features remain global and unchanged).
The Role/User ACL editor (`auth/components/AclEditor.tsx`, fed by
`/api/auth/features`) then renders them under the Entities group with no
component change. Granted strings persist in `RoleAcl.featuresJson` /
`UserAcl.featuresJson` exactly like any other feature — **no ACL schema
change**.

### Optional tenant default-restricted policy

Add a tenant-scoped `module_config` for the `entities` module:
`newEntitiesRestrictedByDefault` (boolean, default `false`), read via
`ModuleConfigService` with tenant scope. When `true`, creating a new custom
entity initializes `access_restricted = true`. This gives deny-by-default to
tenants that want it, using the same mechanism, without changing the global
default.

### Definition UI

Add a "Restrict record access" toggle to the custom-entity definition editor
(`entities/backend/entities/user/[entityId]/page.tsx` and the create flow),
bound to `access_restricted`, with an inline help note explaining that
restricted entities require an explicit per-entity grant. All strings via
`useT()` / locale files.

## Architecture

### Enforcement flow (records API, per verb)

```
Request → route metadata requireFeatures (coarse: view/manage)      [unchanged]
        → classifyRecordsEntity(em, entityId)                        [existing]
             system  → systemEntityRecordsRejection                  [unchanged]
             custom  → resolve access_restricted for entityId        [NEW]
                       assertEntityAclForRequest({ ..., entityMeta }) [MODIFIED]
                          isCustom && !restricted → allow             [== today]
                          isCustom &&  restricted → require
                              entities.records.<entityId>.<action>    [NEW]
             system-mapped (non-custom) → existing requirement path   [unchanged]
```

`classifyRecordsEntity` (`records.ts:53`) already resolves the `custom_entities`
registration for user-created entities; extend it (or a sibling resolver) to
also return the effective `access_restricted` flag so each verb passes
`{ isCustomEntity, isRestricted }` into `assertEntityAclForRequest` without a
second DB round-trip. Module-declared (`ce.ts`) custom entities resolve the flag
from their declaration; the default remains `false`.

### Components touched

| Component | Change |
|---|---|
| `entities/data/entities.ts` (`CustomEntity`) | add `access_restricted` column |
| `entities/migrations/*` + `.snapshot-open-mercato.json` | scoped migration for the new column |
| `entities/lib/entityAcl.ts` | replace `if (isCustomEntity) return` with restricted-branch enforcement; accept `isRestricted` in args |
| `entities/api/records.ts` | resolve restricted flag; pass it into all four `assertEntityAclForRequest` calls |
| `entities/lib/*` (new helper) | derive per-entity feature id from `entityId` + action; resolve effective restricted flag (DB row / `ce.ts` declaration) |
| `auth/api/features.ts` | append synthesized per-entity features for the tenant's restricted entities |
| `entities/backend/entities/user/[entityId]/page.tsx` + create flow | "Restrict record access" toggle |
| `entities` module config | `newEntitiesRestrictedByDefault` tenant policy (read on create) |
| `entities/i18n/*` | new strings (toggle label, help, feature titles) |

No new module, no new DI key, no new event id, no new API route. The only new
ACL *feature-id shape* is dynamic and additive.

## Data Models

`custom_entities` (add one column):

| Column | Type | Notes |
|---|---|---|
| `access_restricted` | `boolean` not null default `false` | `false` → unrestricted (current behavior). `true` → requires per-entity feature. Postgres backfills existing rows to `false` |

MikroORM property — mirrors the existing `show_in_sidebar` / `is_active`
boolean pattern on this entity (`custom_entities` already carries `updated_at`,
line 155):

```ts
@Property({ name: 'access_restricted', type: 'boolean', default: false })
accessRestricted: boolean = false
```

No changes to `role_acls` / `user_acls` schema — synthesized feature strings use
the existing `features_json` array.

Module config (tenant-scoped, via `module_configs`, no schema change):
`entities.newEntitiesRestrictedByDefault: boolean` (default `false`).

## API Contracts

- `GET /api/entities/records` — unchanged request/response shape. Behavior
  change: a restricted `entityId` now returns `403 { error: 'Forbidden' }`
  (via `CrudHttpError(403)` from `assertEntityAclForRequest`) unless the caller
  holds the per-entity `.view` feature (or a satisfying wildcard / super admin).
- `POST` / `PUT` / `DELETE /api/entities/records` — unchanged shapes; restricted
  `entityId` requires the per-entity `.manage` feature.
- `GET /api/auth/features` — response schema unchanged (`items[]` of
  `{ id, title, module, dependsOn? }`); additionally includes synthesized
  per-entity feature items for the tenant's restricted entities. Existing
  consumers that ignore unknown ids are unaffected.
- Custom-entity definition create/update endpoints — accept and persist
  `access_restricted`; default derived from the tenant policy on create.

## Backward Compatibility

Contract surfaces touched (per `BACKWARD_COMPATIBILITY.md`): DB schema
(additive column), ACL features (additive, dynamic), API behavior (records
authorization).

- **Default is unrestricted.** With `access_restricted` defaulting to
  `false`/null and the tenant policy defaulting OFF, every existing custom
  entity and every existing grant behaves exactly as before. No ACL migration,
  no bridge, no lockout risk — this is the core reason opt-in was chosen over a
  secure-by-default per-entity-always model.
- **Additive features.** `/api/auth/features` only *adds* items; the schema is
  unchanged. No existing feature id is removed or renamed.
- **New behavior only manifests when an admin opts an entity in.** At that
  point, holders who previously relied on the coarse feature for that specific
  entity must be granted the per-entity feature. This is the intended
  compartmentalization, not a regression — but it MUST be documented so admins
  understand that flipping the flag narrows access. Add an `UPGRADE_NOTES.md`
  entry describing the flag, the synthesized feature ids, and the tenant policy.
- No deprecation protocol needed (nothing removed); this is additive under the
  ADDITIVE-ONLY classification.

## Risks & Impact Review

| Risk | Failure scenario | Severity | Mitigation | Residual |
|---|---|---|---|---|
| Legitimate lockout after flagging | Admin flips `access_restricted` on an in-use entity; existing users lose access until per-entity feature is granted | Medium | Toggle help text warns; `UPGRADE_NOTES.md`; admin (super/`entities.*`) retains access; flag is per-entity and reversible | Low — intended semantics, self-service reversible |
| Enforcement gap on one verb | A verb keeps short-circuiting and a restricted entity stays open on that path | High if it slips | Single shared `assertEntityAclForRequest` change covers all four call sites; add a test asserting each verb 403s a restricted entity without the grant | Low |
| Feature-catalog staleness / drift | Synthesized feature id derived inconsistently between catalog and enforcement, so a granted feature never matches | Medium | Derive the feature id from one shared helper used by BOTH `features.ts` and `entityAcl.ts`; unit-test the derivation | Low |
| entityId → feature-id shape | `entityId` contains a `:` (e.g. `hr:salaries`); malformed segmentation could break wildcard/exact matching | Low | `matchFeature` is `.`-segmented and does exact-string compare for non-wildcards; `:` stays inside one segment. Entity ids never contain `.`. Covered by a matcher test | Low |
| Performance | Extra per-request restricted-flag lookup | Low | Fold the flag into the existing `classifyRecordsEntity` resolution (no extra round-trip); flag is a tiny boolean | Negligible |
| Tenant-awareness of `/api/auth/features` | Endpoint gains a tenant-scoped tail; a bug could leak another tenant's entity labels | Medium | Scope the synthesized query by the caller's tenant/org exactly like record queries; test cross-tenant isolation of the catalog tail | Low |

## Testing & Integration Coverage

Unit:
- `entityAcl.test.ts`: custom + unrestricted → allowed (regression of current
  behavior); custom + restricted without per-entity feature → 403; with
  per-entity feature → allowed; with `entities.records.*` / `entities.*` / super
  admin → allowed.
- feature-id derivation helper: stable, deterministic, round-trips through
  `matchFeature` for representative `entityId`s (including one with `:`).
- `features.test.ts`: restricted entities contribute synthesized items; catalog
  tail is tenant-scoped (no cross-tenant leakage); unrestricted entities
  contribute nothing.

Integration (all four record verbs — required per root AGENTS "integration
coverage for all affected API paths"):
- Fixtures create two custom entities (one restricted, one not) and roles with
  (a) coarse-only and (b) coarse + per-entity grants; assert
  `GET/POST/PUT/DELETE /api/entities/records`:
  - coarse-only role: full access to the unrestricted entity; `403` on the
    restricted entity for every verb.
  - coarse + per-entity role: full access to both.
  - cross-tenant caller: `403`/scoped-empty as today (no regression).
- UI smoke: record list/detail/edit forms for an unrestricted entity are
  unchanged; a restricted entity is hidden/denied for a coarse-only user.
- Self-contained: create fixtures in setup (prefer API), clean up in teardown;
  no reliance on seeded/demo data.

## Out of Scope (future extensions)

- **Standalone per-entity scoping** (grant a principal access to *only* one
  restricted entity without the coarse prerequisite). Requires the records
  route to accept "coarse OR per-entity", i.e. moving the umbrella check out of
  `requireFeatures` into the handler. Deferred.
- **Per-record / ownership-level ACL** (row-level security). Not addressed.
- **Retrofitting system (ORM-backed) entities** — they already have concrete
  requirements in `ENTITY_ACL_REQUIREMENTS`.
- **Other read surfaces that touch `custom_entities_storage`** (search indexer,
  AI tools, direct Query Engine callers) do **not** yet honor `access_restricted`.
  They enforce their own feature gates, and this spec closes the records API
  (the surface named in #3857). Propagating the per-entity restriction to those
  surfaces is a tracked follow-up — until then, a restricted custom entity's
  records may still be reachable via search/AI if the caller holds those
  surfaces' own features. Flagged during the consensus code review.

## Implementation Phases

1. **Schema + flag resolution.** Add `access_restricted` column + migration +
   snapshot; add the shared helpers (effective-restricted resolver + feature-id
   deriver). Unit-test the deriver.
2. **Enforcement.** Rework `assertEntityAclForRequest` (restricted branch);
   thread `isRestricted` from `records.ts` for all four verbs. Unit + verb tests.
3. **Feature catalog.** Extend `/api/auth/features` with the tenant-scoped
   synthesized tail. Tests incl. cross-tenant isolation.
4. **Definition UI + tenant policy.** Toggle in create/edit; wire
   `newEntitiesRestrictedByDefault`; i18n strings.
5. **Docs.** `UPGRADE_NOTES.md`, entities module AGENTS note, integration tests.

## Final Compliance Report

Runner: local (no running app container found via the docker-compose probe).

- [x] `assertEntityAclForRequest` no longer short-circuits custom entities;
      all four verbs (`records.ts` GET/POST/PUT/DELETE) thread `isRestricted`
      and enforce the restricted branch.
- [x] Default posture verified unchanged — unrestricted custom entity does not
      consult the ACL (regression test in `entityAcl.test.ts` + superadmin GET
      passes in `records.crud.test.ts`).
- [x] Feature-id derivation lives in one shared pure helper
      (`lib/recordFeatures.ts`) used by both enforcement and the catalog;
      matcher tests (incl. `entityId` with `:`) pass.
- [x] `/api/auth/features` synthesized tail is tenant-scoped and fails safe;
      cross-tenant/omit-tenant behavior covered in
      `restrictedEntityFeatures.test.ts` + `features.test.ts`.
- [x] Migration `Migration20260716120000` + snapshot reviewed — additive
      `access_restricted` column only, no unrelated drift (legacy no-dash
      snapshot left untouched; active snapshot is `.snapshot-open-mercato`).
- [x] `UPGRADE_NOTES.md` documents the flag, synthesized feature ids, and the
      tenant policy (under 0.6.5 → 0.6.6).
- [x] Route-level tests cover GET/POST/PUT/DELETE for a restricted entity:
      coarse-only → 403 (no write), per-entity grant → allowed, superadmin →
      allowed. (Route tests exercise the ACL wiring end-to-end with mocked DI;
      a live Playwright fixture pass remains for the QA gate.)
- [x] Validation gate (local): `yarn generate`, `yarn build:packages`,
      `yarn typecheck` (21/21), `yarn lint` (0 errors), `yarn test` for
      entities+auth (680/680) all green.

## Changelog

- 2026-07-16: Initial draft. Opt-in `access_restricted` flag + synthesized
  per-entity `entities.records.<entityId>.view/.manage` features + optional
  tenant `newEntitiesRestrictedByDefault` policy; prerequisite composition;
  standalone-only scoping deferred.
- 2026-07-16: Consensus code review (PAL, gpt-5.2 adversarial). Fixed a
  self-introduced regression — `classifyRecordsEntity` resolved the
  `access_restricted` security flag from an UNSCOPED `findOne({ entityId })`, so
  a colliding entityId in another tenant could flip the flag; now resolved with
  tenant+org overlay precedence (`findScopedCustomEntity`), classification
  preserved via an unscoped fallback (regression test added). Also: aligned the
  feature-catalog precedence to treat the declared (ce.ts) registry as
  authoritative for its ids (matches records enforcement); memoize the declared
  cache even when empty; documented that other read surfaces (search/AI/query
  engine) don't yet honor the flag (§ Out of Scope). Earlier in the session also
  fixed a partial-update un-restrict (zod default made the fallback dead).
- 2026-07-16: Implemented all five phases. Added `custom_entities.access_restricted`
  column (migration `Migration20260716120000` + snapshot), pure
  `lib/recordFeatures.ts` deriver, restricted-branch enforcement in
  `entityAcl.ts` threaded through all four `records.ts` verbs, tenant-scoped
  synthesized catalog tail in `/api/auth/features` (`lib/restrictedEntityFeatures.ts`),
  create/edit toggles, `GET/PUT /api/entities/entity-settings` tenant policy,
  i18n (en/de/es/pl), unit + route tests, and `UPGRADE_NOTES.md`. Local
  validation gate green (typecheck/lint/tests).
