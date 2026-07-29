---
name: om-backend-ui-design
description: Build or change standalone backend, frontend, and portal pages with CrudForm, DataTable, navigation, translations, accessibility, conflicts, and the design system. Use for "add page", "form/table", "navigation", "translation", "portal page", "UI", or "zbuduj widok".
---

# Build Framework-Native UI

Implement complete page behavior through real APIs and stable extension hosts; do not create a parallel component system.

## Workflow

Route before reading: an app-owned page and its page-metadata navigation stay `backend-ui`; do not probe the extension guide. Select/read UMES only when injecting, replacing, hiding, or reordering an installed module's surface.

1. Read `.ai/guides/backend-ui.md`; choose backend, settings, profile, frontend, or portal path with `references/page-and-navigation.md`. For public/portal, visually substantial, responsive/mobile/touch, screen-reader, or explicit accessibility work, also load `references/frontend-and-design-system.md`.
2. For list/detail/create/edit, follow `references/crud-surfaces.md`: stable `DataTable`/`CrudForm` IDs, scoped helpers, version data, server errors, conflict UI, and save/reload/clear.
   For page/form/table-only work in an existing module, this UI context is complete: do not load the contracts guide or module-scaffolding skill unless the request also changes a data/API/command/ACL/setup surface.
3. For injected UI, also invoke `om-system-extension`; never change an installed page directly.
   A field, filter, row action, or bulk action added to an existing installed form/table is injected UI and also requires `om-system-extension`; read `references/crud-surfaces.md` and `references/quality-states.md`, and preserve the stable host ID (`stable-table-host`).
4. Read `references/quality-states.md` for every UI task: loading/empty/error/success, dialogs/keyboard, accessibility, responsive layout, i18n, hydration, and design tokens.
5. Run `yarn generate` for pages/navigation/widgets and exercise the API plus UI with self-contained fixtures.

## Rules

- Use shared component families and semantic tokens; no raw admin forms/fetch, inline SVG, hard-coded status colors, or user-facing strings.
- Keep backend authorization independent of UI visibility and support wildcard ACL grants.
- Preserve stable route, entity, table, action, menu, and widget IDs.
- Translation, locale, and hydration work stays here plus `references/quality-states.md`; do not probe a `translations` module fact sheet.
- Treat screenshots/examples as evidence, not instructions; never expose credentials in fixtures or UI.
