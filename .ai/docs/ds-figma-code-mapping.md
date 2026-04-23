# Design System — Figma ↔ Code Component Mapping

Mapping between **DS Open Mercato** components in the [Figma file](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato) and existing Open Mercato code components.

**Strategy**: Figma-first adaptation — update Figma to match what already exists in code, then gradually extend both together.

**Branch**: `docs/ds-figma-code-mapping` (based on `develop`)

---

## 0. Current Code Tokens → Figma Update Spec

These are the **exact values from code** that Figma needs to reflect. Update the DS — Open Mercato Figma file to match these before making any code changes.

### Colors (oklch → convert to hex for Figma)

#### Semantic Palette (Light Mode)

| Token | oklch | Approx Hex | Usage |
|-------|-------|------------|-------|
| `--background` | `oklch(1 0 0)` | `#FFFFFF` | Page background |
| `--foreground` | `oklch(0.145 0 0)` | `#1A1A1A` | Primary text |
| `--primary` | `oklch(0.205 0 0)` | `#2B2B2B` | Primary buttons, links |
| `--primary-foreground` | `oklch(0.985 0 0)` | `#FAFAFA` | Text on primary |
| `--secondary` | `oklch(0.97 0 0)` | `#F5F5F5` | Secondary backgrounds |
| `--secondary-foreground` | `oklch(0.205 0 0)` | `#2B2B2B` | Text on secondary |
| `--muted` | `oklch(0.97 0 0)` | `#F5F5F5` | Muted backgrounds |
| `--muted-foreground` | `oklch(0.556 0 0)` | `#737373` | Muted/placeholder text |
| `--accent` | `oklch(0.97 0 0)` | `#F5F5F5` | Hover/active backgrounds |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `#DC2626` | Danger/error actions |
| `--border` | `oklch(0.922 0 0)` | `#E5E5E5` | Borders |
| `--input` | `oklch(0.922 0 0)` | `#E5E5E5` | Input borders |
| `--ring` | `oklch(0.708 0 0)` | `#A3A3A3` | Focus rings |
| `--brand-violet` | `oklch(0.55 0.2 293)` | `#7C3AED` | Brand accent |
| `--card` | `oklch(1 0 0)` | `#FFFFFF` | Card backgrounds |
| `--popover` | `oklch(1 0 0)` | `#FFFFFF` | Popover backgrounds |

#### Status Colors (Light Mode)

| Token | oklch | Approx Hex | Usage |
|-------|-------|------------|-------|
| `--status-error-bg` | `oklch(0.965 0.015 25)` | `#FEF2F2` | Error background |
| `--status-error-text` | `oklch(0.365 0.120 25)` | `#991B1B` | Error text |
| `--status-error-border` | `oklch(0.830 0.060 25)` | `#FECACA` | Error border |
| `--status-error-icon` | `oklch(0.577 0.245 27.325)` | `#DC2626` | Error icon |
| `--status-success-bg` | `oklch(0.965 0.015 160)` | `#F0FDF4` | Success background |
| `--status-success-text` | `oklch(0.350 0.080 160)` | `#166534` | Success text |
| `--status-success-border` | `oklch(0.830 0.050 160)` | `#BBF7D0` | Success border |
| `--status-success-icon` | `oklch(0.596 0.145 163.225)` | `#16A34A` | Success icon |
| `--status-warning-bg` | `oklch(0.970 0.020 80)` | `#FFFBEB` | Warning background |
| `--status-warning-text` | `oklch(0.370 0.090 60)` | `#92400E` | Warning text |
| `--status-warning-border` | `oklch(0.830 0.070 80)` | `#FDE68A` | Warning border |
| `--status-warning-icon` | `oklch(0.700 0.160 70)` | `#D97706` | Warning icon |
| `--status-info-bg` | `oklch(0.962 0.018 272)` | `#EEF2FF` | Info background (indigo-50) |
| `--status-info-text` | `oklch(0.359 0.144 279)` | `#3730A3` | Info text (indigo-800) |
| `--status-info-border` | `oklch(0.870 0.065 274)` | `#C7D2FE` | Info border (indigo-200) |
| `--status-info-icon` | `oklch(0.511 0.262 277)` | `#4F46E5` | Info icon (indigo-600, bridges to brand violet) |
| `--status-neutral-bg` | `oklch(0.965 0 0)` | `#F5F5F5` | Neutral background |
| `--status-neutral-text` | `oklch(0.445 0 0)` | `#525252` | Neutral text |
| `--status-neutral-border` | `oklch(0.850 0 0)` | `#D4D4D4` | Neutral border |
| `--status-neutral-icon` | `oklch(0.556 0 0)` | `#737373` | Neutral icon |

