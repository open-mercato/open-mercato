# X. Visual Testing + Designer Workflow

> 3-tier visual testing strategy + code-first designer workflow (no Figma requirement).

---

### X.1 Visual Regression Testing Strategy

#### Tier 1 — Hackathon: Manual Screenshot Protocol [HACKATHON]

Zero narzędzi. Systematyczny manual workflow.

**Kiedy:** Każdy PR migrujący moduł do DS tokens (sekcja J codemod) MUSI zawierać before/after screenshoty.

**Jakie ekrany screenshotować per module migration:**

| # | Ekran | Viewport | Theme | Nazwa pliku |
|---|-------|----------|-------|-------------|
| 1 | Lista (page.tsx) | Desktop 1440px | Light | `{module}-list-light.png` |
| 2 | Lista (page.tsx) | Desktop 1440px | Dark | `{module}-list-dark.png` |
| 3 | Detail ([id]/page.tsx) | Desktop 1440px | Light | `{module}-detail-light.png` |
| 4 | Detail ([id]/page.tsx) | Desktop 1440px | Dark | `{module}-detail-dark.png` |
| 5 | Create (create/page.tsx) | Desktop 1440px | Light | `{module}-create-light.png` |
| 6 | Create (create/page.tsx) | Desktop 1440px | Dark | `{module}-create-dark.png` |
| 7 | Lista — empty state | Desktop 1440px | Light | `{module}-empty-light.png` |
| 8 | Lista — empty state | Desktop 1440px | Dark | `{module}-empty-dark.png` |

**Gdzie:** W PR description jako inline images. Reviewer widzi je od razu — nie musi uruchamiać projektu.

**Template PR description:**

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

#### Tier 2 — Tydzień 2-4: Playwright Screenshot Tests [POST-HACKATHON]

Projekt już używa Playwright (`yarn test:integration`). Dodajemy screenshot comparison.

**Setup:**

```typescript
// tests/visual/ds-regression.spec.ts
import { test, expect } from '@playwright/test'

const DS_PAGES = [
  { path: '/backend/customers/companies', name: 'customers-list' },
  { path: '/backend/customers/companies/create', name: 'customers-create' },
  { path: '/backend/sales/orders', name: 'sales-orders-list' },
  // ... top 10 stron po traffic/importance
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

**Top 10 ekranów do automatycznego testowania:**

| # | Ekran | Dlaczego |
|---|-------|---------|
| 1 | Customers list | Referencyjny moduł — jeśli tu się zepsuje, popsute jest wszędzie |
| 2 | Customers detail | Najzłożniejszy detail page — taby, sekcje, statusy |
| 3 | Customers create | Referencyjny formularz z CrudForm |
| 4 | Sales orders list | Dużo statusów (draft/confirmed/shipped/paid) |
| 5 | Auth login | Portal entry — first impression |
| 6 | Portal landing | Customer-facing — musi być perfekcyjne |
| 7 | Dashboard | Widget grid — regression-prone |
| 8 | Settings page | Card grid navigation — wiele kart |
| 9 | Catalog products list | Duża tabela, filtry, status badges |
| 10 | Empty state (any) | Weryfikacja EmptyState rendering |

**Threshold:** `maxDiffPixelRatio: 0.01` (1%). Subpixel rendering differences między OS → 0.2 per-pixel threshold. Jeśli zbyt flaky — podnieś do 0.02.

**Baseline update:** `npx playwright test --update-snapshots` po świadomej zmianie wizualnej. Commit nowych baseline screenshots z PR.

#### Tier 3 — Miesiąc 2+: Component Showcase [LATER]

**Decyzja: NIE Storybook. Component showcase page w produkcie.**

Uzasadnienie: Storybook wymaga osobnego build pipeline, config sync z Tailwind v4, duplicate imports, ongoing maintenance. Open Mercato jest monorepo z 1 apką — nie potrzebuje osobnego dev environment. Zamiast tego: `/dev/components` page (tylko w dev mode) renderująca wszystkie primitives z wariantami.

**Scope showcase page:**
- Renderuje każdy primitive z V.1 w wszystkich wariantach
- Light + dark mode toggle
- Responsive preview (mobile/tablet/desktop)
- Copy-paste import path per komponent
- Nie wymaga osobnego build — jest częścią app dev server

**Implementacja:** Nowy moduł dev-only (nie rejestrowany w production builds):
```
packages/core/src/modules/dev_tools/
  backend/components/page.tsx  → /backend/dev-tools/components
```

### X.2 Component Testing Checklist [POST-HACKATHON]

#### Per-component test requirements

| Kategoria | Testy | Obowiązkowe? |
|-----------|-------|-------------|
| **Render** | Renderuje bez crash dla każdego wariantu | ✅ TAK |
| **CSS classes** | Poprawne Tailwind classes per wariant (snapshot lub assertion) | ✅ TAK |
| **States** | Default, hover, focus, disabled, error, loading (jeśli dotyczy) | ✅ TAK |
| **Props** | Required props → error bez nich. Optional → sensowne defaults. | ✅ TAK |
| **A11y** | `axe-core` scan przechodzi. Keyboard nav działa (Tab, Enter, ESC). | ✅ TAK |
| **Dark mode** | Renderuje z `.dark` class — brak hardcoded colors | ⚠️ ZALECANE |
| **Mobile** | Nie łamie layoutu w 375px viewport | ⚠️ ZALECANE |

#### Test Template — StatusBadge (referencja)

```typescript
// packages/ui/src/primitives/__tests__/status-badge.test.tsx
import { render, screen } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { StatusBadge } from '../status-badge'

expect.extend(toHaveNoViolations)

