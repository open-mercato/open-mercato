# Pages, CRUD UI, Navigation, and i18n

Shared backend/page primitives; align API scope/locking/extension hosts.

## When This Guide Applies

Add `backend-ui` when authoring/restyling/permission-gating app-owned or injected rendered UI; rarely alone, pair with owner route: installed `umes`, app-owned `module-data`. Exclude hiding/toggling/disabling/rewiring installed-owned UI, payload text, pagination, table IDs.

## Page Selection

Module-owned app pages: `src/modules/<id>/{backend,frontend}/**/page.tsx`, then `yarn generate` for `(backend)`/`(frontend)` registry catch-alls. Never put `page.tsx`/`page.meta.ts` under `src/app/(backend)/**` or `src/app/(frontend)/**`: unregistered Next.js routes bypass nav injection, ACL feature-gating, breadcrumbs. Paths: owning `src/modules/<id>/`.

| Page | Rules |
|---|---|
| Backend list/detail/create/edit | `src/modules/<id>/backend/**/page.tsx` + sibling `page.meta.ts`; require staff auth/features. |
| Settings | Backend metadata: `pageContext: 'settings' as const`, `navHidden: true`. |
| Profile | Backend metadata: `pageContext: 'profile' as const`. |
| Public frontend | `src/modules/<id>/frontend/**/page.tsx`; explicit auth metadata. |
| Customer portal | `src/modules/<id>/frontend/[orgSlug]/portal/**/page.tsx`; public login/signup/verify/landing: `navHidden`, no customer auth; authenticated: customer auth/features; only sidebar destinations add `nav`. |

Lists: stable `pageGroup`, `pageGroupKey`, order. Verify `page.meta.ts` `icon` names in the installed registry; unlisted Lucide names silently omit icons. Page bodies use `lucide-react`. Hide list-reached create/edit/detail navigation.

## Default CRUD Completeness

New editable entities/modules: unless the brief explicitly excludes an operation, connect list, create, view/edit, and delete. `DataTable`: server filter/search, localized add action to create, stable linked row action to view/edit. `CrudForm`: create/update/delete, custom-field save/reload/clear, `updatedAt` conflicts, return navigation. No backend entity only reachable by typed URL.

## Cross-Record References

Same/installed-module references show names, never raw IDs: forms use searchable selects/pickers and scoped option-source routes (reuse existing owner sources/pickers); tables use display names or stored display snapshots. UUIDs: API payloads only, never user input/display.

## DataTable

- Stable colon-form `entityId`, explicit typed data/pagination via shared API helpers, `extensionTableId` are host contracts, not cosmetics. `DataTable` has no `apiPath` prop.
- Use shared column helpers, `RowActions` with stable action IDs, built-in filter/search/export/column controls, and bulk-action surfaces.
- Wire owned page/page size/total/change handlers together; never re-slice server pages client-side.
- Use table empty state/shared loading-error components; successful empty is not error.
- Selected-row/long operations use guarded mutations/progress; direct API-write loops require cancellation/error reporting.

## CrudForm

- Typed fields/groups, `createCrud`/`updateCrud`/`deleteCrud`, and the shared server-error adapter.
- Detail `initialValues` include `updatedAt`: automatic update/delete protection.
- Align field IDs: validators/commands/response transforms/custom-field widgets/translations.
- Support clearable fields' explicit `null`; no truthy fallback resurrecting old values.
- Inject at `crud-form:<entityId>:fields`; round-trip the same value through read/enricher and save/interceptor paths.
- Non-`CrudForm` writes: shared conflict surfacing.

## Data Access and States

- Use `apiCall`/`apiCallOrThrow` and scoped API headers for versions/request context; never raw `fetch` in app backend UI.
- Use `LoadingMessage`, `ErrorMessage`, `EmptyState`, `Alert`, flash messages, and standard page/form scaffolding.
- Preserve input on validation/server errors; block duplicate submissions; safe retry only.
- Dialogs: Cmd/Ctrl+Enter submits, Escape cancels. Accessible labels on icon-only controls.
- Prevent hydration mismatches: deterministic initial server/client locale/timezone/environment renders.

## Navigation and Overrides

- Prefer app-owned destination metadata; menu injection adds/reorders other modules' items.
- Use stable menu IDs/translation keys and wildcard-aware ACL for injected items.
- Hide/replace installed pages: `src/modules.ts` page overrides; no package deletion/accidental competing route.
- Disable dashboards: backend landing redirects to first accessible enabled destination, profile only as fallback.

## Design-System Contract

- Public/portal or substantial visual work: `om-backend-ui-design` → `references/frontend-and-design-system.md`: route-shell, product hierarchy, responsive, accessibility, UX states.
- Reuse page/section/form/detail/schedule/messages/notification/chart/KPI/banner families before local variants.
- Semantic tokens + `StatusBadge`; no hard-coded Tailwind status colors/arbitrary text sizes.
- Use `FormField` for standalone forms; never wrap `CrudForm` in it (owns field layout). Use `SectionHeader`, `CollapsibleSection`, standard buttons/dialogs, Lucide icons.
- Portal record lists use `DataTable`. No raw buttons/checkboxes, button-styled raw `Link`, or `window.confirm`; use exported primitives and `useConfirmDialog`.
- Preserve responsive, keyboard, focus-order, contrast, and reduced-motion behavior.

## Translation Contract

- Client: `useT()`; server: `resolveTranslations()`.
- Module/app locale files, stable namespaced keys: titles/actions/placeholders/validation/empty-error states/notifications/navigation.
- `translations.ts` is only for Translation Manager entity fields; `yarn generate` after changes.
- No translated machine IDs/API enums/logs/provider protocol values.

## Verification

1. Exercise permitted/forbidden roles + wildcard grants.
2. Exercise loading/empty/validation-error/server-error/conflict/success/delete flows.
3. Save/reload/edit/clear nullable fields; verify API/rendered state agreement.
4. Check keyboard/narrow-width; affected integration tests use real API fixtures.

## Canonical example source

Rule owner: this guide. Compiling table/form/page-shell/rendered-injection examples: read one `Backend UI` row in [`src/modules/example/references/surface-map.md`](../../src/modules/example/references/surface-map.md), (exact file links), or open [`components/TodosTable.tsx`](../../src/modules/example/components/TodosTable.tsx) and [`components/TodoForm.tsx`](../../src/modules/example/components/TodoForm.tsx) directly. Source-present, runtime-disabled: one row, never the tree; rename every `example` identifier.

Accepted props: exact installed implementation [`@open-mercato/ui/src/backend/DataTable.tsx`](../../node_modules/@open-mercato/ui/src/backend/DataTable.tsx). Read-only `node_modules`; no unlinked siblings/import targets.
