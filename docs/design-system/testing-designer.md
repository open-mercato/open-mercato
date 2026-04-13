# X. Visual Testing + Designer Workflow

> 3-tier visual testing strategy + code-first designer workflow (no Figma requirement).

---

### X.1 Visual Regression Testing Strategy

#### Tier 1 — Hackathon: Manual Screenshot Protocol [HACKATHON]

Zero tools. Systematic manual workflow.

**When:** Every PR migrating a module to DS tokens (section J codemod) MUST include before/after screenshots.

**Which screens to screenshot per module migration:**

| # | Screen | Viewport | Theme | File name |
|---|--------|----------|-------|-----------|
| 1 | List (page.tsx) | Desktop 1440px | Light | `{module}-list-light.png` |
| 2 | List (page.tsx) | Desktop 1440px | Dark | `{module}-list-dark.png` |
| 3 | Detail ([id]/page.tsx) | Desktop 1440px | Light | `{module}-detail-light.png` |
| 4 | Detail ([id]/page.tsx) | Desktop 1440px | Dark | `{module}-detail-dark.png` |
| 5 | Create (create/page.tsx) | Desktop 1440px | Light | `{module}-create-light.png` |
| 6 | Create (create/page.tsx) | Desktop 1440px | Dark | `{module}-create-dark.png` |
| 7 | List — empty state | Desktop 1440px | Light | `{module}-empty-light.png` |
| 8 | List — empty state | Desktop 1440px | Dark | `{module}-empty-dark.png` |

**Where:** In the PR description as inline images. Reviewer sees them immediately — no need to run the project.

**PR description template:**

```markdown
## Visual Verification

### Before (develop branch)
| Light | Dark |
|-------|------|
| ![list-light-before] | ![list-dark-before] |
| ![detail-light-before] | ![detail-dark-before] |

### After (this PR)
| Light | Dark |
|-------|------|
| ![list-light-after] | ![list-dark-after] |
| ![detail-light-after] | ![detail-dark-after] |

### Checklist
- [ ] All status badges use StatusBadge/semantic tokens
- [ ] Dark mode: no invisible text, no white patches
- [ ] Empty state present and styled
- [ ] Loading state present
```

#### Tier 2 — Weeks 2-4: Playwright Screenshot Tests [POST-HACKATHON]

The project already uses Playwright (`yarn test:integration`). Add screenshot comparison.

**Setup:**

```typescript
// tests/visual/ds-regression.spec.ts
import { test, expect } from '@playwright/test'

const DS_PAGES = [
  { path: '/backend/customers/companies', name: 'customers-list' },
  { path: '/backend/customers/companies/create', name: 'customers-create' },
  { path: '/backend/sales/orders', name: 'sales-orders-list' },
  // ... top 10 pages by traffic/importance
]

for (const page of DS_PAGES) {
  for (const theme of ['light', 'dark'] as const) {
    test(`visual: ${page.name} (${theme})`, async ({ page: pw }) => {
      // Set theme
      await pw.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light' })
      await pw.goto(page.path)
      await pw.waitForLoadState('networkidle')

      // Screenshot comparison
      await expect(pw).toHaveScreenshot(`${page.name}-${theme}.png`, {
        maxDiffPixelRatio: 0.01, // 1% pixel diff = failure
        threshold: 0.2,          // per-pixel color threshold
      })
    })
  }
}
```

**Top 10 screens for automated testing:**

| # | Screen | Why |
|---|--------|-----|
| 1 | Customers list | Reference module — if it breaks here, it is broken everywhere |
| 2 | Customers detail | Most complex detail page — tabs, sections, statuses |
| 3 | Customers create | Reference form with CrudForm |
| 4 | Sales orders list | Many statuses (draft/confirmed/shipped/paid) |
| 5 | Auth login | Portal entry — first impression |
| 6 | Portal landing | Customer-facing — must be flawless |
| 7 | Dashboard | Widget grid — regression-prone |
| 8 | Settings page | Card grid navigation — many cards |
| 9 | Catalog products list | Large table, filters, status badges |
| 10 | Empty state (any) | Verify EmptyState rendering |

