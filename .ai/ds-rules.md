# Design System Rules

> Referenced from root `AGENTS.md`. Also see `packages/ui/AGENTS.md` for component-level usage (Avatar, Tag, Kbd, Button, CrudForm, DataTable, etc.).

## Colors
- NEVER use hardcoded Tailwind colors for status semantics (`text-red-*`, `bg-green-*`, `text-emerald-*`, `bg-blue-*`, `text-amber-*`, etc.)
- NEVER use hardcoded hex/rgb values in className — always use semantic tokens
- All semantic tokens have dedicated dark mode values — NO `dark:` overrides needed

Decision tree — ask "what color do I need?":

| Question | Answer | Token |
|----------|--------|-------|
| Is it a status indicator (error/success/warning/info/neutral)? | Yes → | `{property}-status-{status}-{role}` (e.g. `text-status-error-text`, `bg-status-success-bg`, `border-status-warning-border`) |
| Is it a destructive action button? | Yes → | `text-destructive`, `bg-destructive` |
| Is it primary text? | Yes → | `text-foreground` |
| Is it secondary/placeholder text? | Yes → | `text-muted-foreground` |
| Is it a primary action (button, link)? | Yes → | `bg-primary`, `text-primary-foreground` |
| Is it a subtle background (hover, accent)? | Yes → | `bg-secondary`, `bg-accent`, `bg-muted` |
| Is it a border? | Yes → | `border-border`, `border-input` |
| Is it a focus ring? | Yes → | `ring-ring` |
| Is it a card/popover surface? | Yes → | `bg-card`, `bg-popover` |
| Is it a chart/data visualization? | Yes → | `chart-blue`, `chart-emerald`, `chart-amber`, etc. |
| Is it brand accent? | Yes → | `brand-violet` |

Status token structure: `{property}-status-{status}-{role}` where status = `error`|`success`|`warning`|`info`|`neutral` and role = `bg`|`text`|`border`|`icon`.

## Brand Colors

Brand colors express identity and are **separate from semantic tokens**. Semantic tokens drive 99% of the UI — brand colors are reserved for brand moments.

| Token | Hex |
|-------|-----|
| Brand Lime | `#D4F372` |
| Brand Yellow | `#EEFB63` |
| Brand Violet | `#BC9AFF` |
| Brand Black | `#0C0C0C` |
| Brand Gray 700 | `#434343` |
| Brand Gray 500 | `#B6B6B6` |
| Brand Gray 100 | `#E7E7E7` |
| Brand White | `#FFFFFF` |

Brand colors do NOT flip in dark mode.

#### When to use brand colors

| Use case | Token |
|----------|-------|
| **AI / intelligence touchpoints** (buttons, dots, chips marking AI features) | `brand-violet` |
| **Custom views / perspectives pills** (user-created views saved by user) | `brand-violet` (10% bg, 30% border, 100% text) |
| **Floating feedback / onboarding widgets** | Full gradient (`#D4F372 → #EEFB63 → #BC9AFF`) |
| **Hero sections on marketing / landing pages** | Full gradient OR Brand Lime as standalone hero bg |
| **Loading / progress for AI operations** | `brand-violet` or gradient stroke |
| **Splash / onboarding / success celebration moments** | Full gradient |

Decision tree — ask "is this a brand moment?":

| Question | Answer | Token |
|----------|--------|-------|
| Is it flagging AI functionality or AI-generated content? | Yes → | `brand-violet` |
| Is it a user-saved view / perspective / custom entity pill? | Yes → | `brand-violet` (10% bg, 30% border, 100% text) |
| Is it a landing page hero, marketing banner, or splash screen? | Yes → | Full gradient `from-[#D4F372] via-[#EEFB63] to-[#BC9AFF]` |
| Is it a floating CTA widget (feedback, onboarding invite, celebration)? | Yes → | Full gradient |
| Is it a standard UI element in the backend admin (button, input, card, table)? | **No brand** → | Use semantic tokens |
| Is it a status indicator (error/success/warning/info)? | **No brand** → | Use status tokens |

