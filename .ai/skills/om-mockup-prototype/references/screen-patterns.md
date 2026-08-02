# Backend screen anatomy for prototypes

These structures come from the real backend components under `packages/ui/src/backend/`, using `customers` as the reference module. Copy them instead of guessing. A prototype that differs from production layout misleads reviewers.

The template implements these structures in `components.css` and `screens.css`. This reference explains the important details and common mistakes.

## Application shell — `AppShell.tsx`

```text
grid lg:grid-cols-[240px_1fr]   (collapsed: [80px_1fr])
├── aside   border-r py-4 px-3
└── div     flex min-h-svh flex-col
    ├── header  61px sticky border-b bg-background/95 backdrop-blur px-3 sm:px-4 lg:px-6 py-3
    ├── main    flex-1 p-4 lg:p-6 mx-auto w-full max-w-screen-2xl
    └── footer  border-t px-4 py-3 flex justify-end gap-4
```

Four easy mistakes:

1. Breadcrumbs belong in the top bar, not the page body. `PageHeader` does not contain them; `ApplyBreadcrumb` or the route manifest supplies them. The first item is a home icon linking to `/backend`.
2. The active-navigation rail extends outside the padding. Its span uses `absolute left-[-12px] top-2 w-1 h-5 rounded-r bg-foreground`, while the container uses `-ml-3 pl-3`.
3. A navigation-group heading uses `text-xs font-medium uppercase tracking-wider text-muted-foreground/70`, not `text-overline`.
4. The sidebar has its own `h-9` SearchInput below the logo, independent of global search in the top bar.

The logo is a 40×40 `rounded-full` mark plus the name inside `p-3 rounded-xl hover:bg-muted`.

Top-bar right-side order: status badges → injected actions → AI dot → global search → organization switcher → integrations → settings → messages → bell → profile.

## Page scaffolding — `Page.tsx`

```text
Page       → div.space-y-6
PageHeader → flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between
             h1.text-xl.sm:text-2xl.font-semibold.leading-tight
             p.text-sm.text-muted-foreground.mt-1
             div.flex.flex-wrap.items-center.gap-2
PageBody   → div.space-y-4
```

The page title uses `font-semibold`, not `font-bold`.

## DataTable list layout

On list pages, the title and primary action belong in the table-card header rather than `PageHeader`.

```text
div.rounded-lg.border.bg-card
├── div.px-4.py-3.border-b
│   ├── flex sm:items-center sm:justify-between
│   │   ├── h2.text-base.font-semibold
│   │   └── flex.gap-2
│   └── div.mt-3.pt-3.border-t
│       ├── SearchInput (w-72 / w-80) + filters + view switcher
│       └── selection count + bulk actions
├── div.px-4.py-2.border-b
├── table
└── div.px-4.py-3.border-t
```

Table details from `primitives/table.tsx`:

- `thead` uses `bg-muted/40`.
- `th` uses `px-4 py-2 text-left font-medium text-muted-foreground whitespace-nowrap`.
- `td` uses `px-4 py-2`.
- Rows use `border-b last:border-b-0` and `bg-muted/30` on hover.
- The selection column is `w-8`; the action column is `w-0 text-right`.
- Checkboxes use `--accent-indigo`, not `--primary`.

Pagination copy follows “Showing 1 to 25 of 312 results” with `tabular-nums`. Page buttons use `size-8 rounded-lg`, the active page uses `bg-muted`, and the page-size select sits on the right.

DataTable bulk actions stay inline in the toolbar. The floating dark action bar belongs to the pipeline pattern, not DataTable.

## CrudForm

```text
form
└── div.grid.grid-cols-1.lg:grid-cols-[7fr_3fr].gap-4
    ├── div.space-y-3
    └── div.space-y-3
```

A group card uses `rounded-lg border bg-card px-4 py-3 space-y-3`; its title uses `text-sm font-medium`.

In edit mode, `FormHeader` puts Back and the title on the left and actions on the right.

Footer order is fixed: additional actions → Delete → Cancel → Save. Save is a submit button with a Save icon; while saving, use `Loader2 animate-spin` and “Saving…”. Delete uses `destructive-outline`, not full `destructive`.

## Kanban — deals-pipeline pattern

Source: `customers/backend/customers/deals/pipeline/components/`.

```text
div.flex.flex-none.flex-col.gap-3
├── div.rounded-lg.bg-muted/40.px-4.py-3.5
│   ├── div.h-1.5.w-full.rounded-sm
│   └── flex.justify-between
│       ├── NAME (text-sm font-bold uppercase) + count badge
│       └── stage total (text-sm font-bold)
├── button
└── div.min-h-[40vh].rounded-lg.p-1.5
```

A card uses `rounded-lg border bg-card px-4 py-3.5 shadow-xs`; its title uses `text-base font-semibold line-clamp-2`. Chips use `rounded-md px-2.5 py-1 text-xs font-semibold` with `status-*` tokens. Quick actions may reveal on hover, but must remain visible for touch and keyboard focus.

The pipeline bulk-action bar uses `fixed bottom-6 left-1/2 -translate-x-1/2 bg-foreground text-background rounded-lg shadow-xl`.

## Tokens and scale

| Control | Height |
|---|---|
| Default button | `h-9 px-4 py-2` (`px-3` with an icon) |
| Small button | `h-8 px-3` |
| Icon button | `size-9` |
| Input / SearchInput | `h-9 px-3` |
| Top bar | 61px |

Radius base: `--radius: 0.625rem`, producing 6px small, 8px medium, 10px large, and 16px extra-large radii.

Use semantic colors only. Express statuses with `status-{error|success|warning|info|neutral|pink}-{bg|text|border|icon}`, never hardcoded Tailwind shades. Use `chart-*` tokens for charts. Do not add `dark:` overrides because the semantic tokens already switch themes.

Full rules: `.ai/ds-rules.md`; component reference: `.ai/ui-components.md`.

## Deliberate prototype differences

Static HTML has two deliberate differences from production:

- Icons use an embedded Lucide SVG sprite rather than `lucide-react` imports.
- Text is hardcoded rather than passed through `useT()`.

Both patterns are forbidden in production code. Record the differences in the generated README so nobody treats prototype markup as implementation guidance.
