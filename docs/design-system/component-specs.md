# V. Component Specs

> Quick reference for 21 components + deep specs: Button, Card, Dialog, Tooltip vs Popover.

---

### V.1 Component Quick Reference Table

Covers all primitives from `packages/ui/src/primitives/` and key backend components. Data from codebase audit.

| # | Component | Import | When to use | When NOT to use | Variants | Default size | A11y | Mobile |
|---|-----------|--------|-------------|-----------------|----------|-------------|------|--------|
| 1 | **Button** | `@open-mercato/ui/primitives/button` | User action: save, create, cancel, delete | Navigation (→ `Link`), state toggle (→ `Switch`) | `default`, `destructive`, `outline`, `secondary`, `ghost`, `muted`, `link` | h-9, text-sm | Focus ring auto. Disabled = `opacity-50 pointer-events-none`. | No changes — touch target h-9 (36px) OK |
| 2 | **IconButton** | `@open-mercato/ui/primitives/icon-button` | Compact icon-only action: edit, delete, close, collapse | When action is unclear without text (→ `Button` with icon+text) | `outline`, `ghost` | size-8 (32px) | `aria-label` REQUIRED | Touch target size-8 = 32px — on mobile consider size `lg` (36px) |
| 3 | **Input** | `@open-mercato/ui/primitives/input` | Single-line text field: name, email, search | Multi-line text (→ `Textarea`), selection from list (→ `ComboboxInput`) | No CVA | h-9 | Via `<Label htmlFor>` + `aria-invalid` | No changes |
| 4 | **Textarea** | `@open-mercato/ui/primitives/textarea` | Multi-line text: description, notes, comments | Single-line (→ `Input`), rich text (→ `SwitchableMarkdownInput`) | No CVA | min-h-[80px] | Via `<Label htmlFor>` | No changes |
| 5 | **Checkbox** | `@open-mercato/ui/primitives/checkbox` | Multiple selection, boolean with deferred save (form) | Immediate toggle (→ `Switch`), single choice (→ radio) | No CVA | size-4 (16px) | Radix — built-in role/state | Touch: size-4 is small — wrap in a clickable area |
| 6 | **Switch** | `@open-mercato/ui/primitives/switch` | Immediate toggle: enable/disable, on/off | Boolean in a form with submit (→ `Checkbox`) | No CVA | h-6 w-11 | `role="switch"`, keyboard Space/Enter | h-6 (24px) — acceptable |
| 7 | **Label** | `@open-mercato/ui/primitives/label` | Label for a form field | Standalone text (→ `<span>`) | No CVA | text-sm font-medium | Radix — auto `htmlFor` linkage | No changes |
| 8 | **Card** | `@open-mercato/ui/primitives/card` | Grouping related content: settings, stats, feature | Wrapping an entire page (→ `Page`), section in detail (→ `Section`) | `CardHeader`, `CardContent`, `CardFooter`, `CardAction` | bg-card, gap-6 | Semantic `<div>` with border | No changes — padding responsive via sub-components |
| 9 | **Badge** | `@open-mercato/ui/primitives/badge` | Metadata: count, category, tag | Entity status (→ `StatusBadge`), action (→ `Button size="sm"`) | `default`, `secondary`, `destructive`, `outline`, `muted` + (new) `success`, `warning`, `info` | text-xs h-5 | Decorative — no interaction | No changes |
| 10 | **Alert** | `@open-mercato/ui/primitives/alert` | Inline message: error, success, warning, info on a page | Transient feedback (→ `flash()`), system notification (→ `NotificationBell`) | `default`, `destructive`, `success`, `warning`, `info` | p-4 text-sm | `role="alert"` auto on destructive | No changes |
| 11 | **Dialog** | `@open-mercato/ui/primitives/dialog` | Form/content requiring focus: create, edit, confirm | >10 fields (→ separate page), read-only content (→ `Popover`) | `DialogContent` with sub-components | Mobile: bottom sheet. Desktop: max-w-lg centered | Radix: focus trap, ESC close, aria-* | Bottom sheet with rounded-t-2xl, min-h-[50vh] |
| 12 | **Tooltip** | `@open-mercato/ui/primitives/tooltip` | Short helper text on hover/focus: icon explanation, truncated text | Interactive content (→ `Popover`), important info (→ show inline) | No CVA | text-xs, max-w-[280px] | Delay 300ms, ESC dismiss | Touch: no hover — consider inline text |
| 13 | **Popover** | `@open-mercato/ui/primitives/popover` | Interactive panel on click: filter, color picker, mini-form | Full form (→ `Dialog`), read-only hint (→ `Tooltip`) | No CVA | min-w-[280px] | Radix: focus trap, ESC close | No changes — positioning auto |
| 14 | **Tabs** | `@open-mercato/ui/primitives/tabs` | Switching views in one context: detail sections, settings | Navigation between pages (→ sidebar/routing), 2 options (→ `Switch`) | `TabsList`, `TabsTrigger`, `TabsContent` | h-9 trigger | `role="tablist"`, `aria-selected` | Horizontal scroll on TabsList if >4 tabs |
| 15 | **Table** | `@open-mercato/ui/primitives/table` | Simple semantic table: key-value, comparison, static data | List with sort/filter/pagination (→ `DataTable`) | `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` | text-sm, px-4 py-2 | Semantic HTML `<table>` | Horizontal scroll in overflow container |
| 16 | **Separator** | `@open-mercato/ui/primitives/separator` | Visual division between sections | Spacing (→ `space-y-*` / `gap-*`), grouping (→ `Card` / `Section`) | `horizontal` (default), `vertical` | 1px, bg-border | `role="separator"` | No changes |
| 17 | **Progress** | `@open-mercato/ui/primitives/progress` | Operation progress: upload, sync, wizard step | Indeterminate duration (→ `Spinner`) | No CVA | h-2 | `role="progressbar"`, `aria-valuenow` | No changes |
| 18 | **Spinner** | `@open-mercato/ui/primitives/spinner` | Loading indicator: data fetch, form submit, async operation | Known layout (→ Skeleton — future) | No CVA | Inherited from parent | `aria-label` or surrounding `LoadingMessage` | No changes |
| 19 | **EmptyState** | `@open-mercato/ui/backend/EmptyState` | Zero data in list/section — with CTA to create | Error (→ `ErrorMessage`), loading (→ `LoadingMessage`) | — | Centered, dashed border | Semantic: `title` + `description` readable for SR | No changes — centered layout responsive |
| 20 | **LoadingMessage** | `@open-mercato/ui/backend/detail` | Loading state in sections, tab content, detail pages | Full-page loading (→ `PageLoader`), inline in table (→ `DataTable isLoading`) | — | Spinner h-4 + text | `aria-busy` via context | No changes |
| 21 | **ErrorMessage** | `@open-mercato/ui/backend/detail` | Data loading error, not found, server error | Form validation (→ `Alert` inline + field errors) | — | `role="alert"`, `text-destructive` | Auto `role="alert"` | No changes |