```tsx
// Brand violet — semantic CSS token
<div className="text-brand-violet" />
<div className="bg-brand-violet/10 border-brand-violet/30 text-brand-violet" />

// Brand gradient — inline style (floating widgets and hero sections only)
<div style={{ background: 'linear-gradient(135deg, #D4F372 0%, #EEFB63 50%, #BC9AFF 100%)' }} />
```

## Corner Radius
- NEVER use arbitrary radius values (`rounded-[24px]`, `rounded-[32px]`, etc.)
- NEVER use `rounded-2xl` or `rounded-3xl` — use `rounded-xl` (16px) for large radius

| What am I rounding? | Token |
|---------------------|-------|
| Pill / badge / avatar / toggle | `rounded-full` |
| Large standalone card, hero section, full-page panel | `rounded-xl` (16px) |
| Container holding other elements (card, dialog, alert, tabs) | `rounded-lg` (10px) |
| Interactive element (button, input, select, popover, dropdown) | `rounded-md` (8px) |
| Tiny inline element (checkbox, color dot, small chip) | `rounded-sm` (6px) |
| Remove radius (table cells, flush edges) | `rounded-none` |

## Typography
- NEVER use arbitrary text sizes (`text-[10px]`, `text-[11px]`, `text-[13px]`, `text-[15px]`)
- NEVER use arbitrary tracking — use `tracking-widest` (0.1em) for uppercase labels
- USE Tailwind scale: `text-xs` (12px), `text-sm` (14px), `text-base` (16px), `text-lg` (18px), `text-xl` (20px), `text-2xl` (24px)
- For 11px uppercase labels: use `text-overline` (custom token)
- Exception: `text-[9px]` for notification badge count (single use case, documented)

| What text am I styling? | Classes |
|--------------------------|---------|
| Main page title (one per page) | `text-2xl font-bold tracking-tight` |
| Major section heading | `text-xl font-semibold` |
| Subsection / card title | `text-sm font-semibold` |
| Form label | `text-sm font-medium` (use `Label` component) |
| Default body text | `text-sm` |
| Emphasized body text | `text-base` |
| Secondary info, timestamps, hints | `text-xs text-muted-foreground` |
| Section label / category tag (uppercase) | `text-overline font-semibold uppercase tracking-widest` |
| Code / technical content | `text-sm font-mono` |

## Feedback
- USE `Alert` for inline messages — NOT `Notice` (deprecated)
- USE `flash()` for transient toast messages
- USE `useConfirmDialog()` for destructive action confirmation
- Every list/data page MUST handle empty state via `<EmptyState>` or `emptyState` prop on DataTable
- Every async page MUST show loading state via `<LoadingMessage>`, `<Spinner>`, or `<DataLoader>`
- Alert variants: `default`, `destructive` (error), `success`, `warning`, `info`

## Spacing
- NEVER use arbitrary spacing values (`p-[13px]`, `gap-[10px]`, `mt-[7px]`, etc.)
- USE Tailwind 4px grid scale: `1` (4px), `2` (8px), `3` (12px), `4` (16px), `6` (24px), `8` (32px), `12` (48px)
- AVOID half-steps (`0.5`, `1.5`, `2.5`) unless matching a specific visual rhythm

| What am I spacing? | Classes |
|---------------------|---------|
| Icon-to-text gap, chip internals, tight inline flex | `gap-1` (4px) or `gap-2` (8px) |
| Standard gap between inline/flex items | `gap-2` (8px) — **default** |
| Gap between distinct items in a list (cards, sections) | `gap-3` (12px) or `gap-4` (16px) |
| Padding inside an interactive control (button, input, select) | `px-3 py-2` |
| Padding inside a compact container (tag, inline panel, row) | `p-3` (12px) |
| Padding inside a card, section, or alert | `p-4` (16px) — **default for containers** |
| Padding inside a dialog, large card, or feature panel | `p-6` (24px) |
| Vertical stack of related items (form fields, list rows) | `space-y-2` (8px) |
| Vertical stack of distinct sections on a page | `space-y-4` (16px) or `space-y-6` (24px) |
| Page-level section separation | `space-y-8` (32px) or `py-8` |
| Margin below heading / above content | `mb-2` inline, `mb-4` sections |

