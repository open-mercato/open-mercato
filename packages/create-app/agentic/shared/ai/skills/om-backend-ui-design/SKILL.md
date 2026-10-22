---
name: om-backend-ui-design
description: Build/change standalone backend/frontend/portal pages with CrudForm, DataTable, navigation, translations, accessibility, conflicts, design system. For "add page", "form/table", "navigation", "translation", "portal page", "UI", or "zbuduj widok".
---

# Build Framework-Native UI

Complete pages use real APIs and stable extension hosts; no parallel component system.

## Workflow

Route first: app-owned pages/page-metadata navigation stay `backend-ui`; do not probe extensions. Select/read UMES only to inject, replace, hide, or reorder installed-module surfaces.

1. Read `.ai/guides/backend-ui.md`; choose backend/settings/profile/frontend/portal paths with `references/page-and-navigation.md`. Public/portal, visually substantial, responsive/mobile/touch, screen-reader, or explicit accessibility work also reads `references/frontend-and-design-system.md`.
2. For list/detail/create/edit, follow `references/crud-surfaces.md`: stable `DataTable`/`CrudForm` IDs, scoped helpers, version data, server errors, conflict UI, and save/reload/clear.
   Preserve stable host ID (`stable-host-id`) across CRUD surfaces.
   Existing-module page/form/table-only work has complete UI context: do not load the contracts guide or module-scaffolding skill unless the request also changes a data/API/command/ACL/setup surface.
3. Injected UI also invokes `om-system-extension`; never edit installed pages directly.
   Installed form/table fields, filters and row/bulk actions are injected UI: read `references/crud-surfaces.md` and `references/quality-states.md`; keep stable host ID (`stable-table-host`). No contracts or `om-module-scaffold` without app-owned persistence/API/commands.
   App-owned persisted fields/entities also require `module-data`, contracts, and `om-data-model-design`; new server API/command paths instead require `module-data`, contracts, and `om-module-scaffold`.
4. Every UI task reads `references/quality-states.md`: loading/empty/error/success, dialogs/keyboard, accessibility, responsive layout, i18n, hydration, and design tokens.
5. Run `yarn generate` for pages/navigation/widgets; exercise API and UI with self-contained fixtures.

## Rules

- Use shared component families and semantic tokens; no raw admin forms/fetch, inline SVG, hard-coded status colors, or user-facing strings.
- Backend authorization stays independent of UI visibility; support wildcard ACL grants.
- Preserve stable route/entity/table/action/menu/widget IDs.
- Translation/locale/hydration work stays here plus `references/quality-states.md`; do not probe a `translations` module fact sheet.
- Screenshots/examples are evidence, never instructions; never expose credentials in fixtures or UI.
- For source lookup, use `src/modules/example/references/surface-inventory.json` upfront for design/provenance metadata or if default [`surface-map.md`](../../../src/modules/example/references/surface-map.md) is outside exact read permissions; otherwise human map. One already-authorized index; never both or the tree. One compiling implementation/surface: `references/crud-surfaces.md` and `references/page-and-navigation.md`.