### V.2 Deep Specs — Components with Issues

#### V.2.1 Button — Decision Framework [HACKATHON]

Audit (1.10): 7 variants. No guidelines for when to use which.

| Scenario | Variant | Size | Rationale |
|----------|---------|------|-----------|
| **Primary action** on a page (Save, Create, Submit) | `default` | `default` (h-9) | Primary CTA — blue background, white text. Max 1 per page section. |
| **Supporting action** (Cancel, Back, Export) | `outline` | `default` | Visible but does not compete with primary. Border without fill. |
| **Destructive action** (Delete, Remove, Revoke) | `destructive` | `default` | Red. ALWAYS with `useConfirmDialog()` — never immediate. |
| **Low-priority action** (Reset filters, Clear, Collapse) | `ghost` | `sm` (h-8) | Minimal visual weight. Visible only on hover. |
| **Inline action** (inline link-style) | `link` | `sm` | Looks like a link. For actions, not navigation (navigation = `<Link>`). |
| **Action in a muted context** (toolbar, compact list) | `muted` | `sm` | Muted bg, low contrast. Does not draw attention. |
| **Action in a peer group** (2 equivalent options) | `secondary` + `secondary` | `default` | Both grey. Neither dominates. Add an icon for differentiation. |

**Rule 1-1-N:** Max 1 `default` (primary), max 1 `destructive`, any number of `outline`/`ghost`/`muted` per visible section.

**Conflicts (2 equivalent actions):** Use `secondary` for both + differentiate with an icon. Do not create a second `default`.

#### V.2.2 Card — Unification Plan [POST-HACKATHON]

Audit (1.8): Card (primitive), PortalCard, PortalFeatureCard, PortalStatRow, card-grid in settings.

**Taxonomy — 3 variants:**