**Threshold:** `maxDiffPixelRatio: 0.01` (1%). Subpixel rendering differences between OS → 0.2 per-pixel threshold. If too flaky — raise to 0.02.

**Baseline update:** `npx playwright test --update-snapshots` after an intentional visual change. Commit new baseline screenshots with the PR.

#### Tier 3 — Month 2+: Component Showcase [LATER]

**Decision: NOT Storybook. Component showcase page in the product.**

Rationale: Storybook requires a separate build pipeline, config sync with Tailwind v4, duplicate imports, ongoing maintenance. Open Mercato is a monorepo with 1 app — it does not need a separate dev environment. Instead: `/dev/components` page (dev mode only) rendering all primitives with variants.

**Showcase page scope:**
- Render every primitive from V.1 in all variants
- Light + dark mode toggle
- Responsive preview (mobile/tablet/desktop)
- Copy-paste import path per component
- Does not require a separate build — part of the app dev server

**Implementation:** New dev-only module (not registered in production builds):
```
packages/core/src/modules/dev_tools/
  backend/components/page.tsx  → /backend/dev-tools/components
```

### X.2 Component Testing Checklist [POST-HACKATHON]

#### Per-component test requirements

| Category | Tests | Mandatory? |
|----------|-------|-----------|
| **Render** | Renders without crash for every variant | YES |
| **CSS classes** | Correct Tailwind classes per variant (snapshot or assertion) | YES |
| **States** | Default, hover, focus, disabled, error, loading (if applicable) | YES |
| **Props** | Required props → error without them. Optional → sensible defaults. | YES |
| **A11y** | `axe-core` scan passes. Keyboard nav works (Tab, Enter, ESC). | YES |
| **Dark mode** | Renders with `.dark` class — no hardcoded colors | RECOMMENDED |
| **Mobile** | Does not break layout at 375px viewport | RECOMMENDED |

#### Test Template — StatusBadge (reference)

```typescript
// packages/ui/src/primitives/__tests__/status-badge.test.tsx
import { render, screen } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { StatusBadge } from '../status-badge'

expect.extend(toHaveNoViolations)

describe('StatusBadge', () => {
  const variants = ['success', 'warning', 'error', 'info', 'neutral'] as const

  // Render: all variants without crash
  it.each(variants)('renders variant "%s" without crash', (variant) => {
    const { container } = render(
      <StatusBadge variant={variant}>Active</StatusBadge>,
    )
    expect(container.firstChild).toBeTruthy()
  })

  // CSS: correct classes per variant
  it('applies correct semantic token classes for success variant', () => {
    render(<StatusBadge variant="success">Active</StatusBadge>)
    const badge = screen.getByText('Active')
    expect(badge.className).toContain('bg-status-success-bg')
    expect(badge.className).toContain('text-status-success-text')
    expect(badge.className).toContain('border-status-success-border')
  })

  // Props: children rendered
  it('renders children text', () => {
    render(<StatusBadge variant="info">Pending review</StatusBadge>)
    expect(screen.getByText('Pending review')).toBeInTheDocument()
  })

  // Props: dot indicator
  it('renders dot indicator when dot prop is true', () => {
    const { container } = render(
      <StatusBadge variant="success" dot>Active</StatusBadge>,
    )
    // Dot is a span with rounded-full and bg matching the variant
    const dot = container.querySelector('[data-slot="status-dot"]')
    expect(dot).toBeTruthy()
  })

  // A11y: axe scan
  it('has no accessibility violations', async () => {
    const { container } = render(
      <StatusBadge variant="error">Failed</StatusBadge>,
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  // Dark mode: no hardcoded colors
  it('does not contain hardcoded color classes', () => {
    const { container } = render(
      <StatusBadge variant="error">Error</StatusBadge>,
    )
    const html = container.innerHTML
    expect(html).not.toMatch(/text-red-|bg-red-|text-green-|bg-green-|text-blue-|bg-blue-/)
  })

  // Default variant fallback
  it('renders neutral variant as default when variant not recognized', () => {
    // @ts-expect-error — testing runtime fallback
    render(<StatusBadge variant="unknown">Test</StatusBadge>)
    expect(screen.getByText('Test')).toBeInTheDocument()
  })
})
```

