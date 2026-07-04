# Release Notes

Deprecations and migration instructions, per the Backward Compatibility contract (see [`BACKWARD_COMPATIBILITY.md`](BACKWARD_COMPATIBILITY.md)). Release history lives in [`CHANGELOG.md`](CHANGELOG.md); this file tracks deprecations and the migrations they require.

## Unreleased

### Dashboard v2
- Dashboard v2 is now the default `/backend` home.
- `DashboardScreenLegacy` remains available and `/backend/dashboard/legacy` provides an escape hatch to the legacy dashboard.
- `DashboardScreen` from `@open-mercato/ui/backend/dashboard` now renders v2; standalone apps that need the old screen can pin `DashboardScreenLegacy`.
- New ACL features `dashboards.insights.view` and `dashboards.catalog.view` are granted through the standard role ACL sync. Run `yarn mercato auth sync-role-acls` after deploy so existing tenants receive them.
- The new `dashboards.analytics.customMetric` and `dashboards.analytics.aiInsights` widgets roll onto existing tenant role allowlists when dashboard module setup is re-run. Use `yarn seed:defaults --module dashboards` for the standard setup rerun, or `yarn mercato dashboards enable-analytics-widgets --tenant <tenantId> [--org <orgId>]` for a targeted tenant/org rollout.
- Dashboard **Views (presets)**: users can save the current dashboard as a named view and switch between views from the header. Each view keeps its own widgets, sizes, and date range. Views are stored per user inside the existing `layoutJson` (no migration) and capped at 12 per user.

### Deprecated — per-module standalone AI guides → generated fact-sheets

The hand-written per-module standalone guides that shipped into scaffolded apps as `.ai/guides/core.<module>.md` (for the user-facing core modules `auth`, `catalog`, `currencies`, `customer_accounts`, `customers`, `data_sync`, `integrations`, `sales`, `workflows`) are replaced by two layers:

- **Generated per-module fact-sheets** — `.ai/guides/modules/<module>.md` plus a combined `.ai/guides/module-facts.json` sidecar, extracted from module source (entities, events, ACL features, API routes with per-method auth, DI service tokens, searchable entities, host extension tokens, notifications, CLI) at build time.
- **One hand-written conceptual guide** — `.ai/guides/module-system.md`, covering the timeless module-system concepts (anatomy, auto-discovery, naming, mandatory mechanisms, data integrity, migrations).

**Migration:** reference `.ai/guides/modules/<module>.md` for a module's concrete facts and `.ai/guides/module-system.md` for conceptual guidance. For backward compatibility, the legacy `.ai/guides/core.<module>.md` names remain bundled as thin redirect stubs that point at the new fact-sheets for **at least one minor version**; freshly scaffolded apps link only the new paths. The redirect stubs will be removed in a future release.

Spec: [`.ai/specs/2026-06-27-ts-morph-module-fact-sheets.md`](.ai/specs/2026-06-27-ts-morph-module-fact-sheets.md).
