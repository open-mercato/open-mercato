# Part 3 — Foundations

> Tokens, scales, and foundational guidelines: colors, typography, spacing, z-index, border-radius, breakpoints, icons.

---

## 3.1 Color System

### What it covers
A full color system covering: palette, semantic tokens, status colors, surface colors, interactive colors, chart colors.

### Why it's needed
Eliminates 372 hardcoded colors. Enables dark mode. Centralizes color decisions.

### Decisions to make
- Keep OKLCH? (YES — already implemented, modern, good)
- How many status colors? (4: error, success, warning, info)
- Add a "neutral" status? (e.g. draft, archived)
- How to map to Tailwind utilities?

### Architectural decision: Flat tokens, NOT opacity-based

**Use flat tokens** — a separate CSS custom property per role (bg, text, border, icon) with the full color value. Each token has a separate value for light and dark mode.

```
YES:  --status-error-bg: oklch(0.965 0.015 25);     /* full value, controlled contrast */
      .dark { --status-error-bg: oklch(0.220 0.025 25); }

NO:   --status-error: oklch(0.577 0.245 27);         /* one base color */
      bg-status-error/5                                /* opacity in Tailwind */
```

**Why:** Opacity-based tokens (`bg-status-error/5`) do not control contrast in dark mode. `oklch(0.577 0.245 27) / 5%` on a white background gives a subtle pink, but on a black background is nearly invisible. Flat tokens give full control over contrast in both modes.

**Naming convention:**
- CSS variable: `--status-{status}-{role}` e.g. `--status-error-bg`
- Tailwind class: `{property}-status-{status}-{role}` e.g. `bg-status-error-bg`, `text-status-error-text`
- Tailwind mapping: `--color-status-{status}-{role}: var(--status-{status}-{role})`

### Current state
Good: `--primary`, `--secondary`, `--destructive`, `--muted`, `--accent`, `--card`, `--popover`, `--border`, chart colors.
Missing: semantic status tokens, surface hierarchy, interactive state tokens.

### Tokens to define

```
// Primitive palette (already exists in OKLCH)
color.primary.DEFAULT / foreground
color.secondary.DEFAULT / foreground
color.destructive.DEFAULT / foreground
color.muted.DEFAULT / foreground
color.accent.DEFAULT / foreground

// Semantic status (MISSING — critical)
color.status.error.bg / text / border / icon
color.status.success.bg / text / border / icon
color.status.warning.bg / text / border / icon
color.status.info.bg / text / border / icon
color.status.neutral.bg / text / border / icon

// Surface hierarchy (partially exists)
color.surface.page          // --background
color.surface.card          // --card
color.surface.popover       // --popover
color.surface.sidebar       // --sidebar
color.surface.overlay       // bg-black/50

// Interactive (partially in CVA)
color.interactive.focus      // --ring
color.interactive.hover      // computed
color.interactive.disabled   // opacity-50

// Border
color.border.default         // --border
color.border.input           // --input
color.border.focus           // --ring
```

### Errors without this layer
- 372 hardcoded colors — every contributor "guesses" which color to use
- Dark mode broken for semantic colors
- Changing the palette requires grep+replace across the entire codebase

### MVP: **YES** — semantic status tokens (eliminates 80% of the problem)
### Later: palette refinement, surface hierarchy documentation

---

## 3.2 Typography

### What it covers
Font family, size scale, weight scale, line height, letter spacing, text style tokens.

### Why it's needed
Eliminates 61 arbitrary text sizes. Provides a clear visual hierarchy.

### Decisions to make
- How many heading levels? (4-6)
- How many body sizes? (2-3: default, small, large)
- What special styles? (caption, label, overline, code)
- Keep Geist Sans/Mono? (YES — already implemented)

### Tokens to define

```
// Font family (exists)
font.sans           // Geist Sans
font.mono           // Geist Mono

// Size scale (mapping to Tailwind)
text.display        // text-4xl (36px) — hero, landing
text.heading.1      // text-2xl (24px) — page titles
text.heading.2      // text-xl (20px) — section titles
text.heading.3      // text-lg (18px) — subsections
text.heading.4      // text-base font-semibold (16px) — card titles
text.body.default   // text-sm (14px) — primary body
text.body.large     // text-base (16px) — emphasized body
text.caption        // text-xs (12px) — secondary info
text.label          // text-xs font-medium uppercase tracking-wider — form labels, overlines
text.overline       // text-[11px] font-semibold uppercase tracking-wider — section labels (alias for existing pattern)
text.code           // text-sm font-mono — code blocks

// Weight
font.weight.regular    // 400
font.weight.medium     // 500
font.weight.semibold   // 600
font.weight.bold       // 700

// Line height
leading.tight       // 1.25 — headings
leading.normal      // 1.5 — body
leading.relaxed     // 1.75 — long text

// Letter spacing
tracking.tight      // -0.01em — headings
tracking.normal     // 0 — body
tracking.wide       // 0.05em — labels, overlines
```