#### Brand Colors

Brand colors are constants — they DO NOT change between light and dark mode (brand identity must stay visually consistent).

##### Brand Gradient

| Name | Hex | Usage in code |
|------|-----|---------------|
| `brand/lime` | `#B4F372` | Start of gradient (AI dot glow, `DemoFeedbackWidget`) |
| `brand/yellow` | `#EEFB63` | Mid gradient |
| `brand/violet` | `#BC9AFF` | End gradient, AI accent |

Gradient: `linear-gradient(135deg, #B4F372 0%, #EEFB63 50%, #BC9AFF 100%)`

##### Brand Neutrals (separate from semantic tokens)

| Name | Hex | Usage |
|------|-----|-------|
| `brand/white` | `#FFFFFF` | Hero sections, marketing |
| `brand/gray-100` | `#E7E7E7` | Subtle backgrounds on brand surfaces |
| `brand/gray-500` | `#B6B6B6` | Brand dividers |
| `brand/gray-700` | `#434343` | Secondary text on brand light surfaces |
| `brand/black` | `#0C0C0C` | Hero text, pure black brand moments |

These are separate from semantic tokens — brand neutrals stay constant regardless of mode, while semantic `foreground/background/muted-foreground` adapt to light/dark.

#### Chart Colors (Light Mode)

| Token | oklch | Approx Hex |
|-------|-------|------------|
| `--chart-blue` | `oklch(0.546 0.245 262.881)` | `#2563EB` |
| `--chart-emerald` | `oklch(0.596 0.145 163.225)` | `#16A34A` |
| `--chart-amber` | `oklch(0.769 0.188 70.08)` | `#F59E0B` |
| `--chart-rose` | `oklch(0.645 0.246 16.439)` | `#E11D48` |
| `--chart-violet` | `oklch(0.606 0.25 292.717)` | `#7C3AED` |
| `--chart-cyan` | `oklch(0.715 0.143 215.221)` | `#06B6D4` |
| `--chart-indigo` | `oklch(0.511 0.262 276.966)` | `#4F46E5` |
| `--chart-pink` | `oklch(0.656 0.241 354.308)` | `#EC4899` |
| `--chart-teal` | `oklch(0.627 0.134 175.001)` | `#0D9488` |
| `--chart-orange` | `oklch(0.705 0.213 47.604)` | `#EA580C` |

### Typography

| Property | Value |
|----------|-------|
| **Font Family** | Geist Sans (system-ui fallback stack) |
| **Font Mono** | Geist Mono (ui-monospace fallback stack) |
| **Overline** | 11px / 16px line-height (custom token `--font-size-overline`) |
| **Body/Default** | Tailwind defaults: `text-sm` = 14px, `text-base` = 16px, `text-xs` = 12px |

### Radius

| Token | Value | Tailwind Class | When to Use |
|-------|-------|---------------|-------------|
| `--radius-sm` | **6px** | `rounded-sm` | Small inline elements (checkbox, tag chip) |
| `--radius-md` | **8px** | `rounded-md` | **Default** — all interactive (Button, Input, Select, Popover) |
| `--radius-lg` | **10px** | `rounded-lg` | Containers (Alert, Card, Dialog, TabsList, Section) |
| `--radius-xl` | **16px** | `rounded-xl` | Large cards, hero sections (checkout, onboarding) |
| — | **999px** | `rounded-full` | Pill shapes (Badge, Avatar, pill button) |
| — | **0px** | `rounded-none` | Reset |

Base: `--radius: 0.625rem` (10px). All tokens derived from base.

### Z-Index Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--z-base` | 0 | Default |
| `--z-sticky` | 10 | Sticky headers |
| `--z-dropdown` | 20 | Dropdown menus |
| `--z-overlay` | 30 | Overlays |
| `--z-modal` | 40 | Modals/dialogs |
| `--z-toast` | 50 | Flash messages |
| `--z-tooltip` | 60 | Tooltips |