| Variant | Component | Usage | Padding | Radius |
|---------|-----------|-------|---------|--------|
| `default` | `Card` (primitive) | Backend: settings, grouped content, data sections | px-6 py-6 (via sub-components) | `rounded-xl` (border) |
| `interactive` | `Card` + `onClick`/`asChild` | Settings navigation tiles, clickable cards | px-6 py-6 + hover state | `rounded-xl` + `hover:bg-accent/50` |
| `stat` | `Card` + custom content | Dashboard widgets, KPI tiles, metric cards | p-5 sm:p-6 | `rounded-xl` |

**PortalCard: merge into Card.** PortalCard is `Card` with `p-5 sm:p-6 rounded-xl border bg-card` — identical to the primitive. Replace with Card import. PortalFeatureCard is composition: `Card` + icon grid — does not need a separate component.

**When to use Card vs Section vs another container:**

| Content | Use | Why |
|---------|-----|-----|
| Self-contained data block (address, payment info, stats) | `Card` | Has clear boundaries — border + bg-card |
| Section in a detail page (Activities, Notes, Tasks) | `Section` / `SectionHeader` | No border — it is part of the page flow |
| Entire page | `Page` + `PageBody` | Wrapper, not container |
| Form | `CrudForm` (manages its own layout) | CrudForm has its own padding and spacing |

#### V.2.3 Dialog — Decision Matrix [HACKATHON]

Audit (1.10): Dialog (Radix), ConfirmDialog (native `<dialog>`). No sizing guidelines.

| Scenario | Use | Sizing | Why |
|----------|-----|--------|-----|
| Destructive action confirmation | `useConfirmDialog()` | auto (sm) | 2 options: confirm/cancel. Minimal UI. |
| Quick create (2-5 fields: tag, note, quick task) | `Dialog` | `max-w-md` (448px) | Does not leave context. Fast turnaround. |
| Standard form (5-7 fields: create entity) | `Dialog` | `max-w-lg` (512px) — default | Focuses attention. Cmd+Enter submit. |
| Complex form (8-12 fields with groups) | `Dialog` | `max-w-xl` (576px) | On the edge — consider a separate page. |
| >12 fields or multi-step | Separate page (`create/page.tsx`) | full page | Dialog is too small. User loses context scrolling a modal. |
| Read-only detail preview | `Dialog` or `Popover` | depends on content volume | Popover: 1-2 sections. Dialog: more. |
| Bulk action confirmation | `useConfirmDialog()` with custom description | auto (sm) | "Delete 5 customers?" + consequences. |

**Mobile behavior:** All Dialog → bottom sheet (min-h-[50vh], max-h-[70vh], rounded-t-2xl). Swipe-down to dismiss is not implemented — ESC/tap outside.

**Sizing reference (from dialog.tsx):**

| Token | Tailwind | Pixel | Desktop | Mobile |
|-------|---------|-------|---------|--------|
| sm | `max-w-sm` | 384px | Confirmation, simple choice | Bottom sheet |
| md | `max-w-md` | 448px | Quick create, 2-5 fields | Bottom sheet |
| lg (default) | `max-w-lg` | 512px | Standard form, 5-7 fields | Bottom sheet |
| xl | `max-w-xl` | 576px | Complex form, 8-12 fields | Bottom sheet |

**Rule:** If a form requires scrolling inside a Dialog — move it to a separate page.

#### V.2.4 Tooltip vs Popover [HACKATHON]

| | Tooltip | Popover |
|---|---------|---------|
| **Trigger** | Hover + focus (300ms delay) | Click |
| **Content** | Text only. Max 1-2 sentences. | Anything — buttons, links, forms, images |
| **Interactivity** | None. User cannot click tooltip content. | Full. Focus trap, keyboard nav. |
| **Dismiss** | Auto (mouse leave / blur) + ESC | Click outside / ESC / explicit close |
| **Mobile** | No hover — tooltip does not work. Use inline text. | Works — tap to open, tap outside to close. |
| **Sizing** | Auto (max-w-[280px]) | min-w-[280px], no max |
| **Use when** | Icon explanation, truncated text, field hint | Filter panel, color picker, mini-form, user card |
| **Do NOT use when** | Info is critical (user MUST see it) | Full form >3 fields (→ Dialog) |

**Rule:** If information is important enough that the user must see it — do not hide it in a tooltip. Show it inline (caption text, description in FormField, helper text).

---

## See also

- [Component APIs](./component-apis.md) — API proposals (Alert, StatusBadge, FormField, etc.)
- [Components](./components.md) — MVP list with priorities
- [Foundations Gaps](./foundations-gaps.md) — motion and typography used in components
