# Portal Page `nav` Metadata — Auto-Discovered Portal Sidebar

## TLDR

**Key Points:**
- Portal sidebar entries were historically hardcoded in `PortalShell` or only addable via `usePortalInjectedMenuItems` injection widgets. There was no "grant the feature, the sidebar entry appears" contract that mirrors the backoffice's `buildAdminNav` behavior.
- This spec introduces an **additive** optional `nav` block on `PageMetadata` (served as `PortalNavMetadata`). Portal pages that declare it are auto-listed in the portal sidebar by the new `/api/customer_accounts/portal/nav` endpoint, filtered by `requireCustomerFeatures` against the caller's resolved customer features.
- `buildPortalNav()` is the pure filtering function that mirrors `buildAdminNav()`, so feature-gating, wildcards (`portal.*`, `*`), and ordering are applied identically on both sides.
- The only serialized contract-surface additions are the optional `nav` block on page metadata entries and the nav-serialization path in the route-manifest generator. All other existing portal pages remain unchanged.

**Scope:**
- `packages/shared/src/modules/registry.ts` — add `PortalNavMetadata`; extend `PageMetadata` with optional `nav`
- `packages/cli/src/lib/generators/module-registry.ts` — serialize `nav` into the frontend route manifest
- `packages/ui/src/portal/utils/nav.ts` — new `buildPortalNav()` helper
- `packages/core/src/modules/customer_accounts/api/portal/nav.ts` — new endpoint that returns RBAC-filtered sidebar entries
- `packages/ui/src/portal/PortalShell.tsx` — consume the endpoint + merge with `usePortalInjectedMenuItems`
- `apps/mercato/src/app/(frontend)/[...slug]/page.tsx` — route manifest bootstrap registration
- Portal `page.meta.ts` files opting in to auto-discovered nav entries

**Out of Scope:**
- Breaking change to `requireCustomerAuth` / `requireCustomerFeatures` semantics — both are honored as before by the `(frontend)` catch-all.
- Removal or deprecation of `usePortalInjectedMenuItems`. Injected items still render and deduplicate against auto-discovered entries by `id`.
- Any change to the staff backoffice manifest or `buildAdminNav`.

## Problem Statement

Before this change, a third-party module author who wanted a portal sidebar entry had to:
1. Declare `requireCustomerAuth` / `requireCustomerFeatures` on a portal page (so the catch-all would gate access), **and**
2. Ship a separate menu-injection widget (`usePortalInjectedMenuItems`) whose feature-gating was maintained independently from the page gate.

That duplicated ACL logic across two surfaces, produced drift in v0.4.8 standalone builds (sidebar entries for revoked features, or vice versa), and made the portal sidebar non-auto-discoverable from a clean module scaffold. The backoffice has solved this with `buildAdminNav()` + route manifest + feature gating; the portal did not.

## Proposed Solution

Introduce a single opt-in metadata field: `PageMetadata.nav`. When present, the portal page is advertised to the `/api/customer_accounts/portal/nav` endpoint, which:
- reads the generated portal route manifest,
- resolves the caller's customer features via `CustomerRbacService`,
- filters entries through the shared wildcard-aware `matchFeature` helper, and
- returns a flat list grouped by `{ group: 'main' | 'account' }` with stable `id`s.

`PortalShell` merges the auto-discovered entries with the existing injection-widget menu items (same dedup-by-`id` semantics as the backoffice).

### New `PortalNavMetadata` shape

```ts
export type PortalNavMetadata = {
  label: string
  labelKey?: string
  group?: 'main' | 'account'
  order?: number
  icon?: string
}
```

### Optional `nav` field on `PageMetadata`

```ts
export type PageMetadata = {
  // ... existing fields (unchanged)
  nav?: PortalNavMetadata
}
```

### Example opt-in

```ts
// frontend/[orgSlug]/portal/orders/page.meta.ts
export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  requireCustomerFeatures: ['portal.orders.view'],
  nav: { label: 'Orders', labelKey: 'orders.nav.title', group: 'main', order: 20 },
}
```

Granting the feature to a customer role is now sufficient for the entry to appear. No separate menu-injection widget is required.

## Architecture

- **Source of truth:** the generated portal route manifest (emitted by `packages/cli/src/lib/generators/module-registry.ts`).
- **Filtering:** `buildPortalNav({ manifest, grantedFeatures })` (pure, synchronous) mirrors `buildAdminNav` and uses `@open-mercato/shared/security/features` `hasAllFeatures` — so wildcards (`portal.*`, `*`) resolve identically to page-gate checks.
- **Server endpoint:** `/api/customer_accounts/portal/nav` (feature-gated by `requireCustomerAuth`) returns the filtered list; the catch-all still enforces page-level access on direct navigation.
- **Client consumption:** `PortalShell` fetches once on mount and merges with `usePortalInjectedMenuItems()` by `id`.

## Risks & Impact Review

- **Risk:** Third-party modules already shipping portal `page.meta.ts` files could be surprised by the new optional field.
  - **Mitigation:** Field is strictly optional; absence means the page is routable but not auto-listed. No existing module is forced to migrate.
- **Risk:** Sidebar drift between injection widgets and auto-discovered entries.
  - **Mitigation:** Dedup by stable `id` (auto entries use the route path as `id`; injection widgets continue to declare their own `id`).
- **Risk:** Stale nav cache when a role's features change.
  - **Mitigation:** Client refetches on auth context change; structural cache purge (`yarn mercato configs cache structural --all-tenants`) runs after module enable/disable as documented in root `AGENTS.md`.

## Migration & Backward Compatibility

This change is **purely additive** across every contract surface listed in `BACKWARD_COMPATIBILITY.md`. No deprecation bridge is required because nothing is removed, renamed, or narrowed.

| Surface | Classification | Impact | Action for third-party modules |
|---------|----------------|--------|--------------------------------|
| 2 — Type definitions (`PageMetadata`, new `PortalNavMetadata`) | STABLE | `nav` is an optional field; `PortalNavMetadata` is newly exported. No existing field changes type or cardinality. | None. Opt in when you want an auto-discovered sidebar entry. |
| 6 — Widget injection spot IDs | FROZEN | Unchanged. `usePortalInjectedMenuItems` widgets continue to render and dedup by `id`. | None. |
| 7 — API route URLs | STABLE | Adds `GET /api/customer_accounts/portal/nav`. No existing route is renamed or removed; no response fields are removed. | None. Consumers may opt in. |
| 13 — Generated file contracts | STABLE | Portal route manifest entries gain an optional `nav` block in the serialized output. Existing export names (`routeManifest`, `BootstrapData`) and shapes are unchanged; new field is optional. | Re-run `yarn generate` if you consume the manifest directly. No code change needed. |

**Deprecation protocol status:** N/A — no removals, renames, or narrowed types.

**Rollback plan:** Remove the `nav` block from opt-in pages and stop mounting the endpoint. No data migration is required (no persistent state introduced).

## Changelog

- 2026-04-21 — Initial spec capturing the additive `PageMetadata.nav` / `PortalNavMetadata` contract landed in PR #1629 alongside the Phase 1–2b / Phase 3A implementation from `.ai/reports/2026-04-21-customer-portal-framework-review.md`.
