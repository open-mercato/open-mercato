# UI Package - Agent Guidelines

This document captures UI usage patterns based on current implementations in the customers, sales, and staff (auth users/roles) modules. Use these as the default conventions when building new UI in `packages/ui` or when consuming UI components from other modules.

## Reference Modules

- Customers: `packages/core/src/modules/customers/backend/customers/people/create/page.tsx`, `packages/core/src/modules/customers/backend/customers/people/page.tsx`, `packages/core/src/modules/customers/components/detail/TaskForm.tsx`
- Sales: `packages/core/src/modules/sales/components/documents/SalesDocumentsTable.tsx`, `packages/core/src/modules/sales/components/documents/PaymentsSection.tsx`, `packages/core/src/modules/sales/components/documents/SalesDocumentForm.tsx`
- Staff (auth users/roles): `packages/core/src/modules/auth/backend/users/page.tsx`, `packages/core/src/modules/auth/backend/users/create/page.tsx`, `packages/core/src/modules/auth/backend/roles/create/page.tsx`

## Button and IconButton Usage

**MUST use `Button` or `IconButton` from `@open-mercato/ui` for every interactive button.** Never use raw `<button>` elements.

### When to Use Which

| Use case | Component | Example |
|----------|-----------|---------|
| Button with text label (with or without icon) | `Button` | Save, Cancel, Apply filters |
| Icon-only button (no visible text) | `IconButton` | Close ✕, Settings ⚙, Trash 🗑 |
| Button wrapping a `<Link>` | `IconButton asChild` or `Button asChild` | `<IconButton asChild><Link href="...">...</Link></IconButton>` |

### Imports

```typescript
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
```

### MUST Rules

1. **MUST always pass `type="button"` explicitly** on non-submit buttons. Neither `Button` nor `IconButton` sets a default type — HTML defaults to `type="submit"`, which causes accidental form submissions.
2. **MUST NOT use raw `<button>` elements** anywhere in the codebase. Use `Button` or `IconButton` instead.
3. **MUST use `IconButton`** (not `Button size="icon"`) for icon-only buttons. `IconButton` has fixed square dimensions optimized for icon-only content.
4. **MUST add `hover:bg-transparent`** when using `variant="ghost"` for tab-style buttons with underline indicators, to suppress the default hover background.
5. **MUST add `h-auto`** when using Button/IconButton in compact inline contexts (tag chips, toolbars, inline lists) where the fixed height from size variants would overflow the container.

### Variant Reference

**Button variants**: `default` (primary CTA), `destructive` (danger), `outline` (bordered), `secondary` (subdued), `ghost` (no border/bg), `muted` (dimmed text, ghost-like), `link` (underlined text).

**Button sizes**: `default` (h-9 px-4), `sm` (h-8 px-3), `lg` (h-10 px-6), `icon` (size-9, square).

**IconButton variants**: `outline` (bordered, default), `ghost` (no border/bg).

**IconButton sizes**: `xs` (size-6 / 24px), `sm` (size-7 / 28px), `default` (size-8 / 32px), `lg` (size-9 / 36px).

### Common Patterns

```tsx
// Sidebar / nav toggle
<IconButton variant="outline" size="sm" type="button" onClick={toggle} aria-label="Toggle sidebar">
  <PanelLeft className="size-4" />
</IconButton>

// Close / dismiss button
<IconButton variant="ghost" size="sm" type="button" onClick={onClose} aria-label="Close">
  <X className="size-4" />
</IconButton>

// Tab navigation (underline style)
<Button
  type="button"
  variant="ghost"
  size="sm"
  className={cn(
    'h-auto rounded-none border-b-2 px-0 py-1 hover:bg-transparent',
    isActive ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'
  )}
>
  {label}
</Button>

// Dropdown menu item
<Button variant="ghost" size="sm" type="button" className="w-full justify-start" role="menuitem">
  <Icon className="size-4" /> {label}
</Button>

// Compact toolbar button (rich text editor)
<Button variant="ghost" size="sm" type="button" className="h-auto px-2 py-0.5 text-xs">
  Bold
</Button>

// Collapsible section header
<Button variant="muted" type="button" className="w-full justify-between" onClick={toggle}>
  <span>{sectionLabel}</span>
  <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
</Button>

// Link-styled icon button (wrapping Next.js Link)
<IconButton asChild variant="ghost" size="sm">
  <Link href="/backend/settings">
    <Settings className="size-4" />
  </Link>
</IconButton>
```

