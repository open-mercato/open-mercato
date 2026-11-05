# U. Foundations Gaps — Motion, Type Hierarchy, Icons

> Animation specification (duration/easing/prefers-reduced-motion), type hierarchy (10 semantic roles), icon conventions (lucide-react).

---

### U.1 Motion & Animation Spec

#### Current State (from codebase audit)

The project ALREADY uses animations, but without standardization:

| Animation | Duration | Easing | Context |
|----------|----------|--------|---------|
| `slide-in` (flash messages) | 300ms | ease-out | Flash notification entry |
| `ai-pulse` / `ai-pulse-active` | 3s / 1.5s | ease-in-out | AI dot idle/active |
| `ai-glow` / `ai-glow-active` | 3s / 1.5s | ease-in-out | AI dot glow |
| `ai-spin` | 8s | linear | AI dot gradient rotation |
| Switch toggle | 200ms | default | `transition-transform` thumb slide |
| Progress bar | 300ms | ease-in-out | `transition-all` width change |
| Button/IconButton hover | default (~150ms) | default | `transition-all` |
| Dialog/Popover/Tooltip enter | tw-animate-css | — | `animate-in fade-in-0 zoom-in-95` |

**Problems:** Mix of 150ms/200ms/300ms without justification. Zero `prefers-reduced-motion` support (critical a11y gap).

#### Duration Scale [POST-HACKATHON]

| Token | CSS Variable | Value | When to use |
|-------|-------------|-------|-------------|
| `instant` | `--motion-duration-instant` | `75ms` | Hover color change, focus ring, checkbox/radio toggle |
| `fast` | `--motion-duration-fast` | `150ms` | Button hover/active, icon rotation, tooltip fade |
| `normal` | `--motion-duration-normal` | `250ms` | Switch thumb slide, popover/dropdown open, tab switch |
| `slow` | `--motion-duration-slow` | `350ms` | Dialog open/close, flash message slide-in, accordion expand |
| `decorative` | `--motion-duration-decorative` | `1000ms+` | AI pulse, progress shimmer — does not apply to UI core |

**Rule:** Direct interaction (user clicked) = `fast`/`normal`. System feedback (something appeared) = `normal`/`slow`. Decoration = `decorative`.

#### Easing Curves [POST-HACKATHON]

| Token | CSS Variable | Value | When |
|-------|-------------|-------|------|
| `default` | `--motion-ease-default` | `cubic-bezier(0.25, 0.1, 0.25, 1.0)` | General transitions (≈ ease) |
| `enter` | `--motion-ease-enter` | `cubic-bezier(0.0, 0.0, 0.2, 1.0)` | Entering elements: dialog, popover, tooltip, flash |
| `exit` | `--motion-ease-exit` | `cubic-bezier(0.4, 0.0, 1.0, 1.0)` | Exiting elements: dialog close, flash dismiss |
| `spring` | `--motion-ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1.0)` | Subtle spring effects: switch thumb, bounce badge |

#### Motion Rules

**What to animate (GPU-accelerated):**
- `transform` (translate, scale, rotate)
- `opacity`
- `filter` (blur, brightness)
- `clip-path`

**What NOT to animate (layout reflow):**
- `width`, `height`, `top`, `left`, `margin`, `padding`
- Exception: `Progress` bar animates width — acceptable because it is one-time, not repetitive

**`prefers-reduced-motion` — MANDATORY:** [HACKATHON — 15 min]

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Add to `globals.css`. Do not disable animations entirely (`0.01ms` instead of `0ms`) so that `animationend`/`transitionend` events still fire.

#### Skeleton Loaders [POST-HACKATHON]

**Decision: Skeleton vs Spinner:**

| Situation | Use | Why |
|-----------|-----|-----|
| Known layout (list, detail, form) | Skeleton | User sees the shape of upcoming content — lower perceived wait time |
| Unknown layout (first load, search results) | Spinner (`LoadingMessage`) | Cannot predict what to render |
| User action (save, delete) | Spinner in button | Feedback on click, not on layout |
| Section within a page | `InlineLoader` with DataLoader | Do not block the rest of the page |

**Skeleton spec (when implemented):**

```css
/* Shimmer animation */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.skeleton {
  background: linear-gradient(
    90deg,
    var(--muted) 25%,
    oklch(from var(--muted) calc(l + 0.05) c h) 50%,
    var(--muted) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s var(--motion-ease-default) infinite;
  border-radius: var(--radius-sm);
}
```

- Base color: `--muted` (consistent with loading states)
- Highlight: muted +5% lightness (in OKLCH — perceptually correct)
- Duration: 1.5s (longer = less aggressive, better for a11y)
- Border-radius: `--radius-sm` (rounded like the content they replace)
- Sizing: matched to content (text skeleton = h-4, avatar = h-10 w-10 rounded-full)

**Priority:** Skeleton component is [LATER]. `prefers-reduced-motion` is [HACKATHON].

---

### U.2 Prescriptive Type Hierarchy

