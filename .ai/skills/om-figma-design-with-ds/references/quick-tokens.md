# Open Mercato DS — Quick Token Reference

Compressed cheat sheet for inclusion in Figma briefs. Source of truth: `.ai/ds/ds-tokens.json` (canonical snapshot generated from `apps/mercato/src/app/globals.css` by `yarn ds:tokens`; `yarn ds:tokens:check` guards drift) plus `.ai/ds-rules.md` for usage rules. Values below are hand-picked highlights — on any disagreement the snapshot wins.

## Color tokens (use ONLY these)

### Foreground / background (neutral structure)
| Use case | Token |
|---|---|
| Primary text | `text-foreground` |
| Secondary text | `text-muted-foreground` |
| Page background | `bg-background` |
| Subtle background (hover, sections) | `bg-muted`, `bg-muted/40`, `bg-muted/70` |
| Popover / dropdown surface | `bg-popover` + `text-popover-foreground` |
| Card / accent | `bg-accent` + `text-accent-foreground` |

### Borders
| Use case | Token |
|---|---|
| General divider | `border-border` |
| Form input border | `border-input` |
| Focus ring color | `shadow-focus` (use with `focus-visible:`) |

### Status (semantic — NEVER hardcode emerald/red/amber/blue)
For `error | success | warning | info | neutral`:
- Background: `bg-status-{state}-bg`
- Foreground: `text-status-{state}-text`
- Border: `border-status-{state}-border`
- Icon color: `text-status-{state}-icon`

All have dedicated dark-mode values — **never add `dark:` overrides on status tokens**.

### Brand (marketing CTAs, billing upsell, only)
| Use case | Token |
|---|---|
| Lime accent | `var(--brand-lime, #B4F372)` |
| Violet accent | `var(--brand-violet, #BC9AFF)` |
| Yellow stop (gradient middle) | `#EEFB63` (no token) |
| Marketing gradient | `linear-gradient(135deg, var(--brand-lime, #B4F372) 0%, #EEFB63 50%, var(--brand-violet, #BC9AFF) 100%)` |
| Use via | `<FancyButton intent="primary">` (preferred) — only inline gradient when FancyButton variant doesn't fit |

### Destructive (delete confirmations, error CTAs)
- `text-destructive`, `bg-destructive`, `border-destructive`
- `<Button variant="destructive">`, `<FancyButton intent="destructive">`

### Figma table hexes → code tokens (canonical DS table, node 167144:147544)

| Figma value | Code token | Note |
|---|---|---|
| Header band `#f7f7f7` | `bg-muted` | `--muted` ≈ oklch(0.97) |
| Row/frame borders `#ebebeb` | `border-border` | code ships ONE border gray (`--border` ≈ `#e4e4e4`); do not introduce a second |
| Column labels `#5c5c5c` | `text-muted-foreground` | nearest semantic role — never hardcode the hex |
| Table radius 8 | `rounded-md` | |
| Drawer width 400 | `max-w-[400px]` on `DrawerContent` | primitive default since 2026-07 |
| Drawer title 18px | `DrawerTitle` (text-lg) | primitive default since 2026-07 |

## Typography scale

| Token | Size | Use |
|---|---|---|
| `text-overline` | 11px uppercase | Section labels above headings |
| `text-xs` | 12px | Hints, descriptions, badges |
| `text-sm` | 14px | Form labels, table cells, body text in dense UI |
| `text-base` | 16px | Body text in marketing / forms |
| `text-lg` | 18px | Section headings |
| `text-xl` | 20px | Card titles, dialog titles |
| `text-2xl` | 24px | Page titles |
| `text-3xl` | 30px | Hero / marketing pages only |

**Forbidden**: `text-[13px]`, `text-[15px]`, any arbitrary size.

Font weights: `font-normal` (default), `font-medium` (labels, emphasis), `font-semibold` (headings, CTAs), `font-bold` (page titles only).

## Spacing scale (4px grid)

| Token | px | Use |
|---|---|---|
| `gap-1` / `p-1` | 4 | Tight inline (icon + 1-char text) |
| `gap-2` / `p-2` | 8 | Inline (button label + icon) |
| `gap-3` / `p-3` | 12 | Form field stacks, list items |
| `gap-4` / `p-4` | 16 | Card padding, section internals |
| `gap-6` / `p-6` | 24 | Page padding, section spacing |
| `gap-8` / `p-8` | 32 | Large dashboard cards, marketing |
| `gap-12` / `p-12` | 48 | Empty state hero spacing |

**Forbidden**: `p-[10px]`, `gap-[18px]`.

## Radius

| Token | Use |
|---|---|
| `rounded-none` | Tables, dividers |
| `rounded-sm` | Inline tags, very small chips |
| `rounded-md` | Inputs, buttons, cards (default) |
| `rounded-lg` | Larger cards, panels |
| `rounded-xl` | Modals, prominent containers |
| `rounded-2xl` | Hero panels (rare) |
| `rounded-full` | Avatars, pills, status dots |

**Forbidden**: `rounded-[14px]` etc.

## Z-index tokens

| Token | Value | Use |
|---|---|---|
| `z-base` | 0 | Default content |
| `z-sticky` | 10 | Sticky headers, table headers |
| `z-dropdown` | 20 | Select / Combobox / Menu popover |
| `z-overlay` | 30 | Drawer / sheet backdrop |
| `z-modal` | 40 | Dialog content |
| `z-toast` | 50 | Flash messages |
| `z-tooltip` | 60 | Tooltips on hover |
| `z-banner` | 70 | Floating CTAs (e.g. demo feedback button), site banners |
| `z-top` | 100 | AI chat overlay, dev tools, command palette |

**Forbidden**: `z-[60]`, `z-[9999]`, any numeric arbitrary z-index.

## Shadows

| Token | Use |
|---|---|
| `shadow-xs` | Form fields default |
| `shadow-sm` | Cards, popovers (subtle) |
| `shadow-md` | Dropdowns, hover-lift cards |
| `shadow-lg` | Modal default |
| `shadow-xl` | Floating CTA buttons (FancyButton on hover) |
| `shadow-2xl` | Marketing hero, command palette |
| `shadow-focus` | Focus ring (apply via `focus-visible:shadow-focus`) |

## Icon sizing

| Use case | Class |
|---|---|
| Inside text input (left/right icon) | `size-4` (16px) |
| Inline with button label | `size-4` |
| Icon-only button (default) | `size-4` |
| Icon-only button (sm) | `size-3.5` |
| Toolbar standalone icon | `size-5` (20px) |
| Section heading icon | `size-5` or `size-6` |
| Empty state hero icon | `size-12` to `size-16` |
| Onboarding hero icon | `size-20` |

Always `lucide-react`. Never inline `<svg>`. Never emojis in chrome UI (allowed in user-generated content like comments).

## Form field heights

| Size | Class | Use |
|---|---|---|
| sm | `h-8` | Compact toolbars, FilterBar inputs |
| default | `h-9` | Standard form inputs (Input, Select, Button) |
| lg | `h-10` | Marketing pages, prominent CTAs |

Same row of buttons MUST share size — never mix sm + default.