## Opacity & Transparency
- NEVER invent new opacity values ad hoc — stick to the DS scale
- NEVER use arbitrary opacity (`opacity-[0.33]`, `bg-black/[0.22]`)
- USE the standard values: `5`, `10`, `20`, `30`, `50`, `70`, `80`, `90`, `95`, `100`

| What am I making transparent and why? | Value |
|---------------------------------------|-------|
| Disabled state on any control | `disabled:opacity-50` |
| Hover dim effect | `hover:opacity-80` |
| Restore full opacity | `opacity-100` |
| Hidden but layout-preserving | `opacity-0` |
| Modal / centered dialog backdrop | `bg-black/50` |
| Drawer / side panel backdrop | `bg-black/20` |
| Frosted surface (sticky header, floating card) | `bg-background/80` |
| Nearly-opaque surface | `bg-background/95` |
| Subtle tint (muted background, zebra row) | `bg-muted/30` |
| Medium tint (hover/selected list row) | `bg-muted/50` |
| Very subtle highlight (selected primary/destructive) | `bg-primary/5` or `bg-destructive/5` |
| Soft highlight (active primary/destructive) | `bg-primary/10` or `bg-destructive/10` |
| Hover on primary/destructive button | `bg-primary/90` or `bg-destructive/90` |
| Softened border | `border-border/70` |

## Z-Index (Layering)
- NEVER use arbitrary z-index values (`z-[1000]`, `z-[9999]`, `z-[60]`, etc.)
- NEVER use numeric `z-10`/`z-20`/`z-40`/`z-50` for elements that overlap **other components** — use semantic tokens
- Numeric `z-*` is OK **only** for local stacking inside a single component

| What is this element? | Token | Value |
|-----------------------|-------|-------|
| Normal page content | no class / `z-base` | 0 |
| Sticky header/footer | `z-sticky` | 10 |
| Dropdown, popover, combobox, select menu | `z-dropdown` | 20 |
| Backdrop behind modal/drawer | `z-overlay` | 30 |
| Modal, dialog, drawer, side panel | `z-modal` | 40 |
| Toast / flash message | `z-toast` | 50 |
| Tooltip | `z-tooltip` | 60 |
| Global notice bar (cookie banner, system-wide) | `z-banner` | 70 |
| Always-on-top (dev tools, AI chat, command palette) | `z-top` | 100 |

Tooltip sits above modals (60 > 40) because you may hover a button inside a modal. Tokens defined in `globals.css` as `--z-index-*`. Do NOT add new numeric values — add a token to the scale.

## Shadows
- NEVER use arbitrary shadow values (`shadow-[...]`)
- NEVER use colored shadows (e.g. `shadow-violet-500/25`) except for brand-specific decorative elements (AI dot)

| What elevation does this element need? | Token |
|----------------------------------------|-------|
| Flat element with subtle depth (input, checkbox, button) | `shadow-xs` |
| Card, panel, or section on a page | `shadow-sm` |
| Hover state or slightly elevated card | `shadow-md` |
| Dialog, overlay, or popover | `shadow-lg` |
| Floating panel (dockable chat, side drawer) | `shadow-xl` |
| Top-level modal or command palette | `shadow-2xl` |
| Remove shadow | `shadow-none` |

## Motion & Transitions
- NEVER use arbitrary duration values (`duration-[250ms]`, etc.)
- NEVER use `transition` without specifying the property — prefer `transition-colors`, `transition-opacity`, `transition-transform` over `transition-all`
- USE `transition-all` only when multiple unrelated properties change simultaneously

