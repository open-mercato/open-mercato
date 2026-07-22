# Nulled ACL Feature Overrides Act as a Runtime Deny-List

- Date: 2026-07-22
- Status: Implemented
- Scope: OSS — `@open-mercato/shared` (enabled-modules registry, module overrides), `@open-mercato/core` (auth `RbacService`)
- Related: `.ai/specs/implemented/2026-05-04-modules-ts-unified-overrides.md` (umbrella overrides spec), `.ai/specs/implemented/2026-04-30-ai-overrides-and-module-disable.md`

## Problem

`entry.overrides.acl.features: { '<feature-id>': null }` (and the programmatic
`applyAclFeatureOverrides`) removes a feature from the module registry's ACL
catalog. Before this change, that removal only affected **catalog surfaces**:
the role-management UI checkboxes, `setup.ts` / `sync-role-acls` seeding, and
docs. Runtime enforcement never consulted the registry for feature existence:

1. `hasAllFeatures(granted, required)` is a pure string match between the
   required feature id and the caller's grant strings. A removed feature id
   hardcoded at a call site (e.g. `sales.documents.number.edit` in the sales
   routes) was still satisfied by a wildcard grant such as `sales.*`.
2. Grants come from the database (`role_acls.features_json`), not the
   registry. `filterGrantsByEnabledModules()` filters at **module**
   granularity only, and `getOwningModuleId()` falls back to the feature-id
   prefix for ids unknown to the registry — so both wildcard grants and stale
   explicit grants for a removed feature survived filtering.
3. The super-admin branch of `RbacService.userHasAllFeatures` passed whenever
   the required feature's **owning module** was enabled — the prefix fallback
   again resolved a removed feature to its enabled module.

Net effect: nulling a feature read as "this feature does not exist in this
app", but every enforcement path disagreed. The override silently did not
deny anything.

## Decision

Treat feature ids overridden to `null` as a **deny-list at enforcement time**,
mirroring the existing disabled-modules handling (which already denies even
super admins):

- `@open-mercato/shared/security/enabledModulesRegistry` gains:
  - `getRemovedAclFeatureIds(): ReadonlySet<string>` — composed from
    `composeAclFeatureOverrides()` entries whose value is `null` (modules-tier
    and programmatic-tier, with the existing programmatic-over-modules
    precedence; a non-null replacement override is NOT removed).
  - `isAclFeatureRemoved(featureId): boolean` — membership check.
  - `filterGrantsByEnabledModules()` now drops **explicit** grants whose id is
    a removed feature, including when the module registry is unavailable
    (tests/CLI). Wildcard grants are left in place — the required-side check
    below is the authoritative gate.
- `RbacService` (core auth):
  - `userHasAllFeatures()` returns `false` when any required feature is
    removed — checked **before** the super-admin branch, so super admins are
    denied too.
  - `tenantHasFeature()` returns `false` for a removed feature.
  - `getGrantedFeatures()` filters explicit removed ids out of the returned
    grant list (wildcards pass through; consumers matching against a concrete
    required id go through `userHasAllFeatures` / feature-check for
    authoritative answers).
- `CustomerRbacService` (core customer_accounts, portal RBAC):
  - `userHasAllFeatures()` denies removed required features **before** the
    portal-admin branch, mirroring the backend super-admin handling. (Portal
    RBAC still has no module-level grant filtering — that pre-existing gap is
    orthogonal to this spec.)

### Residual gaps and why they are out of scope

The deny-list lives at the RBAC chokepoints. Two classes of call sites match
raw grant arrays directly and therefore still let a wildcard grant satisfy a
removed feature. They were triaged deliberately:

