# System-wide Feature Disablement through a Consolidated RBAC Policy

Status: Implemented

## TLDR

Allow an Open Mercato installation to disable any feature everywhere with one existing module override:

```ts
overrides: {
  acl: {
    features: {
      'module.feature': null,
    },
  },
}
```

This is the foundation for “thin” client installations: an app can remove capabilities it does not need without adding a new feature toggle or configuration option to every affected module and consumer. The existing RBAC feature ID becomes the system-wide control surface.

To make that guarantee reliable, server-side authorization semantics move into one shared policy kernel while staff and customer ACL loading remain realm-specific. A nulled feature is denied in routes, chrome, portal navigation, workflows, widgets, notifications, search, AI tools, and every other authorization consumer—even when stale explicit grants, wildcards, staff super-admin, or portal-admin access exist. Stored ACL rows are preserved so removing the override restores the previous grants.

## Overview

Open Mercato installations often need different product footprints. A client may need the CRM and catalog but not a particular workflow, dashboard, AI action, or management capability. Today, making such an installation “thin” requires finding every exposure of that capability and adding module-specific configuration or another feature-toggle path. That does not scale across existing modules and leaves room for hidden server-side consumers to remain active.

RBAC feature IDs already describe these capabilities throughout the system. The intended operator experience is therefore simple: null one ACL feature in `modules.ts`, and that capability becomes inert for everybody across all runtime surfaces. No data migration, role rewrite, or per-consumer toggle should be necessary.

Open Mercato still has two legitimate identity realms:

- Staff authentication and organization-scoped ACLs in the `auth` module.
- Customer authentication and portal ACLs in the `customer_accounts` module.

Those realms require separate persistence, session, scope, and ACL-loading code. They do not require separate authorization semantics. Feature decisions were repeated in chrome payload builders, portal navigation, dashboards, workflows, notifications, search, AI tools, and other runtime helpers. Those copies could evaluate wildcards, disabled modules, admin flags, and nulled overrides in different orders, preventing an ACL override from acting as a trustworthy installation-wide disable switch.

This change makes the shared feature policy the sole server-side authority for those semantics. Realm services load raw ACL data, enforce realm-specific scope, and delegate feature decisions and browser projections to the policy. As a result, an ACL null override is a universal runtime denial rather than only a catalog customization.

## Problem Statement

Module ACL overrides already let an installation express that it does not offer a feature:

```ts
acl: {
  features: {
    'module.feature': null,
  },
}
```

Before this change, that intent was not enforced consistently. The removed declaration disappeared from the enabled module catalog, but existing database grants could still contain the exact feature, a matching module wildcard, or `*`. Staff super-admin and portal-admin bypasses could also authorize it. Consumers that inspected raw ACL snapshots could continue exposing or executing the feature.

That makes null overrides unsuitable for producing thin installations: operators would still need to patch routes, navigation, background behaviors, and module-specific configuration individually. It also creates a security ambiguity because “removed from this installation” does not reliably mean “cannot execute.”

Raw wildcard grants also leak into browser capability fields. That forces client helpers to reproduce policy and makes it impossible to represent a global wildcard with one exact denial without sending a separate deny-list.

## Proposed Solution

### Shared feature policy

Add `@open-mercato/shared/security/featurePolicy`:

```ts
export type FeaturePolicySubject = {
  grantedFeatures: readonly string[]
  unrestricted?: boolean
  scopeAllowed?: boolean
}

export function authorizeFeatures(
  required: readonly string[],
  subject: FeaturePolicySubject,
): boolean

export function resolveEffectiveFeatures(
  grantedFeatures: readonly string[],
): string[]

export function getRemovedAclFeatureIds(): string[]
export function isAclFeatureRemoved(featureId: string): boolean
```

`authorizeFeatures` evaluates in this order:

1. Empty requirements succeed.
2. Explicitly invalid scope fails.
3. A removed or disabled required feature fails.
4. An unrestricted principal succeeds.
5. Otherwise all requirements must match the filtered raw grants using the existing wildcard matcher.

Removal is exact-ID based. ACL override precedence is the existing composed override precedence; a later non-null replacement makes the feature available again.

This turns existing RBAC declarations into reusable deployment configuration. Modules do not need to introduce dedicated flags for every capability: if a route, workflow, widget, notification, or tool already declares a feature requirement, the shared policy makes the installation-level null override effective there automatically.

`resolveEffectiveFeatures`:

