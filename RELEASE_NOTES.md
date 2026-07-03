# Release Notes

## Unreleased

### Dashboard v2
- Dashboard v2 is now the default `/backend` home.
- `DashboardScreenLegacy` remains available and `/backend/dashboard/legacy` provides an escape hatch to the legacy dashboard.
- `DashboardScreen` from `@open-mercato/ui/backend/dashboard` now renders v2; standalone apps that need the old screen can pin `DashboardScreenLegacy`.
- New ACL features `dashboards.insights.view` and `dashboards.catalog.view` are granted through the standard role ACL sync. Run `yarn mercato auth sync-role-acls` after deploy so existing tenants receive them.
- The new `dashboards.analytics.customMetric` and `dashboards.analytics.aiInsights` widgets roll onto existing tenant role allowlists when dashboard module setup is re-run. Use `yarn seed:defaults --module dashboards` for the standard setup rerun, or `yarn mercato dashboards enable-analytics-widgets --tenant <tenantId> [--org <orgId>]` for a targeted tenant/org rollout.
- Dashboard **Views (presets)**: users can save the current dashboard as a named view and switch between views from the header. Each view keeps its own widgets, sizes, and date range. Views are stored per user inside the existing `layoutJson` (no migration) and capped at 12 per user.