### Errors without this layer
- `text-[11px]` vs `text-xs` vs `text-[12px]` — 3 ways to express "small text"
- 3 different letter-spacing variants for uppercase labels
- No hierarchy = every contributor picks a size "by eye"

### MVP: **YES** — size scale + text style tokens
### Later: line height fine-tuning, responsive typography

---

## 3.3 Spacing Scale

### What it covers
Spacing grid, gap/padding/margin scale, breakpoints.

### Why it's needed
Standardizes spacing. Eliminates "why gap-3 here but gap-4 there?".

### Decisions to make
- What base? (4px = Tailwind default version)
- Which values are "official"?
- How to document "which spacing when"?

### Tokens to define

```
// Spacing scale (Tailwind defaults, but with naming)
space.0      // 0px
space.0.5    // 2px — micro spacing (icon-to-text)
space.1      // 4px — tight spacing (between related elements)
space.1.5    // 6px — between form label and input
space.2      // 8px — default gap between related items
space.3      // 12px — gap between form fields
space.4      // 16px — gap between sections
space.6      // 24px — page section spacing
space.8      // 32px — major section breaks

// Semantic spacing (aliases)
space.inline.xs     // space.1 — tight inline gap
space.inline.sm     // space.2 — default inline gap
space.inline.md     // space.3 — comfortable inline gap
space.stack.xs      // space.1 — tight vertical gap
space.stack.sm      // space.2 — default vertical gap
space.stack.md      // space.3 — form field gap
space.stack.lg      // space.4 — section gap
space.stack.xl      // space.6 — page section gap
space.inset.sm      // space.2 — compact padding
space.inset.md      // space.3 — default padding
space.inset.lg      // space.4 — comfortable padding
space.inset.xl      // space.6 — spacious padding

// Page layout
space.page.gutter    // space.6 (Page component: space-y-6)
space.page.body      // space.4 (PageBody component: space-y-4)
space.page.section   // space.4
```

### Usage guidelines
- `gap-2` (8px): default gap between related elements (buttons, badges, inline items)
- `gap-3` (12px): gap between form fields
- `gap-4` (16px): gap between sections on a page
- `gap-6` (24px): gap between major page sections
- **Do NOT use** `gap-5`, `gap-7` — these values are not in the official scale

### MVP: **YES** — usage guidelines document + lint rules
### Later: Semantic spacing tokens as CSS variables

---

## 3.4 Border Radius

### What it covers
Border radii for different contexts.

### Tokens to define

```
// Already exist in globals.css:
radius.sm      // 0.25rem — small inputs, tags
radius.md      // 0.375rem — buttons, inputs, badges
radius.lg      // 0.625rem — cards, alerts, containers
radius.xl      // 1.025rem — modals, portal cards
radius.full    // 9999px — avatars, pills, circular buttons
radius.none    // 0 — tables, embedded elements
```

### Usage guidelines
- `rounded-sm`: tags, small tokens
- `rounded-md`: buttons, inputs, badges, small elements
- `rounded-lg`: cards, alerts, containers
- `rounded-xl`: modals, portal cards, large containers
- `rounded-full`: avatars, pills, status dots
- `rounded-none`: tables, elements embedded in a container

### MVP: **YES** — documentation only (tokens already exist)
### Later: enforcement via lint

---

## 3.5 Borders

### What it covers
Width, style, border colors.

### Tokens to define

```
border.width.default    // 1px
border.width.thick      // 2px — focus ring, active tab
border.color.default    // --border
border.color.input      // --input
border.color.focus      // --ring
border.color.error      // color.status.error.border
border.color.success    // color.status.success.border
border.style.default    // solid
border.style.dashed     // dashed — empty states, drop zones
```

### MVP: **YES** — as part of color tokens
### Later: separate tokens

---

## 3.6 Elevation / Shadows

### What it covers
Shadow and layer system for depth perception.

### Tokens to define

```
shadow.none         // none — flat elements
shadow.sm           // subtle — cards at rest
shadow.md           // moderate — dropdowns, popovers
shadow.lg           // strong — modals, overlays
shadow.inner        // inset — pressed states, inputs
```

### Z-index scale

```
z.base          // 0 — page content
z.sticky        // 10 — sticky headers, progress bar
z.dropdown      // 20 — dropdown menus, popovers
z.overlay       // 30 — mobile sidebar overlay
z.modal         // 40 — dialog/modal
z.toast         // 50 — flash messages, toasts
z.tooltip       // 60 — tooltips (always on top)
```

### MVP: **YES** — z-index scale (prevents conflicts)
### Later: shadow tokens

---

## 3.7 Iconography

### What it covers
Icon library, sizing, stroke width, usage patterns.

### Current state
- **Official library:** `lucide-react` (v0.556.0) in root package.json
- **Problem:** Portal and some modules use custom inline SVG with different stroke widths (1.5 vs 2) and sizing (size-4 vs size-5)

### Decisions to make
- Standardize on lucide-react everywhere
- One stroke width (2px — lucide default)
- One sizing system

### Tokens to define