Data from audit (sections 1.3, 1.4): 61 arbitrary sizes, h1 styled as `text-2xl font-semibold` (14 occurrences) or `text-2xl font-bold tracking-tight` (3 occurrences). h2 has 5 different styles. h3 has 5 different styles.

#### Type Scale [HACKATHON]

| Semantic role | HTML | Tailwind classes | Size | Weight | Line-height | Letter-spacing | When to use |
|--------------|------|-----------------|------|--------|-------------|---------------|-------------|
| Page title | `<h1>` | `text-2xl font-semibold tracking-tight` | 24px | 600 | `leading-tight` (1.25) | -0.025em | Page title in PageHeader. Max 1 per page. |
| Section title | `<h2>` | `text-lg font-semibold` | 18px | 600 | `leading-7` (1.75rem) | — | Section title in SectionHeader, card header. |
| Subsection title | `<h3>` | `text-base font-semibold` | 16px | 600 | `leading-6` (1.5rem) | — | Subsection within a section, tab panel header. |
| Group title | `<h4>` | `text-sm font-semibold` | 14px | 600 | `leading-5` (1.25rem) | — | Field group header in forms, settings section. |
| Body (default) | `<p>` | `text-sm` | 14px | 400 | `leading-5` (1.25rem) | — | Default text in backend. All descriptions, paragraphs, cell content. |
| Body (large) | `<p>` | `text-base` | 16px | 400 | `leading-6` (1.5rem) | — | Portal body text, hero descriptions, feature cards. |
| Caption | `<span>` | `text-xs text-muted-foreground` | 12px | 400 | `leading-4` (1rem) | — | Helper text: timestamps, metadata, helper text below fields. |
| Label | `<label>` | `text-sm font-medium` | 14px | 500 | `leading-5` (1.25rem) | — | Form labels in backend (CrudForm FieldControl). Via `<Label>` primitive. |
| Overline | `<span>` | `text-overline` | 11px | 600 | `leading-4` (1rem) | `tracking-wider` (0.05em) | Uppercase labels: entity type in FormHeader, portal field labels, category tags. |
| Code | `<code>` | `font-mono text-sm` | 14px | 400 | `leading-5` (1.25rem) | — | Code, API paths, technical values. Geist Mono. |

**CSS token to add:**

```css
/* In globals.css — the only custom typographic token */
--font-size-overline: 0.6875rem;    /* 11px */
--font-weight-overline: 600;
--letter-spacing-overline: 0.05em;
--text-transform-overline: uppercase;

/* In @theme inline */
--font-size-overline: var(--font-size-overline);
```

**Tailwind utility (in globals.css):**

```css
.text-overline {
  font-size: var(--font-size-overline);
  font-weight: var(--font-weight-overline);
  letter-spacing: var(--letter-spacing-overline);
  text-transform: var(--text-transform-overline);
  line-height: 1rem;
}
```

#### Type Hierarchy Don'ts

| Don't | Why | Use instead |
|-------|-----|-------------|
| Skip heading levels (`h1` → `h3` without `h2`) | Breaks a11y — screen reader loses structure | Always maintain sequence. If you do not need h2 — downsize h1. |
| Use heading class on non-heading (`<div className="text-2xl font-semibold">`) | Visual hierarchy ≠ semantic hierarchy. Screen reader does not see a heading. | Use `<h2>` with the correct class. |
| Mix sizes in one context (`text-lg` next to `text-xl` as peer headings) | Suggests different importance where there is none. | Same level = same size. |
| Use `font-bold` (700) in body text | Too heavy for body, conflicts with headings. | `font-medium` (500) for emphasis in body. `font-semibold` (600) for headings. |
| Use arbitrary sizes (`text-[13px]`, `text-[15px]`) | Breaks the scale, makes maintenance harder. | Map to the nearest Tailwind size (see section J mapping table). |

**Priority:** [HACKATHON] — 1 table, 15 minutes, eliminates 90% of sizing questions.

---

### U.3 Icon Usage Guidelines

Decision DR-003: lucide-react as the sole icon library. Audit: 14 files with inline SVG to migrate.

#### Sizing Convention [HACKATHON]

| Token | Tailwind | Pixel | When to use | Example |
|-------|---------|-------|-------------|---------|
| `icon.xs` | `size-3` | 12px | Badge count, notification dot, inline indicator | Badge number overlay |
| `icon.sm` | `size-3.5` | 14px | In small buttons (`size="sm"`), compact row actions, breadcrumb separator | `<ChevronRight className="size-3.5" />` in breadcrumbs |
| `icon.default` | `size-4` | 16px | **Standard — 80% of uses.** Button icon, nav item icon, table cell icon, form field icon | `<Plus className="size-4" />` in `<Button>` |
| `icon.md` | `size-5` | 20px | Standalone icon buttons (`IconButton size="default"`), section header icon, alert icon | `<AlertCircle className="size-5" />` in `<Alert>` |
| `icon.lg` | `size-6` | 24px | Empty state icon, feature card icon, page header accent | `<Package className="size-6" />` in `<EmptyState>` |
| `icon.xl` | `size-8` | 32px | Hero illustrations, onboarding steps, large empty states | Portal feature cards, wizard step icons |