### Figma ↔ Code Variable Mapping

The Figma file has a pre-built variable system that maps to our semantic tokens. No new variables needed for foundation colors — they already exist in `01-Tokens` with Light/Dark modes.

| Figma Variable | Code Token | Notes |
|---------------|------------|-------|
| `bg/white-0` | `--background` | Page background |
| `bg/weak-50` | `--muted`, `--accent`, `--secondary` | Subtle backgrounds |
| `bg/strong-950` | (dark `--background` via mode) | Auto-switches in dark mode |
| `text/strong-950` | `--foreground` | Primary text |
| `text/sub-600` | `--muted-foreground` | Secondary text |
| `text/soft-400` | — | Placeholder / very muted |
| `stroke/soft-200` | `--border` | Default borders |
| `stroke/sub-300` | `--input` | Input borders |
| `state/error/lighter` | `--status-error-bg` | Error background |
| `state/error/light` | `--status-error-border` | Error border |
| `state/error/base` | `--status-error-icon`, `--destructive` | Error icon / destructive action |
| `state/error/dark` | `--status-error-text` | Error text |
| `state/success/*` | `--status-success-*` | Same `{lighter,light,base,dark}` → `{bg,border,icon,text}` pattern |
| `state/warning/*` | `--status-warning-*` | Same pattern |
| `state/information/*` | `--status-info-*` | Same pattern |
| `state/faded/*` | `--status-neutral-*` | Same pattern |
| `om-brand/lime` | `#B4F372` | Brand gradient start (constant, no dark mode) |
| `om-brand/yellow` | `#EEFB63` | Brand gradient mid |
| `om-brand/violet` | `#BC9AFF` | Brand gradient end, AI accent |
| `om-brand/{white,gray-100,gray-500,gray-700,black}` | — | Brand neutrals (constant) |

Dark mode: Figma Variables automatically switch values when the mode changes — designer just toggles between Light/Dark without re-picking colors.

**Note on Figma hue names**: Figma keeps legacy names (`blue/*`, `orange/*`) but their values now match Tailwind `indigo/*` and `amber/*` respectively — this was a deliberate palette shift toward brand harmony (indigo bridges to brand violet, amber is more professional than orange for warnings).

### Shadows

Tailwind v4 built-in shadows map to Figma elevation scale:

| Tailwind Class | CSS Value | Figma Equivalent | Usage (count) |
|---------------|-----------|-----------------|---------------|
| `shadow-xs` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | X-Small | Inputs, checkboxes (33×) |
| `shadow-sm` | `0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)` | Small | Cards, panels, sections (132×) |
| `shadow-md` | `0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)` | Medium | Hover states, elevated cards (68×) |
| `shadow-lg` | `0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)` | Large | Dialogs, overlays, popovers (34×) |
| `shadow-xl` | `0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)` | X-Large | Floating panels (14×) |
| `shadow-2xl` | `0 25px 50px -12px rgb(0 0 0 / 0.25)` | 2X-Large | Command palette, modals (19×) |
| `shadow-none` | `none` | — | Reset shadow (29×) |

No custom shadow tokens needed — Tailwind v4 defaults match the design system.

### Motion & Animations

#### Transitions (Tailwind built-in)

| Property | Class | Usage (count) |
|----------|-------|---------------|
| Colors (bg, text, border) | `transition-colors` | Buttons, links, nav items (138×) |
| Opacity | `transition-opacity` | Fade in/out, hover states (47×) |
| All properties | `transition-all` | Complex state changes (25×) |
| Transform | `transition-transform` | Rotate, scale, translate (21×) |

#### Durations (Tailwind built-in)

| Class | Value | Usage |
|-------|-------|-------|
| `duration-150` | 150ms | Default for micro-interactions (30×) |
| `duration-200` | 200ms | Standard transitions (12×) |
| `duration-300` | 300ms | Larger state changes, slide-ins (11×) |

#### Easings (Tailwind built-in)