1. Removes grants owned by disabled modules and exact removed IDs.
2. Expands `*` and namespace wildcards against a deterministic concrete feature catalog.
3. Removes disabled and nulled catalog entries.
4. Preserves valid explicit non-wildcard grants, including custom grants not otherwise cataloged.
5. Deduplicates in stable module/declaration order.
6. Never returns wildcard strings.

The concrete catalog includes enabled modules' ACL declarations, `setup.defaultCustomerRoleFeatures`, and frontend route `requireCustomerFeatures`. ACL declarations remain authoritative for off-convention owning-module IDs. If the module registry is unavailable, wildcard projection fails closed while surviving explicit non-wildcard grants remain.

The low-level `matchFeature`, `hasFeature`, and `hasAllFeatures` helpers remain pure and removal-blind. Browser code may use them on effective projections. Server authorization code must use the policy or a realm service.

### Realm services

`RbacService` and `CustomerRbacService` retain raw ACL loading and caching.

- Staff organization visibility is resolved before calling the shared policy.
- Staff super-admin maps to `unrestricted: true`.
- Portal admin maps to `unrestricted: true`.
- `userHasAllFeatures`, staff `tenantHasFeature`, and the staff compatibility `hasAllFeatures` wrapper delegate to `authorizeFeatures`.
- Both services add `getEffectiveFeatures(userId, scope)`.
- Staff super-admin projection resolves from `['*']`.
- Portal-admin projection resolves from `['portal.*']`.
- Raw `loadAcl` and `getGrantedFeatures` remain available for ACL management and infrastructure inspection.

### Capability consumers

Every server authorization consumer follows one of two paths:

- When a user and tenant/organization scope are available, call the realm service.
- When only an already-loaded ACL snapshot is available, call `authorizeFeatures`.

Backend chrome, customer auth responses, portal navigation, profile/session refresh, and JWT/request revalidation use realm `getEffectiveFeatures`. They do not send a separate deny-list.

`BackendChromePayload.grantedFeatures` and portal `resolvedFeatures` keep their existing names and array shapes. Their values become concrete effective IDs.

`CustomerAuthContext` gains the additive optional field `isPortalAdmin?: boolean`. Server-hydrated portal context uses this field instead of inferring admin status from `portal.*`.

The audited duplicated checks in dashboards, messages, workflows, entities, communication channels, inbox operations, search, AI tools, staff timesheets, and notification-recipient selection migrate to the realm service or shared policy. Portal navigation and portal AI widgets do not retain independent admin bypasses.

### Architectural enforcement

Add a repository test that rejects direct server-side matching of loaded ACL grants outside:

- The shared feature policy.
- Realm RBAC services.
- ACL-management/browser UI that does not make authoritative decisions.
- Explicitly documented test-only allowlist entries.

This prevents new `loadAcl + isSuperAdmin/hasFeature/matchFeature` policy copies.

## Architecture

```text
Staff ACL tables ──> RbacService ───────────┐
                                             ├─> shared feature policy ─> allow/deny
Customer ACL tables ─> CustomerRbacService ─┘                         └─> concrete projection

Chrome / portal / modules ─> realm service or policy; never raw policy logic
Browser helpers ───────────> pure matching over concrete projections
```

The shared package depends only on the shared module and override registries. It imports no domain package. Realm services retain DI names and existing method signatures.

## Data Models

No database entities, migrations, indexes, or stored ACL rows change.

Explicit grants for a nulled feature remain persisted and become runtime-inert. If the null override is later removed, those grants become effective again.

## API Contracts

Existing route URLs, methods, response fields, and schemas remain.

Behavior changes:

- `BackendChromePayload.grantedFeatures` returns concrete effective IDs and no wildcards.
- Customer login, magic-link verification, invitation acceptance, session refresh, profile, and request/JWT revalidation return concrete `resolvedFeatures`.
- Portal navigation is filtered from the same concrete effective projection.
- Removed required features return the existing authorization failure response even for unrestricted principals.

No client-visible deny-list field is added.

## UI/UX

No new UI is introduced. Existing chrome, portal navigation, widgets, and profile capability displays consume concrete effective features. Staff and portal admin status remain visible and functional through the existing boolean fields.

## Migration & Backward Compatibility

The change is additive for imports, function signatures, DI keys, and shared types:

- New shared policy exports are additive.
- `getEffectiveFeatures` is additive on both realm services.
- `CustomerAuthContext.isPortalAdmin` is optional.
- Existing raw ACL-loading methods remain.

The intentional behavioral contract change is that browser/JWT feature arrays no longer expose `*` or namespace wildcards. External consumers must check for concrete feature IDs rather than inspect wildcard strings. This is documented in `BACKWARD_COMPATIBILITY.md` and `UPGRADE_NOTES.md`.