```
icon.size.xs      // size-3 (12px) — inline, badge icons
icon.size.sm      // size-4 (16px) — default icon size
icon.size.md      // size-5 (20px) — prominent icons
icon.size.lg      // size-6 (24px) — hero icons, empty states
icon.size.xl      // size-8 (32px) — feature icons
icon.stroke       // 2 (lucide default)
```

### MVP: **YES** — standardize on lucide-react, remove inline SVG
### Later: custom icon set if needed

---

## 3.8 Motion / Animation

### What it covers
Timing, easing, transition patterns.

### Current state
- AI-specific animations in globals.css (pulse, glow, sparkle)
- Flash message: `slide-in` 300ms ease-out
- Dialog: Radix animations (fade-in/out, slide-in/out)
- No defined timing scale

### Tokens to define

```
motion.duration.instant    // 0ms — immediate state change
motion.duration.fast       // 100ms — micro interactions (hover, focus)
motion.duration.normal     // 200ms — standard transitions
motion.duration.slow       // 300ms — complex animations (modals, drawers)
motion.duration.slower     // 500ms — page transitions

motion.easing.default      // ease-out
motion.easing.spring       // cubic-bezier(0.34, 1.56, 0.64, 1) — bouncy
motion.easing.smooth       // ease-in-out
```

### MVP: **NO** — current animations are sufficient
### Later: standardize duration/easing tokens

---

## 3.9 Interaction States

### What it covers
Hover, focus, active, disabled, selected, loading states.

### Tokens to define

```
state.hover.opacity        // used for bg-opacity changes
state.disabled.opacity     // 0.5
state.focus.ring.width     // 3px
state.focus.ring.color     // --ring
state.focus.ring.offset    // 0
state.selected.bg          // bg-accent
state.loading.opacity      // 0.7
```

### MVP: **NO** — CVA already handles states in buttons
### Later: centralize in tokens

---

## 3.10 Accessibility Foundations

### What it covers
Focus management, color contrast, screen reader support, reduced motion, touch targets.

### Decisions to make
- WCAG level: AA (minimum) or AAA?
- Minimum touch target: 44x44px
- Focus visible strategy
- Reduced motion support

### Tokens / rules

```
a11y.focus.visible          // focus-visible:ring-[3px] focus-visible:ring-ring/50
a11y.touch.target.min       // 44px
a11y.contrast.min           // 4.5:1 (AA for normal text)
a11y.contrast.large.min     // 3:1 (AA for large text)
a11y.motion.reduced         // prefers-reduced-motion: reduce
```

### MVP: **YES** — required aria-label on IconButton (TypeScript), skip-to-content link
### Later: automated contrast checking, WCAG AAA

---

## 3.11 Content Foundations

### What it covers
Tone of voice, microcopy patterns, error message guidelines.

### Decisions to make
- Formal vs informal tone?
- Technical vs user-friendly error messages?
- Max length for button labels?
- Empty state copy patterns?

### Guidelines

```
// Error messages
"Could not save changes. Please try again."      // GOOD
"Error 500: Internal Server Error"                // BAD

// Empty states
"No customers yet"                                // Title
"Create your first customer to get started."      // Description
"Add customer"                                    // Action

// Button labels
"Save"                                            // GOOD (short, clear)
"Click here to save your changes"                 // BAD (too long)
"Submit"                                          // OK (generic)
"Save customer"                                   // BETTER (contextual)

// Confirmation dialogs
"Delete this customer?"                           // Title
"This action cannot be undone."                   // Description
"Delete" / "Cancel"                               // Actions
```

### MVP: **NO** — this is content work
### Later: content style guide

---

## Foundations — implementation order

```
1. Color System (semantic status tokens)     <- eliminates 372 hardcoded colors
   |
2. Typography Scale                          <- eliminates 61 arbitrary sizes
   |
3. Spacing Scale (documentation)             <- standardizes 793+ spacing decisions
   |
4. Border Radius (documentation)             <- tokens already exist, need documentation
   |
5. Iconography (lucide-react standard)       <- eliminates custom inline SVG
   |
6. Z-index / Elevation                       <- prevents layering conflicts
   |
7. Accessibility Foundations                 <- TypeScript enforcement
   |
8. Motion                                    <- can be deferred
   |
9. Content Foundations                       <- can be deferred
```

**Dependencies:**
- Typography depends on spacing (line height)
- Border/Elevation depends on Color System
- Iconography is independent
- Accessibility is cross-cutting — applies to everything

**Hackathon MVP:**
1. Semantic color tokens (CSS variables + Tailwind mapping)
2. Typography scale (Tailwind config + documentation)
3. Spacing guidelines (documentation)
4. Z-index scale (CSS variables)
5. Border radius guidelines (documentation)

---

## See also

- [Foundations Gaps — Motion, Type, Icons](./foundations-gaps.md) — supplement: animations, typography hierarchy, icons
- [Token Values](./token-values.md) — concrete OKLCH values
- [Audit](./audit.md) — audit data from which foundations derive
- [Migration Tables](./migration-tables.md) — color and typography migration tables
