# Pages, CRUD UI, Navigation, and i18n

Use shared backend/page primitives and keep UI behavior aligned with API scope, locking, and extension hosts.

## Page Selection

| Page | Location and rules |
|---|---|
| Backend list/detail/create/edit | `backend/**/page.tsx` plus sibling `page.meta.ts`; require staff auth/features. |
| Settings | Backend metadata with `pageContext: 'settings' as const` and `navHidden: true`. |
| Profile | Backend metadata with `pageContext: 'profile' as const`. |
| Public frontend | `frontend/**/page.tsx`; explicitly declare auth posture in metadata. |
| Customer portal | `frontend/[orgSlug]/portal/**/page.tsx`; require customer auth/features and add `nav` metadata only for sidebar destinations. |

List destinations need stable `pageGroup`, `pageGroupKey`, and order. Prefer a registered string icon name in `page.meta.ts` so generated metadata stays serializable; use `lucide-react` components in page-body UI. Hide create/edit/detail destinations from navigation when they are reached from a list.

## DataTable

- Use `DataTable` with stable colon-form `entityId`, `apiPath`, and `extensionTableId`. These are host contracts, not cosmetic props.
- Use shared column helpers, `RowActions` with stable action IDs, built-in filter/search/export/column controls, and DataTable bulk-action surfaces.
- When owning pagination, wire page, page size, total count, and change handlers together. Do not slice a server page again in the client.
- Use the table's empty state and shared loading/error components. A successful empty result is not an error.
- Route selected-row and long-running operations through guarded mutations and progress contracts; do not loop direct API writes without cancellation/error reporting.

## CrudForm

- Use `CrudForm`, typed fields/groups, and `createCrud`/`updateCrud`/`deleteCrud`; use the shared server-error adapter.
- Pass detail data including `updatedAt` as `initialValues`, allowing the form to protect update and delete automatically.
- Keep field IDs aligned through request validators, commands, response transforms, custom-field widgets, and translations.
- Support explicit `null` clearing where the field is clearable; avoid truthy fallbacks that resurrect the old value.
- Use `crud-form:<entityId>:fields` for injected fields and ensure the read/enricher and save/interceptor paths round-trip the same value.
- Use shared conflict surfacing for non-`CrudForm` writes.

## Data Access and States

- Use `apiCall`/`apiCallOrThrow`; use scoped API headers for versions or other request context. Never call raw `fetch` from app backend UI.
- Use `LoadingMessage`, `ErrorMessage`, `EmptyState`, `Alert`, flash messages, and the standard page/form scaffolding.
- Preserve the user's input after validation/server errors. Disable duplicate submissions and expose retry only when the operation is safe.
- Every dialog supports Cmd/Ctrl+Enter submit and Escape cancel. Every icon-only control has an accessible label.
- Keep server/client locale, timezone, and environment-derived initial render deterministic to prevent hydration mismatches.

## Navigation and Overrides

- Prefer page metadata for app-owned destinations and menu injection for adding/reordering items owned by another module.
- Use stable menu item IDs and translation keys. Gate injected items with wildcard-aware ACL checks.
- Hide or replace installed pages through `src/modules.ts` page overrides; do not delete package code or add a competing route accidentally.
- If disabling the dashboards module, update the backend landing page to redirect to the first accessible enabled destination, falling back to profile only when necessary.

## Design-System Contract

- For public/portal or visually substantial app work, use `om-backend-ui-design` → `references/frontend-and-design-system.md` for route-shell, product hierarchy, responsive, accessibility, and UX-state coverage.
- Reuse existing page, section, form, detail, schedule, messages, notification, chart, KPI, and banner component families before building a local variant.
- Use semantic design tokens and `StatusBadge` for status. Do not hard-code Tailwind status colors or arbitrary text sizes.
- Use `FormField`, `SectionHeader`, `CollapsibleSection`, standard buttons/dialogs, and Lucide icons.
- Keep responsive behavior, keyboard navigation, focus order, contrast, and reduced-motion behavior intact.

## Translation Contract

- Use `useT()` in client components and `resolveTranslations()` on the server.
- Put app translations in module/app locale files using stable namespaced keys. Translate titles, actions, placeholders, validation, empty/error states, notifications, and navigation.
- Declare `translations.ts` only for entity fields that use the Translation Manager and run `yarn generate` after changing it.
- Do not place translated output in stable machine identifiers, API enums, logs, or provider protocol values.

## Verification

1. Exercise permitted and forbidden roles, including wildcard grants.
2. Exercise loading, empty, validation error, server error, conflict, success, and delete flows.
3. Save, reload, edit, clear nullable fields, and verify the API payload and rendered state agree.
4. Check keyboard and narrow-width behavior; run affected integration tests through real API fixtures.