## CrudForm Guidelines

- Use `CrudForm` as the default for create/edit flows and for dialog forms.
- If a backend page cannot use `CrudForm`, use `useGuardedMutation` from `@open-mercato/ui/backend/injection/useGuardedMutation` for every write operation (`POST`/`PUT`/`PATCH`/`DELETE`).
- Always call writes through `runMutation({ operation, context, mutationPayload })` so global injection modules (for example record-lock conflict handling) can run `onBeforeSave`/`onAfterSave`, apply scoped request headers, and receive mutation errors consistently.
- Use manual `useInjectionSpotEvents(GLOBAL_MUTATION_INJECTION_SPOT_ID)` wiring only when you need behavior that `useGuardedMutation` does not support.
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
- DataTable extension spots include: `data-table:<tableId>:columns`, `:row-actions`, `:bulk-actions`, `:filters` (in addition to `:header`/`:footer`).
- Populate `columns` with explicit renderers and set `meta.truncate`/`meta.maxWidth` where truncation is needed.
- For filters, use `FilterBar`/`FilterOverlay` with async option loaders; keep `pageSize` at or below 100.
- Support exports using `buildCrudExportUrl` and pass `exportOptions` to `DataTable`.
- Use `RowActions` for per-row actions and include navigation via `onRowClick` or action links.
- Keep table state (paging, sorting, filters, search) in component state and reload on scope changes.
- Keep `extensionTableId` stable and deterministic; host pages should not derive it from transient UI state.
- Render injected row actions and bulk actions through `RowActions`/bulk action handlers so injected actions follow the same guard and i18n behavior as built-ins.

## CrudForm Field Injection (UMES Phase G)

- `CrudForm` automatically resolves injected field widgets from `crud-form:<entityId>:fields`; always pass a stable `entityId`.
- Keep host field/group IDs stable so injected fields can target groups deterministically across versions.
- Use injected fields for cross-module form augmentation; keep core module fields in the base form config.

## Menu Injection (UMES Phase A/B)

- Use `useInjectedMenuItems(surfaceId)` to load declarative menu widgets for chrome surfaces (`menu:sidebar:*`, `menu:topbar:*`).
- Merge built-in and injected items with `mergeMenuItems(builtIn, injected)` to preserve deterministic placement.
- For relative positioning, rely on `InjectionPosition` + `relativeTo` IDs; if `relativeTo` is missing, insertion falls back to append.
- Treat injected labels as i18n-first: prefer `labelKey` (with human fallback `label`) and `groupLabelKey` (with optional `groupLabel`) so keys never leak to UI.
- Add stable attributes (`data-menu-item-id="<id>"`) when rendering merged items so integration tests can assert injected entries reliably.

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
- For replacement-aware hosts, expose stable handle IDs (`page:*`, `data-table:*`, `crud-form:*`, `section:*`) so overrides are deterministic.
- Reference @`.ai/specs/SPEC-001-2026-01-21-ui-reusable-components.md` for the reusable component catalog and usage patterns.
- For dialogs and forms, keep the interaction model consistent: `Cmd/Ctrl + Enter` to submit, `Escape` to cancel.
- Favor composable, data-first helpers (custom field helpers, CRUD helpers, filter utilities) over bespoke logic.

## Component Replacement (UMES Phase H)

- When a host surface is replacement-aware, resolve implementations via `useRegisteredComponent(handle, Fallback)` instead of hardcoded component references.
- Prefer additive override modes (`wrapper`, `props`) before full `replace`; reserve `replace` for cases where compatibility is preserved.
- Keep handle IDs stable and document them when introducing new replacement-aware surfaces.
