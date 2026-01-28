# UI Package - Agent Guidelines

This document captures UI usage patterns based on current implementations in the customers, sales, and staff (auth users/roles) modules. Use these as the default conventions when building new UI in `packages/ui` or when consuming UI components from other modules.

## Reference Modules

- Customers: `packages/core/src/modules/customers/backend/customers/people/create/page.tsx`, `packages/core/src/modules/customers/backend/customers/people/page.tsx`, `packages/core/src/modules/customers/components/detail/TaskForm.tsx`
- Sales: `packages/core/src/modules/sales/components/documents/SalesDocumentsTable.tsx`, `packages/core/src/modules/sales/components/documents/PaymentsSection.tsx`, `packages/core/src/modules/sales/components/documents/SalesDocumentForm.tsx`
- Staff (auth users/roles): `packages/core/src/modules/auth/backend/users/page.tsx`, `packages/core/src/modules/auth/backend/users/create/page.tsx`, `packages/core/src/modules/auth/backend/roles/create/page.tsx`

## CrudForm Guidelines

- Use `CrudForm` as the default for create/edit flows and for dialog forms.
- Keep `CrudForm` implementations reusable: extract shared field/group builders and submit handlers into module-level helpers when multiple pages or dialogs need the same shape.
- Drive validation with a Zod schema and surface field errors via `createCrudFormError`.
- Keep `fields` and `groups` in memoized helpers (see customers person form config).
- Pass `entityIds` when custom fields are involved so form helpers load correct custom-field sets.
- Use `createCrud`/`updateCrud`/`deleteCrud` for submit actions and call `flash()` for success or failure messaging.
- For multi-step submit flows, keep the form submit handler focused and move secondary operations (like extra address writes) into isolated helpers with per-item error handling.

## DataTable Guidelines

- Use `DataTable` as the default list view.
- Populate `columns` with explicit renderers and set `meta.truncate`/`meta.maxWidth` where truncation is needed.
- For filters, use `FilterBar`/`FilterOverlay` with async option loaders; keep `pageSize` at or below 100.
- Support exports using `buildCrudExportUrl` and pass `exportOptions` to `DataTable`.
- Use `RowActions` for per-row actions and include navigation via `onRowClick` or action links.
- Keep table state (paging, sorting, filters, search) in component state and reload on scope changes.

## Loading, Empty, and Error States

- For list/detail data loading, use `LoadingMessage` and `ErrorMessage` from `@open-mercato/ui/backend/detail`.
- Use `TabEmptyState` when a section is empty but otherwise healthy (see sales document sub-sections).
- Keep loading flags local to the section and reset errors before each load.

## Flash Messages

- Use `flash(message, 'success' | 'error')` from `@open-mercato/ui/backend/FlashMessages` for user feedback after CRUD operations.
- Prefer specific translation keys and keep the message copy in module locale files.
- For non-blocking errors in side effects (for example, creating secondary records), show a flash error and allow the main flow to complete.

## Notifications

- Define notification types in `src/modules/<module>/notifications.ts` and client renderers in `notifications.client.ts`.
- Renderers live in `widgets/notifications/` and should use `useT()` for copy.
- Use the shared action labels where possible (for example, `notifications.actions.dismiss`).
- Prefer notification creation in commands or subscribers and keep UI renderers lightweight.

## Component Reuse

- Prefer existing UI primitives and backend components from `@open-mercato/ui` before creating new ones.
- Reference @`.ai/specs/SPEC-001-2026-01-21-ui-reusable-components.md` for the reusable component catalog and usage patterns.
- For dialogs and forms, keep the interaction model consistent: `Cmd/Ctrl + Enter` to submit, `Escape` to cancel.
- Favor composable, data-first helpers (custom field helpers, CRUD helpers, filter utilities) over bespoke logic.
