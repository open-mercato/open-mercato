# UI Package - Agent Guidelines

This document captures UI usage patterns based on current implementations in the customers, sales, and staff (auth users/roles) modules. Use these as the default conventions when building new UI in `packages/ui` or when consuming UI components from other modules.

## Reference Modules

- Customers: `packages/core/src/modules/customers/backend/customers/people/create/page.tsx`, `packages/core/src/modules/customers/backend/customers/people/page.tsx`, `packages/core/src/modules/customers/components/detail/TaskForm.tsx`
- Sales: `packages/core/src/modules/sales/components/documents/SalesDocumentsTable.tsx`, `packages/core/src/modules/sales/components/documents/PaymentsSection.tsx`, `packages/core/src/modules/sales/components/documents/SalesDocumentForm.tsx`
- Staff (auth users/roles): `packages/core/src/modules/auth/backend/users/page.tsx`, `packages/core/src/modules/auth/backend/users/create/page.tsx`, `packages/core/src/modules/auth/backend/roles/create/page.tsx`

## CrudForm Guidelines

- Use `CrudForm` as the default for create/edit flows and for dialog forms.
- If a backend page cannot use `CrudForm`, wire save flows through the global mutation injection hook:
  - use `useInjectionSpotEvents(GLOBAL_MUTATION_INJECTION_SPOT_ID)` from `@open-mercato/ui/backend/injection/InjectionSpot` + `@open-mercato/ui/backend/injection/mutationEvents`
  - run `onBeforeSave` before mutation, apply `requestHeaders` via `withScopedApiRequestHeaders`, then run `onAfterSave`
  - on failure, emit `dispatchBackendMutationError({ contextId, error })` so global modules (for example conflict dialogs) work consistently
- Keep `CrudForm` implementations reusable: extract shared field/group builders and submit handlers into module-level helpers when multiple pages or dialogs need the same shape.
- Drive validation with a Zod schema and surface field errors via `createCrudFormError`.
- Keep `fields` and `groups` in memoized helpers (see customers person form config).
- Pass `entityIds` when custom fields are involved so form helpers load correct custom-field sets.
- Use `createCrud`/`updateCrud`/`deleteCrud` for submit actions and call `flash()` for success or failure messaging.
- For multi-step submit flows, keep the form submit handler focused and move secondary operations (like extra address writes) into isolated helpers with per-item error handling.

## UI Interaction
- Every new dialog must support `Cmd/Ctrl + Enter` as a primary action shortcut and `Escape` to cancel, mirroring the shared UX patterns used across modules.
- Default to `CrudForm` for new forms and `DataTable` for tables displaying information unless a different component is explicitly required.
- Use the `EventSelect` component from `@open-mercato/ui/backend/inputs/EventSelect` for event selection. It fetches declared events via the `/api/events` endpoint.
- Never use `window.confirm` — use the shared `ConfirmDialog` and `useConfirmDialog` from `@open-mercato/ui/backend/confirm-dialog` for confirmation flows.
- New CRUD forms should use `CrudForm` wired to CRUD factory/commands APIs and be shared between create/edit flows.
- Prefer reusing components from the shared `packages/ui` package before introducing new UI primitives.
- For new `DataTable` columns, set `meta.truncate` and `meta.maxWidth` in the column config when you need specific truncation behavior; only rely on defaults when those are not set.
- When you create new UI check reusable components before creating UI from scratch (see [`.ai/specs/SPEC-001-2026-01-21-ui-reusable-components.md`](.ai/specs/SPEC-001-2026-01-21-ui-reusable-components.md))
- For form/detail page headers and footers, use `FormHeader` and `FormFooter` from `@open-mercato/ui/backend/forms`. `FormHeader` supports two modes: `edit` (compact, used automatically by CrudForm) and `detail` (large title with entity type label, status badge, Actions dropdown). Delete/Cancel/Save are always standalone buttons; additional context actions (Convert, Send, etc.) go into the `menuActions` array rendered as an "Actions" dropdown. See [SPEC-016](.ai/specs/SPEC-016-2026-02-03-form-headers-footers.md) for full API.

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