No feature ID is renamed or removed. The `example.manage` null override is an inert runtime probe, not a declared feature removal.

## Risks & Impact Review

| Risk | Severity | Failure scenario | Mitigation | Residual risk |
|------|----------|------------------|------------|---------------|
| Incomplete wildcard expansion | High | Admin browser payload becomes empty and hides valid capabilities | Catalog ACL, customer defaults, and portal route requirements; assert non-empty portal/admin projections | Custom wildcard namespaces without declarations require an explicit catalog source |
| Missed secondary authorization gate | High | A leaf module bypasses the null denial | Migrate audited sites and add architectural coverage | Dynamically constructed checks may require future allowlist review |
| Browser contract behavior change | Medium | External code searches for `*` instead of concrete IDs | Keep field shapes, document upgrade, add concrete-payload tests | Unmaintained external clients may need updates |
| Registry unavailable | Medium | Wildcard cannot be safely expanded | Fail closed for wildcard projection; retain exact grants | Capability UI can be narrower in broken/bootstrap test contexts |
| Cached raw ACL data | Low | Old grants remain in cache after deploying new semantics | Apply policy after every raw load; do not cache policy decisions | Existing browser-local payload persists until normal refresh |
| Large super-admin payload | Low | Concrete expansion increases chrome/JWT size | Deduplicate stable feature IDs and measure representative payloads | Payload grows with the feature catalog |

## Phasing and Implementation Plan

### Phase A — Policy foundation

1. Extend the enabled-module registry with concrete catalog and availability helpers.
2. Add the shared feature policy and focused unit tests.
3. Add realm `getEffectiveFeatures` methods and delegate service decisions.

### Phase B — Consumer consolidation

1. Convert backend chrome and portal auth/navigation surfaces.
2. Convert audited staff and customer secondary authorization gates.
3. Add architectural coverage preventing direct server ACL matching.

### Phase C — Compatibility and integration

1. Activate the `example.manage: null` probe in app and create-app module registries.
2. Add staff and portal integration regressions.
3. Update documentation, compatibility notes, and package guidance.
4. Run generation, targeted tests, managed ephemeral integration tests, lint, and the full validation gate.

## Integration Test Coverage

### TC-AUTH-055 — Nulled feature denial

- Create isolated staff roles/users.
- Verify `example.manage` is denied for `*`, an explicit literal grant, and super-admin.
- Verify `example.todos.view` remains allowed.
- Verify admin navigation contains concrete features, no wildcard, and no `example.manage`.
- Clean up all fixtures in `finally`.

### Portal nulled feature and projection regression

- Create isolated customer/role fixtures.
- Verify portal-admin feature-check denies `example.manage`.
- Verify an active portal feature succeeds.
- Verify profile and navigation return a non-empty concrete feature set with no wildcard or removed feature.
- Verify `isPortalAdmin` remains true.
- Clean up all fixtures in `finally`.

## Final Compliance Report

- Backward compatibility: intentional browser-value semantic change documented; no removed contract surface.
- Tenant isolation: unchanged; realm services retain existing scoped loaders.
- Data integrity: no data model or migration.
- Security: null denial precedes every unrestricted/wildcard decision.
- Module isolation: shared policy has no core/domain dependency.
- API/UI: existing routes and field shapes retained.
- Integration coverage: staff and portal API/browser capability paths included.
- Performance/cache: no additional database query required beyond existing ACL loads.

## Changelog

### 2026-07-23

- Created the implementation spec from the approved consolidated feature-policy plan.
- Implemented the shared policy kernel, realm-service delegation and effective projections, audited consumer consolidation, architectural enforcement, fixtures, integration coverage, and documentation.
- Reframed the specification around the primary product outcome: using existing RBAC declarations as a universal feature-disable mechanism for thin client installations, without adding module-specific toggles.
- Completed the local ordered validation gate. Managed ephemeral Playwright execution remains environment-blocked because this sandbox has no Docker CLI/runtime; test discovery succeeds.
- Verified the app/template `modules.ts` change is in parity. The repository-wide template parity command still reports 25 unrelated pre-existing drift files outside this change.

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase A — Policy foundation | Complete | 2026-07-23 | Shared policy, registry projection, realm delegation, and tests implemented |
| Phase B — Consumer consolidation | Complete | 2026-07-23 | Capability surfaces and audited server gates migrated; architectural test added |
| Phase C — Compatibility and integration | Complete | 2026-07-23 | Fixtures, self-cleaning Playwright coverage, docs, generation, and local validation complete; managed execution environment-blocked |
