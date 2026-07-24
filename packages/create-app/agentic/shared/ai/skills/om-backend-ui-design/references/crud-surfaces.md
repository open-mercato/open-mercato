# CRUD UI Surfaces

Load this reference for list/detail/create/edit/delete work.

- DataTable: stable `entityId`, `apiPath`, `extensionTableId`; columns/actions/filters with stable IDs; complete pagination ownership; built-in empty/loading/error/export behavior.
- CrudForm: typed fields/groups, shared create/update/delete helpers, server-error adapter, `initialValues.updatedAt`, explicit null clearing, translation keys.
- Detail: load through shared API helpers, preserve scoped/auth errors, use reusable detail sections and stable extension spots.
- Custom mutations: scoped API headers plus record-specific optimistic lock, shared conflict surfacing, duplicate-submit prevention.
- Injected fields: render/input + read/enricher + save/interceptor/command paths and save/reload/clear coverage.
- Bulk actions: guarded mutations/commands, progress/cancellation, partial-result reporting; no silent client mutation loops.

Test list/detail/create/update/delete, validation, current/stale version, clearing, denied/wildcard ACL, and the exact response-to-form mapping.