| What is animating? | Classes |
|--------------------|---------|
| Hover color/background change | `transition-colors duration-150` |
| Fade in/out | `transition-opacity duration-150` |
| Rotation or scale (chevron, icon) | `transition-transform duration-150` |
| Dropdown/popover opening | `duration-200 ease-out` |
| Dialog/modal opening | `duration-300 ease-out` |
| Dialog/modal closing | `duration-200 ease-in` |
| Loading spinner | `animate-spin` |
| Loading placeholder | `animate-pulse` |
| Panel sliding in | `animate-slide-in` (0.3s ease-out) |
| Accordion/collapsible | `animate-accordion-down` / `animate-accordion-up` |

Duration: **150ms** for micro-interactions, **200ms** for standard transitions, **300ms** for large layout changes.

## Status Display
- USE `StatusBadge` for entity status display — NEVER hardcode colors on Badge
- Define a `StatusMap` per entity type in your module:
```typescript
import type { StatusMap } from '@open-mercato/ui/primitives/status-badge'

const dealStatusMap: StatusMap<'open' | 'won' | 'lost'> = {
  open: 'info',
  won: 'success',
  lost: 'error',
}
```

## Forms
- USE `FormField` wrapper for standalone forms (portal, auth, custom pages)
- CrudForm handles field layout internally — do NOT wrap CrudForm fields in FormField
- Every input MUST have a visible label (never placeholder-only)
- Error messages use `text-status-error-text` (FormField handles this automatically)

## Icons
- USE `lucide-react` for ALL UI icons — NEVER inline `<svg>` elements
- Icon sizes: `size-3` (12px), `size-4` (16px, default), `size-5` (20px), `size-6` (24px)
- Stroke width: 2 (lucide default) — do NOT override per-instance
- Icon-only buttons MUST have `aria-label`
- Brand/logo icons (Stripe, Google, etc.) = standalone SVG files in `public/brands/` or integration-provided assets

## Sections
- USE `SectionHeader` for detail page section headers (title + count + action)
- USE `CollapsibleSection` when section content should be collapsible

## Components — quick reference
| I need to… | Use this |
|---|---|
| Show an error/success/warning message inline | `<Alert variant="destructive\|success\|warning\|info">` |
| Show a toast notification | `flash('message', 'success\|error\|warning\|info')` |
| Confirm a destructive action | `useConfirmDialog()` |
| Display entity status (active, draft, etc.) | `<StatusBadge variant={statusMap[status]} dot>` |
| Display a user-applied entity tag | `<Tag variant={tagMap[tag.type]} dot>` |
| Display a user / entity avatar with initials | `<Avatar name="Jan Kowalski" size="default">` |
| Display multiple avatars overlapping | `<AvatarStack max={4}><Avatar .../></AvatarStack>` |
| Show a keyboard shortcut hint | `<KbdShortcut keys={['⌘', 'Enter']}>` |
| Wrap a form field with label + error | `<FormField label="..." error={...}>` |
| Build a section header with count + action | `<SectionHeader title="..." count={n} action={...}>` |
| Build a collapsible section | `<CollapsibleSection title="...">content</CollapsibleSection>` |

## Reference Implementation
When building a new module UI, use the **customers module** as reference:
- List page: `packages/core/src/modules/customers/backend/customers/people/page.tsx`
- Detail page: `packages/core/src/modules/customers/backend/customers/people/[id]/page.tsx`
- Create page: `packages/core/src/modules/customers/backend/customers/people/create/page.tsx`
- Status mapping: `packages/core/src/modules/customers/components/formConfig.tsx`

## Breakpoints (Responsive Design)
- NEVER use arbitrary media queries (`[min-width:850px]:...`) — stick to the Tailwind scale
- NEVER use `max-*` (desktop-first) — our approach is **mobile-first**
- USE the Tailwind scale: `sm` (640px), `md` (768px), `lg` (1024px), `xl` (1280px), `2xl` (1536px)

