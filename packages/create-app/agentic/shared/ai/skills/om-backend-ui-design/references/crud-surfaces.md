# CRUD UI Surfaces

Load this reference for list/detail/create/edit/delete work.

Unless the brief explicitly excludes an operation, a new editable entity includes list, create, view/edit, and delete. The list supplies filter/search, a localized add action, and a linked row action; the forms use the shared CRUD helpers and return to a reachable list.

- DataTable: stable `entityId`, `apiPath`, `extensionTableId`; controlled `searchValue`/`onSearchChange` and filter state passed to the server; complete pagination ownership; built-in empty/loading/error/export behavior. Its localized add link uses the canonical `/create` child route (not an invented `/new` variant), and `RowActions` exposes stable guarded edit and delete actions. When authoring a new host UI, publish intentional extension spots with stable column, action, and row-action IDs rather than creating an isolated local-only table.
- CrudForm: typed fields/groups, shared create/update/delete helpers, server-error adapter, `initialValues.updatedAt`, explicit null clearing, translation keys. Collect injected/custom fields with `collectCustomFieldValues` from `@open-mercato/ui/backend/utils/customFieldValues`; do not pass the raw form object or assume a nested `customFields` property.
- Detail: load through shared API helpers, preserve scoped/auth errors, use reusable detail sections and stable extension spots. Keep host IDs aligned with the API `enrichers` entity ID and add widget/injection round-trip coverage when the surface is extensible.
- Custom mutations: scoped API headers plus record-specific optimistic lock, shared conflict surfacing, duplicate-submit prevention.
- Injected fields: render/input + read/enricher + `collectCustomFieldValues` save/interceptor/command paths and save/reload/clear coverage. Command undo restores captured snapshots with `buildCustomFieldResetMap` from the integrity/concurrency procedure.
- Bulk actions: guarded mutations/commands, progress/cancellation, partial-result reporting; no silent client mutation loops.

Test list/detail/create/update/delete, validation, current/stale version, clearing, denied/wildcard ACL, and the exact response-to-form mapping.
