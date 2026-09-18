# Sidebar Alpha/Beta Badges

## 📝 TLDR

Allow module authors to mark a backend page as `alpha` or `beta` in the sidebar for an optional, bounded period. The badge is declared alongside existing page navigation metadata, resolved server-side, and rendered by the shared sidebar in expanded and section-navigation views. Existing pages remain unchanged when the new optional field is absent or outside its active time window.

## 📝 Problem Statement

New backend capabilities need a lightweight, discoverable release-stage signal without changing their route titles or creating per-module sidebar implementations. The current metadata-driven navigation has no standard way to show an early-access designation, and a client-only date check would make the initial server-rendered navigation inconsistent.

## 📝 Proposed Solution

Add an additive `navBadge` metadata object:

```ts
navBadge: {
  label: 'alpha' | 'beta'
  startsAt?: '2026-09-14T00:00:00Z'
  endsAt?: '2026-12-01T00:00:00Z'
}
```

`startsAt` is inclusive and `endsAt` is exclusive. Either boundary may be omitted; an omitted badge or an invalid date boundary results in no badge. The server evaluates the window while building the authenticated chrome payload, so expired badges disappear on the next navigation-payload refresh without client timers or persistent state.

## 📝 Architecture

`PageMetadata` and the generated backend route manifest carry the optional declaration. `buildAdminNav` evaluates it against the current time and copies only an active `{ label }` to `AdminNavItem`. The auth chrome resolver serializes that value into main, settings, and profile navigation payloads. `AppShell` renders the value with the shared `Tag` primitive; alpha uses the warning semantic tone and beta uses the info semantic tone. Collapsed links expose the stage in their accessible/title text while keeping the rail compact.

No database, API endpoint, RBAC feature, sidebar preference, or module relationship changes are required. Existing sidebar preference records continue to match by the same item ids and hrefs.

## 📝 Data Model

No persisted data model. The public type `NavigationBadgeMetadata` contains `label`, optional `startsAt`, and optional `endsAt`; the resolved navigation type contains only the active `label`.

## 📝 API Contracts

The existing `/api/auth/admin/nav` response gains an optional `navBadge` field on main, settings, and profile navigation items. Existing consumers may ignore it. The OpenAPI/Zod response schema accepts `navBadge.label` as `alpha | beta`.

## 📝 UI/UX

An active badge appears as a compact pill after the page title. It does not replace or alter the page title, is not interactive, and remains visible when the link is disabled. Alpha uses the warning token family; beta uses the info token family. The label is localized through the app shell dictionary and is included in the compact link's accessible name/title.

## 📝 Edge Cases & Failure Scenarios

- No `navBadge`: render exactly the existing navigation.
- Before `startsAt` or at/after `endsAt`: omit the badge.
- Invalid boundary: omit the badge rather than showing stale or misleading release information.
- `startsAt` after `endsAt`: the window cannot be active.
- Cached chrome: the existing navigation cache TTL bounds expiry visibility; focus/manual refresh already refreshes the payload.
- Older clients: unknown response fields are ignored; older server payloads have no badge and render normally.

## 📝 Risks & Impact Review

The change touches the stable page metadata and backend chrome response contracts, but only by adding optional fields. No existing field is removed, renamed, narrowed, or reinterpreted. The generated manifest must be regenerated so the field is available to auto-discovered pages. Invalid metadata fails closed for presentation and cannot grant access or expose data. Rollback is deleting/omitting `navBadge` declarations; consumers remain compatible.

## 📋 Phasing

Phase 1: metadata, generated-manifest propagation, server-side active-window resolution, shared rendering, translations, and unit/API coverage. This is independently shippable.

## 📋 Implementation Plan

1. Extend shared page/route and backend chrome types plus CLI metadata normalization/generation with the optional badge declaration.
2. Resolve active badges in admin navigation, carry them through settings/profile conversion and the authenticated chrome API schema/serializer.
3. Render the badge with shared semantic UI primitives and localized labels in every supported app/template locale.
4. Add deterministic navigation and sidebar rendering tests, regenerate artifacts, and run focused package validation.

## Migration & Backward Compatibility

The new `navBadge` field is optional and additive. Existing module metadata, generated route manifests, sidebar preference keys, API consumers, and UI behavior remain valid without changes. Module authors opt in by adding the field to a page's `page.meta.ts`; no migration or upgrade action is required for existing installs.

## 📋 Changelog

- 2026-09-14: Marked the enterprise Agents page as an open-ended beta capability.

## 📋 Final Compliance Report

- No schema, migration, tenant-scope, RBAC, or cross-module relationship changes.
- Existing sidebar ordering, hiding, personalization, and route access checks remain unchanged.
- User-facing stage labels use i18n keys and semantic design-system tokens.
- Date evaluation is server-side and fails closed for malformed boundaries.