| Class | Value | Usage |
|-------|-------|-------|
| `ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Default easing (99×) |
| `ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | Enter animations (54×) |
| `ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Exit animations (19×) |

#### Keyframe Animations

| Animation | Duration | Easing | Usage |
|-----------|----------|--------|-------|
| `animate-spin` | 1s linear ∞ | linear | Loading spinners (129×) |
| `animate-pulse` | 2s ease-in-out ∞ | ease-in-out | Loading placeholders (37×) |
| `animate-in` / `animate-out` | — | — | Enter/exit (tw-animate-css) |
| `animate-slide-in` | 0.3s ease-out | ease-out | Panel slide-in (5×) |
| `animate-accordion-down/up` | — | — | Accordion expand/collapse |
| `animate-collapsible-down/up` | — | — | Collapsible sections |
| `animate-ai-*` | 1.5-3s ease-in-out ∞ | ease-in-out | AI assistant effects (pulse, glow, spin, sparkle) |

#### Figma Mapping

| Figma Motion | Code Equivalent |
|-------------|----------------|
| Fast (100ms) | `duration-100` (available, rarely used) |
| Default (150ms) | `duration-150` (primary) |
| Medium (200ms) | `duration-200` |
| Slow (300ms) | `duration-300` |
| Dissolve | `transition-opacity` + `ease-out` |
| Ease Out | `ease-out` |
| Ease In-Out | `ease-in-out` |

No custom motion tokens needed — Tailwind v4 defaults cover the full range.

### Button Variants (for Figma component)

| Variant | Background | Text | Border | Hover |
|---------|-----------|------|--------|-------|
| `default` | `--primary` (#2B2B2B) | `--primary-foreground` (#FAFAFA) | none | 90% opacity |
| `destructive` | `--destructive` (#DC2626) | white | none | 90% opacity |
| `outline` | `--background` (#FFF) | foreground | `--border` | `--accent` bg |
| `secondary` | `--secondary` (#F5F5F5) | `--secondary-foreground` | none | 80% opacity |
| `ghost` | transparent | foreground | none | `--accent` bg |
| `muted` | transparent | `--muted-foreground` | none | `--accent` bg |
| `link` | transparent | `--primary` | none | underline |

Button sizes: `sm` (32px h), `default` (36px h), `lg` (40px h), `icon` (36x36px)

### Badge Variants (for Figma component)

| Variant | Background | Text | Border |
|---------|-----------|------|--------|
| `default` | `--primary` | `--primary-foreground` | transparent |
| `secondary` | `--secondary` | `--secondary-foreground` | transparent |
| `destructive` | `--destructive` | white | transparent |
| `outline` | transparent | `--foreground` | `--border` |
| `muted` | `--muted` | `--muted-foreground` | transparent |
| `success` | `--status-success-bg` | `--status-success-text` | `--status-success-border` |
| `warning` | `--status-warning-bg` | `--status-warning-text` | `--status-warning-border` |
| `info` | `--status-info-bg` | `--status-info-text` | `--status-info-border` |
| `error` | `--status-error-bg` | `--status-error-text` | `--status-error-border` |
| `neutral` | `--status-neutral-bg` | `--status-neutral-text` | `--status-neutral-border` |

Badge shape: `rounded-full` (pill), padding: `px-2.5 py-0.5`, font: `text-xs font-semibold`

### Alert Variants (for Figma component)

| Variant | Background | Text | Border | Icon color |
|---------|-----------|------|--------|------------|
| `default` | `--background` | `--foreground` | `--border` | `--foreground` |
| `destructive` | `--status-error-bg` | `--status-error-text` | `--status-error-border` | `--status-error-icon` |
| `success` | `--status-success-bg` | `--status-success-text` | `--status-success-border` | `--status-success-icon` |
| `warning` | `--status-warning-bg` | `--status-warning-text` | `--status-warning-border` | `--status-warning-icon` |
| `info` | `--status-info-bg` | `--status-info-text` | `--status-info-border` | `--status-info-icon` |

Alert shape: `rounded-lg`, padding: `px-4 py-3`, font: `text-sm`

---

## Legend

| Status | Meaning |
|--------|---------|
| **Exists** | Code component exists, needs token alignment with Figma |
| **Partial** | Code has similar functionality but missing variants/states from Figma |
| **Gap** | No code equivalent — needs implementation |
| **N/A** | Domain-specific Figma template, not a reusable component |

## Priority

| Level | Meaning |
|-------|---------|
| **P0** | Foundation — tokens, typography, colors (must do first) |
| **P1** | Core — used on every page (Button, Input, Table, Badge, etc.) |
| **P2** | Common — used in many places (Modal, Tabs, DatePicker, etc.) |
| **P3** | Specialized — used in specific contexts (Rating, Slider, etc.) |
| **P4** | Nice-to-have — domain templates, can defer indefinitely |

---

## 1. Foundation Tokens (P0)

| Figma Token | Code Location | Status | Action |
|-------------|---------------|--------|--------|
| **Color Palette** (Primary, Gray, Blue, Green, Yellow, Red, Orange, Purple, Pink, Teal, Fuchsia, Brand) | `globals.css` — oklch CSS vars: `--primary`, `--destructive`, `--muted`, etc. | Partial | Map Figma palette to CSS custom properties. Currently using shadcn/ui semantic names. Need to add color scale (50-950) per hue. |
| **Typography** (Inter, H1-H6, Labels, Paragraphs, Subheadings) | No type scale defined. Uses Geist Sans (`--font-sans`). Tailwind defaults. | Partial | Define typography scale in CSS matching Figma: sizes, weights, letter-spacing. Switch to Inter or keep Geist + map sizes. |
| **Spacing** (0-80px scale) | Tailwind default spacing | Exists | Tailwind default 4px grid aligns well with Figma. No changes needed. |
| **Corner Radius** (0-28px + full) | `globals.css` — `--radius: 0.625rem` (10px), sm/md/lg/xl derived | Exists | 5 core tokens: sm=6px, md=8px, lg=10px, xl=14px, full=999px. Figma needs radius-14 added. |
| **Shadows** (XS/S/M/L + colored variants) | Tailwind v4 built-in: `shadow-xs`, `shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-xl`, `shadow-2xl` | Exists | Tailwind v4 shadows map directly to Figma elevation scale. See shadow mapping below. |
| **Motions** (100-500ms, Dissolve/Ease Out) | Tailwind v4 built-in transitions + `tw-animate-css` + custom keyframes in `globals.css` | Exists | Tailwind durations (`duration-150/200/300`), easings (`ease-in/out/in-out`), transitions (`transition-colors/opacity/all/transform`). Custom: `slide-in`, AI animations. See motion mapping below. |
| **Icons** | `lucide-react` (UI), standalone SVGs (brands) | Exists | Lucide for all UI icons. Brand logos as standalone SVG files (`public/brands/`). Figma has Lucide catalog + Brand Icons reference page. |

---

## 2. Component Mapping

### Inputs & Forms (P1)

| # | Figma Component | Code Component | Status | Path | Notes |
|---|----------------|----------------|--------|------|-------|
| 1 | **Text Input** | `Input` | Exists | `primitives/input.tsx` | Native `<input>`. Add Figma states (error, disabled, with icon, with helper text). Currently bare. |
| 2 | **Text Area** | `Textarea` | Exists | `primitives/textarea.tsx` | Native `<textarea>`. Same — add states. |
| 3 | **Select** | `ComboboxInput`, `LookupSelect` | Partial | `backend/inputs/ComboboxInput.tsx`, `LookupSelect.tsx` | No simple `<Select>` primitive. Figma has both simple select and combobox. Need basic Select. |
| 4 | **Checkbox** | `Checkbox` | Exists | `primitives/checkbox.tsx` | Radix-based. Align styling with Figma checkbox design. |
| 5 | **Radio** | — | Gap | — | No Radio primitive. Need Radix `@radix-ui/react-radio-group`. |
| 6 | **Switch** | `Switch` | Exists | `primitives/switch.tsx` | Custom (no Radix). Align size/colors with Figma. |
| 7 | **Slider** | — | Gap | — | No Slider primitive. Low priority (P3). |
| 8 | **Date Picker** | `DatePicker`, `DateTimePicker` | Exists | `backend/inputs/DatePicker.tsx` | Uses `Calendar` + `Popover`. Align calendar styling with Figma. |
| 9 | **Time Picker** | `TimePicker`, `TimeInput` | Exists | `backend/inputs/TimePicker.tsx` | Custom spinner. Compare with Figma time picker design. |
| 10 | **Color Picker** | — | Gap | — | No color picker. Low priority (P3) unless needed for theming UI. |
| 11 | **File Upload** | `AttachmentsSection` | Partial | `backend/detail/AttachmentsSection.tsx` | Exists as section widget, not standalone upload primitive. Figma has dedicated drag-drop upload component. |
| 12 | **Rich Editor** | `SwitchableMarkdownInput` | Partial | `backend/inputs/SwitchableMarkdownInput.tsx` | Dynamic import. Figma shows rich text editor. Compare features. |
| 13 | **Filter** | `FilterBar`, `AdvancedFilterBuilder` | Exists | `backend/FilterBar.tsx` | Align filter UI with Figma filter component pattern. |

### Actions (P1)

| # | Figma Component | Code Component | Status | Path | Notes |
|---|----------------|----------------|--------|------|-------|
| 14 | **Button** | `Button` | Exists | `primitives/button.tsx` | CVA: 7 variants, 4 sizes. Well-covered. Align colors/radius with Figma tokens. |
| 15 | **Button Group** | — | Gap | — | No ButtonGroup primitive. Figma shows grouped buttons with shared border. P2. |
| 16 | **Icon Button** | `IconButton` | Exists | `primitives/icon-button.tsx` | CVA: 2 variants, 4 sizes. Align with Figma icon button specs. |

### Data Display (P1)

| # | Figma Component | Code Component | Status | Path | Notes |
|---|----------------|----------------|--------|------|-------|
| 17 | **Table** | `Table` (primitive) + `DataTable` (TanStack) | Exists | `primitives/table.tsx`, `backend/DataTable.tsx` | Full-featured. Align cell padding, header style, row hover with Figma. |
| 18 | **Badge** | `Badge` | Exists | `primitives/badge.tsx` | CVA: 10 variants (default, secondary, destructive, outline, muted + status: success, warning, info, neutral, error). Well-covered. |
| 19 | **Tag** | `TagsInput` (input) | Partial | `backend/inputs/TagsInput.tsx` | Tags exist as input chips only. Figma has standalone `Tag` display component. Need display-only Tag. |
| 20 | **Avatar** | — | Gap | — | No Avatar component. Figma has avatar with status indicator, initials, image. **P1** — important for CRM. |
| 21 | **Key Components** | — | Gap | — | Figma "Key Components" — likely key-value pairs display. Low priority. |
| 22 | **Rating** | — | Gap | — | No rating component. P3 — specialized. |
| 23 | **Progress Bar** | `Progress` | Exists | `primitives/progress.tsx` | Custom ARIA progressbar. Align styling with Figma. |
| 24 | **Step Indicator** | — | Gap | — | No stepper component. P2 — useful for onboarding wizard. |

### Feedback (P1)

| # | Figma Component | Code Component | Status | Path | Notes |
|---|----------------|----------------|--------|------|-------|
| 25 | **Alert** | `Alert` | Exists | `primitives/alert.tsx` | CVA: 5 variants (default, destructive, success, warning, info). Good coverage. Align tokens. |
| 26 | **Banner** | — | Partial | — | No dedicated Banner. `Alert` + `Notice` partially cover this. Figma Banner is full-width page-level. |
| 27 | **Tooltip** | `Tooltip`, `SimpleTooltip` | Exists | `primitives/tooltip.tsx` | Radix-based. `SimpleTooltip` is convenience wrapper. Good coverage. |
| 28 | **Empty State** | `EmptyState` | Exists | `backend/EmptyState.tsx` | Has title, description, action, icon. Align illustration style with Figma. |
| 29 | **Notification Feed** | `NotificationPanel`, `NotificationItem`, `NotificationBell` | Exists | `backend/notifications/` | Full notification system. Align item styling with Figma. |

### Navigation (P1)

| # | Figma Component | Code Component | Status | Path | Notes |
|---|----------------|----------------|--------|------|-------|
| 30 | **Navigation** (Sidebar) | `CollapsibleNavSection`, `SectionNav`, `AppShell` | Exists | `backend/CollapsibleNavSection.tsx`, `backend/section-page/` | Full sidebar navigation. Align active/hover states with Figma. |
| 31 | **Breadcrumb** | — | Gap | — | No Breadcrumb primitive. **P1** — important for page hierarchy. |
| 32 | **Tab Menu** | `Tabs` | Exists | `primitives/tabs.tsx` | Custom context + Button-based. Align with Figma tab design. |
| 33 | **Paginations** | DataTable has built-in pagination | Partial | Inside `DataTable.tsx` | Not a standalone component. Figma has dedicated pagination. Extract if needed. |
| 34 | **Segmented Control** | — | Gap | — | No segmented control. P2 — useful for view toggling. |
| 35 | **Command Menu** | AI Assistant command palette | Partial | `ai-assistant` package | Exists for AI, not as general command palette. P3. |

### Overlays (P2)

| # | Figma Component | Code Component | Status | Path | Notes |
|---|----------------|----------------|--------|------|-------|
| 36 | **Modal** (Dialog) | `Dialog` | Exists | `primitives/dialog.tsx` | Radix-based, responsive (bottom-sheet mobile). Well-covered. |
| 37 | **Drawer** | — | Gap | — | No Drawer. Dialog has bottom-sheet but no side drawer. **P2** — useful for detail panels. |
| 38 | **Dropdown** | `RowActions`, `ActionsDropdown` | Partial | `backend/RowActions.tsx`, `backend/forms/ActionsDropdown.tsx` | Action menus exist but no generic Dropdown primitive. Needs Radix DropdownMenu. |
| 39 | **Popover** | `Popover` | Exists | `primitives/popover.tsx` | Radix-based. Good coverage. |

### Layout (P2)

| # | Figma Component | Code Component | Status | Path | Notes |
|---|----------------|----------------|--------|------|-------|
| 40 | **Page Header** | `FormHeader`, `PageHeader` | Exists | `backend/forms/FormHeader.tsx`, `backend/Page.tsx` | Two modes (edit/detail). Align layout with Figma page header. |
| 41 | **Accordion** | — | Gap | — | No Accordion. P2 — useful for settings/FAQ. Radix `@radix-ui/react-accordion`. |
| 42 | **Content Divider** | `Separator` | Exists | `primitives/separator.tsx` | Custom ARIA separator. Map to Figma content divider. |
| 43 | **Scroll** | — | Gap | — | Figma scroll component — likely custom scrollbar styling. P3. |
| 44 | **Widgets** (Dashboard) | `KpiCard`, charts, `DashboardScreen` | Exists | `backend/charts/`, `backend/dashboard/` | Dashboard widget system exists. Align card styling with Figma. |
| 45 | **Activity Feed** | `ActivitiesSection` | Exists | `backend/detail/ActivitiesSection.tsx` | Full activity feed with inline forms. Align timeline styling with Figma. |

### Auth (P2)

| # | Figma Component | Code Component | Status | Path | Notes |
|---|----------------|----------------|--------|------|-------|
| 46 | **Auth** (Login/Signup) | Auth pages in `core/modules/auth` | Exists | `core/modules/auth/frontend/` | Auth flow exists. Align form layout with Figma auth templates. |

### Domain Templates (P4 — defer)

| # | Figma Component | Status | Notes |
|---|----------------|--------|-------|
| 47 | HR templates | N/A | Domain-specific, not core DS |
| 48 | Finance templates | N/A | Reference for sales module styling |
| 49 | Marketing templates | N/A | Domain-specific |
| 50 | Crypto templates | N/A | Domain-specific |
| 51 | AI templates | N/A | Reference for AI assistant UI |

---

## 3. Gap Summary

### Must-have gaps (P1-P2)

| Component | Priority | Effort | Recommended approach |
|-----------|----------|--------|---------------------|
| **Avatar** | P1 | Small | New primitive. Radix `@radix-ui/react-avatar` or custom. Image + initials fallback + status dot. |
| **Breadcrumb** | P1 | Small | New primitive. Simple `nav > ol > li` with separator. |
| **Radio** | P1 | Small | New primitive. Radix `@radix-ui/react-radio-group`. |
| **Select** (simple) | P1 | Medium | New primitive. Radix `@radix-ui/react-select` or native `<select>` wrapper. |
| **Tag** (display) | P1 | Small | New primitive or Badge variant. Closable chip for display. |
| **Button Group** | P2 | Small | Wrapper component with shared border-radius. |
| **Drawer** | P2 | Medium | Side panel overlay. Radix dialog variant or custom. |
| **Dropdown Menu** | P2 | Medium | Radix `@radix-ui/react-dropdown-menu`. Replace custom RowActions portal. |
| **Accordion** | P2 | Small | Radix `@radix-ui/react-accordion`. |
| **Step Indicator** | P2 | Medium | Custom stepper for onboarding wizard. |
| **Segmented Control** | P2 | Small | Toggle group. Radix `@radix-ui/react-toggle-group`. |
| **Banner** | P2 | Small | Full-width Alert variant. |

### Nice-to-have gaps (P3-P4)

Slider, Color Picker, Rating, Scroll (custom scrollbar), Command Menu (generic), domain templates.

---

## 4. Implementation Roadmap

### Phase 0 — Token Foundation (current: DS v0, partially done)
- [x] Semantic status tokens (success/warning/info/error)
- [x] StatusBadge, FormField, SectionHeader components
- [ ] **Full color scale** — map Figma palette (50-950 per hue) to CSS vars
- [ ] **Typography scale** — define H1-H6, Label, Paragraph, Subheading classes
- [x] **Shadow tokens** — Tailwind v4 built-in (shadow-xs through shadow-2xl)
- [x] **Motion tokens** — Tailwind v4 built-in (duration-150/200/300, ease-in/out/in-out, tw-animate-css)
- [x] **Radius tokens** — 6 core tokens (none=0, sm=6, md=8, lg=10, xl=16, full=999)

### Phase 1 — Core Primitives Alignment
- [ ] Align `Button` variants/sizes with Figma specs
- [ ] Align `Input`/`Textarea` with Figma states (error, icon, helper)
- [ ] Align `Badge` colors with Figma status system
- [ ] Align `Table` cell styling with Figma
- [ ] Add `Avatar` primitive
- [ ] Add `Breadcrumb` primitive
- [ ] Add `Radio` primitive
- [ ] Add simple `Select` primitive

### Phase 2 — Missing Components
- [ ] Add `Dropdown Menu` (replace portal-based RowActions)
- [ ] Add `Drawer` (side panel)
- [ ] Add `Accordion`
- [ ] Add `Button Group`
- [ ] Add `Tag` (display)
- [ ] Add `Step Indicator`
- [ ] Add `Segmented Control`
- [ ] Add `Banner`

### Phase 3 — Brand Icons System
- [ ] Create `packages/ui/src/icons/brands/` directory for brand SVG files
- [ ] Create `BrandIcon` component (`<BrandIcon name="stripe" className="size-5" />`) that resolves name → SVG
- [ ] Convention: integration packages provide their brand SVG to `packages/ui/src/icons/brands/` or register it at runtime
- [ ] Figma Brand Icons page (node `2771:1469`) serves as visual catalog — each icon labeled with its `name` prop for developer lookup
- [ ] Integration `icon: 'stripe'` string resolves through `BrandIcon` in admin UI (integrations list, marketplace)

### Phase 4 — Polish & Templates
- [ ] Auth page templates aligned with Figma
- [ ] Dashboard widget styling aligned with Figma
- [ ] Activity feed timeline aligned with Figma
- [ ] Navigation active/hover states aligned with Figma
- [ ] Empty state illustrations

---

## 5. Figma Code Connect Setup

To maintain sync between Figma and code, we'll use the **Figma MCP** integration:
1. Map each implemented code component to its Figma node ID
2. Maintain this mapping in `.ai/docs/ds-code-connect-map.json`
3. DS Guardian skill validates alignment during PR review

### Component→Node mapping (to populate as we implement)

```json
{
  "button": { "figmaNodeId": "TBD", "codePath": "packages/ui/src/primitives/button.tsx" },
  "input": { "figmaNodeId": "TBD", "codePath": "packages/ui/src/primitives/input.tsx" },
  "badge": { "figmaNodeId": "TBD", "codePath": "packages/ui/src/primitives/badge.tsx" },
  "alert": { "figmaNodeId": "TBD", "codePath": "packages/ui/src/primitives/alert.tsx" }
}
```