1. **Client-side UI affordances (cosmetic).** Client code matches concrete
   feature ids against `BackendChromePayload.grantedFeatures` (e.g.
   `useInjectedMenuItems`, header chrome buttons, per-component `hasFeature`
   checks). A wildcard grant in the payload can still show an affordance for a
   removed feature; a deny cannot be expressed in grant strings alone, and
   `security/features.ts` must stay isomorphic/pure (the module registry and
   override store are server-populated). Every mutating action behind such an
   affordance hits a server guard that routes through `userHasAllFeatures`, so
   these fail closed with a 403. Follow-up if the cosmetic gap matters: add an
   additive `removedFeatures` field to `BackendChromePayload` and subtract it
   in the client-side check helpers.

2. **Server-side in-handler fine-grained checks (real but bounded).** Roughly
   a dozen handlers perform secondary checks like
   `hasFeature(acl.features, 'dashboards.configure')` against the raw ACL
   (dashboards routes, `messages/lib/routeHelpers`, `entities/lib/entityAcl`,
   `communication_channels/lib/access-control`,
   `customers/lib/visibilityFilter`, `inbox_ops`/`search` AI tools,
   `workflows/lib/activity-executor`, `ai-assistant/lib/auth`). The route-level
   `requireFeatures` guard (which routes through `RbacService`) already denies
   removed features, but when a route requires a broader feature and the
   handler checks a removed one inline, a wildcard grant still passes.
   Follow-up: a server-side `hasFeatureRespectingRemovals(granted, required)`
   helper and a per-site migration of **authorization** checks only.

3. **Why the shared matcher must NOT be made deny-aware globally.** The same
   `hasFeature`/`hasAllFeatures` helpers also gate **activation** of
   interceptors (`command-interceptor-runner`, `interceptor-runner`), mutation
   guards (`mutation-guard-registry`), response enrichers, component
   overrides, and notification recipients. At those sites `features` means
   "this component applies when the user holds the feature" — globally denying
   removed ids would silently *deactivate* security-enforcing components,
   failing open instead of closed. The deny must therefore stay at
   authorization chokepoints and be migrated per-site (gap 2), never baked
   into the pure matcher.

## Migration & Backward Compatibility

- No contract surface is removed or renamed; `enabledModulesRegistry` gains
  two additive exports.
- Behavior change (intended, fail-closed): downstream apps that null an ACL
  feature now actually deny it at runtime for all users, including super
  admins and holders of wildcard or stale explicit grants. Apps that nulled a
  feature merely to hide the role-management checkbox while still relying on
  wildcard grants to permit the action must replace the `null` override with a
  replacement entry (e.g. `{ id: '<feature-id>' }`) or remove the override.
- A stale `null` override targeting a feature id no module declares still
  denies that id (and bootstrap logs the existing stale-override warning) —
  consistent with "this feature does not exist here".
- No DB migration: stale explicit grants persisted in `role_acls` /
  `user_acls` become inert instead of being rewritten.

## Test Coverage

- `packages/shared/src/security/__tests__/enabledModulesRegistry.test.ts` —
  removed-id reporting, replacement-override non-removal, explicit-grant
  filtering with and without a populated module registry.
- `packages/core/src/modules/auth/services/__tests__/rbacService.test.ts` —
  wildcard-grant denial, stale-explicit-grant denial, super-admin denial,
  `tenantHasFeature` denial, `getGrantedFeatures` filtering.
- `packages/core/src/modules/customer_accounts/services/__tests__/customerRbacService.test.ts` —
  portal wildcard-grant denial and portal-admin denial.

Integration coverage: enforcement is fully covered at the unit level against
the real override store; no HTTP-level flow changes (guards already route
through `userHasAllFeatures`).

## Changelog

- 2026-07-22: Implemented deny-list enforcement for nulled ACL feature
  overrides across `enabledModulesRegistry` and `RbacService`.
- 2026-07-22: Extended the deny-list to portal `CustomerRbacService` and
  replaced the "Known limitation" note with a triage of the residual
  grant-side gaps (client cosmetic, in-handler fine-grained checks) and the
  fail-open rationale for keeping the shared matcher deny-unaware.