| At what screen size should this layout change? | Breakpoint |
|------------------------------------------------|------------|
| Stacked buttons/labels → inline row | `sm:flex-row sm:items-center` |
| Form field full-width → half-width side-by-side | `md:grid-cols-2` |
| Dashboard 1-col → 2-col layout | `md:grid-cols-2` (not `sm:`) |
| 2-col → 3-col dashboard | `lg:grid-cols-3` |
| Sidebar collapse → always-visible | `lg:grid-cols-[240px_1fr]` |
| 4th column for dense dashboards | `xl:grid-cols-4` |
| Constrain max content width | `max-w-screen-2xl mx-auto` |
| Show/hide based on device | `hidden lg:block` or `lg:hidden` |

`md:` is the first breakpoint for layout changes. Backend sidebar collapses at `lg:` (1024px) — mobile drawer is shown below that.

## Borders (Widths & Styles)
- NEVER use arbitrary border widths (`border-[3px]`, `border-[1.5px]`)
- USE the Tailwind scale: `border` (1px), `border-2` (2px), `border-4` (4px), `border-0` (reset)
- Always pair border width with a semantic color token (`border-border`, `border-input`, `border-status-*-border`, `border-destructive`)
- NEVER use hardcoded Tailwind shades (`border-gray-300`, `border-slate-200`, `border-blue-500`)

| What is this border for? | Classes |
|--------------------------|---------|
| Standard container edge (card, input, dialog, divider) | `border border-border` — **default** |
| Input/form control edge | `border border-input` |
| Active tab indicator (bottom underline) | `border-b-2 border-primary` |
| Selected / active state emphasis | `border-2 border-primary` or `border-2 border-ring` |
| Left-accent indicator (notices, status highlights) | `border-l-4 border-status-{status}-border` |
| Empty state / placeholder / drop zone | `border border-dashed border-border` |
| Horizontal divider between sections | `border-t border-border` (use `<Separator>` when possible) |
| Error state on input | `aria-invalid:border-destructive` |
| Remove border | `border-0` |

## Focus States (Accessibility)
- NEVER use `focus:` for rings/outline — use `focus-visible:` (rings appear on keyboard nav only)
- NEVER use hardcoded focus colors (`focus-visible:ring-blue-500`, etc.)
- USE the `--ring` token via `focus-visible:ring-ring`
- USE `aria-invalid:` for error state rings

Standard focus recipe:
```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
```

| What focus treatment? | Classes |
|-----------------------|---------|
| Button / Input / Select / standard form control | Already handled by the primitive |
| Custom focusable element (div with tabIndex, link, interactive row) | `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` |
| Tight layout where offset-2 overflows | `focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0` |
| Error state needing red focus ring | Add `aria-invalid:ring-destructive aria-invalid:ring-2` |
| Menu item / dropdown item | `focus:bg-accent focus:text-accent-foreground` (without `-visible`) |
| Disable focus ring | `focus-visible:ring-0` (rare — accessibility concern) |

Ring on `focus-visible:` for keyboard accessibility; bg/text on `focus:` for visual affordance.

## Dark Mode
- NEVER add `dark:` overrides on semantic tokens (`text-foreground`, `bg-muted`, `bg-card`, etc.) — they already flip
- NEVER add `dark:` overrides on status tokens (`bg-status-*`, etc.) — they have dedicated dark values
- NEVER pair hardcoded Tailwind status colors with `dark:` fallbacks (e.g. `bg-amber-50 dark:bg-amber-950/40`)

Legitimate `dark:` use cases:
- `dark:prose-invert` — Tailwind Typography plugin (content module)
- shadcn primitives that touch `--input` directly — part of component internals
- Brand/decorative colors that genuinely need different dark values (violet AI dot, rare cases)

If you find yourself writing `dark:{something}`, first check whether a semantic token already handles that context.

## Boy Scout Rule
When modifying a file that contains hardcoded status colors (`text-red-*`, `bg-green-*`, etc.), arbitrary text sizes (`text-[11px]`), or `dark:` overrides on status colors, you MUST migrate at minimum the lines you touched to semantic tokens.