describe('StatusBadge', () => {
  const variants = ['success', 'warning', 'error', 'info', 'neutral'] as const

  // Render: wszystkie warianty bez crash
  it.each(variants)('renders variant "%s" without crash', (variant) => {
    const { container } = render(
      <StatusBadge variant={variant}>Active</StatusBadge>,
    )
    expect(container.firstChild).toBeTruthy()
  })

  // CSS: poprawne klasy per wariant
  it('applies correct semantic token classes for success variant', () => {
    render(<StatusBadge variant="success">Active</StatusBadge>)
    const badge = screen.getByText('Active')
    expect(badge.className).toContain('bg-status-success-bg')
    expect(badge.className).toContain('text-status-success-text')
    expect(badge.className).toContain('border-status-success-border')
  })

  // Props: children renderowane
  it('renders children text', () => {
    render(<StatusBadge variant="info">Pending review</StatusBadge>)
    expect(screen.getByText('Pending review')).toBeInTheDocument()
  })

  // Props: dot indicator
  it('renders dot indicator when dot prop is true', () => {
    const { container } = render(
      <StatusBadge variant="success" dot>Active</StatusBadge>,
    )
    // Dot jest span z rounded-full i bg odpowiadający wariantowi
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

  // Dark mode: brak hardcoded colors
  it('does not contain hardcoded color classes', () => {
    const { container } = render(
      <StatusBadge variant="error">Error</StatusBadge>,
    )
    const html = container.innerHTML
    expect(html).not.toMatch(/text-red-|bg-red-|text-green-|bg-green-|text-blue-|bg-blue-/)
  })

  // Default variant fallback
  it('renders neutral variant as default when variant not recognized', () => {
    // @ts-expect-error — testujemy runtime fallback
    render(<StatusBadge variant="unknown">Test</StatusBadge>)
    expect(screen.getByText('Test')).toBeInTheDocument()
  })
})
```

**Zasada:** Każdy nowy komponent DS (FormField, StatusBadge, SectionHeader) MUSI mieć testy przed merge. Istniejące primitives (Button, Card, Dialog) — testy dodawane inkrementalnie przy okazji zmian.

### X.3 Designer Workflow — Design-in-Code [POST-HACKATHON]

**Decyzja: Code-first. Bez Figma.**

Uzasadnienie: Open Mercato jest OSS bez dedykowanego designera. Contributorzy to developerzy. Tworzenie Figma library dla designera, którego nie ma, to waste. Jeśli designer dołączy — code jest źródłem prawdy, nie Figma.

#### Design-in-Code Manifesto

Design w Open Mercato odbywa się w kodzie:

- **Tokeny** żyją w `globals.css` (OKLCH custom properties) — nie w Figma variables
- **Komponenty** żyją w `packages/ui/src/primitives/` (TSX + CVA) — nie w Figma library
- **Layout** definiowany przez page templates (sekcja K.1) — nie przez Figma frames
- **Prototypowanie** = `yarn dev` + edycja komponentu — nie Figma prototype

**Nie potrzebujesz Figma żeby contributnąć do UI.** Wystarczy:
1. Skopiować template z K.1
2. Używać komponentów z V.1
3. Uruchomić `yarn dev` i iterować w przeglądarce

#### Jeśli ktoś CHCE użyć Figma

Tabela tokenów do ręcznego przeniesienia (nie plugin — manual sync, raz na release):

**Kolory (light mode):**

| Token | Wartość OKLCH | Hex (przybliżony) | Figma color name |
|-------|-------------|-------------------|-----------------|
| `--background` | `oklch(1 0 0)` | `#FFFFFF` | `surface/background` |
| `--foreground` | `oklch(0.145 0 0)` | `#1A1A1A` | `text/primary` |
| `--primary` | wartość z globals.css | — | `interactive/primary` |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `#DC2626~` | `status/error` |
| `--status-success-bg` | `oklch(0.965 0.015 163)` | `#F0FDF4~` | `status/success/bg` |
| `--status-success-text` | `oklch(0.365 0.120 163)` | `#166534~` | `status/success/text` |
| ... | (pełna tabela w sekcji I) | ... | ... |

**Typografia:**

| Role | Font | Size | Weight | Figma text style |
|------|------|------|--------|-----------------|
| Page title | Geist Sans | 24px | Semibold (600) | `heading/h1` |
| Section title | Geist Sans | 18px | Semibold (600) | `heading/h2` |
| Body | Geist Sans | 14px | Regular (400) | `body/default` |
| Caption | Geist Sans | 12px | Regular (400) | `body/caption` |
| Overline | Geist Sans | 11px | Semibold (600), UPPERCASE | `label/overline` |
| Code | Geist Mono | 14px | Regular (400) | `code/default` |

**Spacing:** Tailwind scale: 4px (1), 8px (2), 12px (3), 16px (4), 24px (6), 32px (8). W Figma: auto layout z tymi wartościami.

**Sync schedule:** Po każdym release z tagiem `[DS]` w RELEASE_NOTES.md — ręczny update Figma variables. Odpowiedzialność: osoba która chce Figma, nie DS lead.

---

*Koniec supplementu U-X. Sekcje A-X stanowią kompletny Design System Audit & Foundation Plan pokrywający: audit (1), principles (2), foundations (3, U), komponenty (4, V), wzorce (K, W), zasady użycia (W.1, W.2, U.2, U.3), dokumentację (O, M, R), implementację (I, J, L, X), governance (N, P, Q, S, T).*

---

## See also

- [Lint Rules](./lint-rules.md) — automatyczne testy w CI
- [Metrics](./metrics.md) — metryki jakości wizualnej
- [Contributor Experience](./contributor-experience.md) — workflow contributora
- [Foundations Gaps](./foundations-gaps.md) — motion spec testowany wizualnie