**Rule:** Every new DS component (FormField, StatusBadge, SectionHeader) MUST have tests before merge. Existing primitives (Button, Card, Dialog) — add tests incrementally when making changes.

### X.3 Designer Workflow — Design-in-Code [POST-HACKATHON]

**Decision: Code-first. No Figma.**

Rationale: Open Mercato is OSS without a dedicated designer. Contributors are developers. Creating a Figma library for a designer who does not exist is waste. If a designer joins — code is the source of truth, not Figma.

#### Design-in-Code Manifesto

Design in Open Mercato happens in code:

- **Tokens** live in `globals.css` (OKLCH custom properties) — not in Figma variables
- **Components** live in `packages/ui/src/primitives/` (TSX + CVA) — not in a Figma library
- **Layout** is defined by page templates (section K.1) — not by Figma frames
- **Prototyping** = `yarn dev` + editing the component — not a Figma prototype

**You do not need Figma to contribute to the UI.** All you need is:
1. Copy a template from K.1
2. Use components from V.1
3. Run `yarn dev` and iterate in the browser

#### If Someone WANTS to Use Figma

Table of tokens for manual transfer (no plugin — manual sync, once per release):

**Colors (light mode):**

| Token | OKLCH Value | Hex (approximate) | Figma color name |
|-------|-------------|-------------------|-----------------|
| `--background` | `oklch(1 0 0)` | `#FFFFFF` | `surface/background` |
| `--foreground` | `oklch(0.145 0 0)` | `#1A1A1A` | `text/primary` |
| `--primary` | value from globals.css | — | `interactive/primary` |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `#DC2626~` | `status/error` |
| `--status-success-bg` | `oklch(0.965 0.015 163)` | `#F0FDF4~` | `status/success/bg` |
| `--status-success-text` | `oklch(0.365 0.120 163)` | `#166534~` | `status/success/text` |
| ... | (full table in section I) | ... | ... |

**Typography:**

| Role | Font | Size | Weight | Figma text style |
|------|------|------|--------|-----------------|
| Page title | Geist Sans | 24px | Semibold (600) | `heading/h1` |
| Section title | Geist Sans | 18px | Semibold (600) | `heading/h2` |
| Body | Geist Sans | 14px | Regular (400) | `body/default` |
| Caption | Geist Sans | 12px | Regular (400) | `body/caption` |
| Overline | Geist Sans | 11px | Semibold (600), UPPERCASE | `label/overline` |
| Code | Geist Mono | 14px | Regular (400) | `code/default` |

**Spacing:** Tailwind scale: 4px (1), 8px (2), 12px (3), 16px (4), 24px (6), 32px (8). In Figma: auto layout with these values.

**Sync schedule:** After every release tagged with `[DS]` in RELEASE_NOTES.md — manual update of Figma variables. Responsibility: the person who wants Figma, not the DS lead.

---

*End of supplement U-X. Sections A-X constitute the complete Design System Audit & Foundation Plan covering: audit (1), principles (2), foundations (3, U), components (4, V), patterns (K, W), usage rules (W.1, W.2, U.2, U.3), documentation (O, M, R), implementation (I, J, L, X), governance (N, P, Q, S, T).*

---

## See also

- [Lint Rules](./lint-rules.md) — automated tests in CI
- [Metrics](./metrics.md) — visual quality metrics
- [Contributor Experience](./contributor-experience.md) — contributor workflow
- [Foundations Gaps](./foundations-gaps.md) — motion spec tested visually