Data from codebase: `size-4` (16px) dominates with 602 uses of `w-4` and 591 of `h-4`. `size-3`/`size-3.5` account for 154/72 uses. `size-5` accounts for 85 uses.

#### Stroke Width [HACKATHON]

**Decision: `strokeWidth={2}` (lucide default) — everywhere.** No exceptions.

Rationale: Audit found 19 occurrences of `strokeWidth="2"` (explicit default) and 11 occurrences of `strokeWidth="1.5"` (portal/frontend). `1.5` is legacy — thinner lines are less readable at small sizes (size-3, size-4) and inconsistent with the rest of the system. Migration: 11 changes as part of module migration.

**Do not pass `strokeWidth` in JSX** — lucide renders 2 by default. If you see explicit `strokeWidth={2}` — remove it, it is redundant.

#### Icon + Text vs Icon-Only [HACKATHON]

| Context | Icon-only allowed? | Requirements |
|---------|-------------------|--------------|
| Primary CTA (Create, Save) | NO | Always icon + text. User must know what the button does. |
| Sidebar nav items | NO (collapsed: icon-only with tooltip) | Full navigation: icon + text. Collapsed sidebar: icon + tooltip. |
| Toolbar / row actions (Edit, Delete, More) | YES | `aria-label` MANDATORY. Tooltip RECOMMENDED. |
| Close button (X in dialog/alert) | YES | `aria-label="Close"` MANDATORY. |
| Pagination (prev/next) | YES | `aria-label="Previous page"` / `aria-label="Next page"`. |
| Status indicator (dot, check) | YES (decorative) | `aria-hidden="true"` — status conveyed through text/badge, not the icon. |

**Overriding rule (see Principle 3):** If the icon is the only way to understand the action → `aria-label` is REQUIRED, not recommended. TypeScript should enforce this (prop `aria-label` required on `IconButton`).

#### Top 20 Icons in Open Mercato (from codebase grep)

| # | Icon | Imports | Context |
|---|------|---------|---------|
| 1 | `Plus` | 60 | Create actions, add to list, EmptyState CTA |
| 2 | `Trash2` | 54 | Delete actions (row, bulk, form) |
| 3 | `Loader2` | 48 | Spinner (animate-spin), loading states |
| 4 | `X` | 40 | Close (dialog, flash, panel, tag remove) |
| 5 | `ChevronDown` | 29 | Dropdown trigger, collapse, select |
| 6 | `Pencil` | 27 | Edit actions (inline, row, form) |
| 7 | `AlertTriangle` | 14 | Warning states (Alert, Notice) |
| 8 | `Check` | 13 | Success indicator, checkbox, confirm |
| 9 | `ChevronRight` | 13 | Breadcrumb separator, nav expand |
| 10 | `RefreshCw` | 12 | Reload data, sync, retry |
| 11 | `Settings` | 12 | Settings navigation, config |
| 12 | `ChevronUp` | 11 | Collapse, sort ascending |
| 13 | `Save` | 10 | Save form, persist changes |
| 14 | `AlertCircle` | 10 | Error states (ErrorMessage, Alert) |
| 15 | `Mail` | 9 | Email fields, contact, send |
| 16 | `Info` | 9 | Info tooltips, helper text |
| 17 | `CheckCircle2` | 9 | Success flash, confirmed status |
| 18 | `Calendar` | 9 | Date picker, scheduling |
| 19 | `Zap` | 8 | Automation, workflows, AI |
| 20 | `ExternalLink` | 8 | Open in new tab, external URL |

**How to find an icon:** Open [lucide.dev/icons](https://lucide.dev/icons), search by action name (e.g., "delete" → Trash2, "add" → Plus). Prefer icons from the top 20 — contributors already know them.

#### Icon Don'ts

| Don't | Why | Use instead |
|-------|-----|-------------|
| Import from another library (Heroicons, Phosphor) | Inconsistent stroke, sizing, style (see DR-003) | Always `from 'lucide-react'` |
| Inline SVG (`<svg viewBox="...">`) | Not tree-shakeable, inconsistent stroke | Find the equivalent in lucide or file a request |
| `strokeWidth={1.5}` or other custom values | Thinner lines = less readable at size-4 | Remove the prop — lucide default (2) is the standard |
| Icon outside the scale (`size-7`, `size-10`, `size-[18px]`) | Breaks the scale, inconsistent with the rest of the UI | Use the nearest size from the scale: 3, 3.5, 4, 5, 6, 8 |

---

## See also

- [Foundations](./foundations.md) — main foundations section (colors, spacing, z-index)
- [Token Values](./token-values.md) — OKLCH token values
- [Component Specs](./component-specs.md) — component specifications using these foundations
