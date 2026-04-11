# U. Uzupełnienie Foundations — Motion, Type Hierarchy, Icons

> Specyfikacja animacji (duration/easing/prefers-reduced-motion), hierarchia typografii (10 ról semantycznych), konwencje ikon (lucide-react).

---

### U.1 Motion & Animation Spec

#### Stan obecny (z audytu codebase)

Projekt JUŻ używa animacji, ale bez standaryzacji:

| Animacja | Duration | Easing | Kontekst |
|----------|----------|--------|----------|
| `slide-in` (flash messages) | 300ms | ease-out | Flash notification entry |
| `ai-pulse` / `ai-pulse-active` | 3s / 1.5s | ease-in-out | AI dot idle/active |
| `ai-glow` / `ai-glow-active` | 3s / 1.5s | ease-in-out | AI dot glow |
| `ai-spin` | 8s | linear | AI dot gradient rotation |
| Switch toggle | 200ms | default | `transition-transform` thumb slide |
| Progress bar | 300ms | ease-in-out | `transition-all` width change |
| Button/IconButton hover | default (~150ms) | default | `transition-all` |
| Dialog/Popover/Tooltip enter | tw-animate-css | — | `animate-in fade-in-0 zoom-in-95` |

**Problemy:** Mix 150ms/200ms/300ms bez uzasadnienia. Zero `prefers-reduced-motion` support (krytyczna luka a11y).

#### Duration Scale [POST-HACKATHON]

| Token | CSS Variable | Wartość | Kiedy używać |
|-------|-------------|---------|-------------|
| `instant` | `--motion-duration-instant` | `75ms` | Hover color change, focus ring, checkbox/radio toggle |
| `fast` | `--motion-duration-fast` | `150ms` | Button hover/active, icon rotation, tooltip fade |
| `normal` | `--motion-duration-normal` | `250ms` | Switch thumb slide, popover/dropdown open, tab switch |
| `slow` | `--motion-duration-slow` | `350ms` | Dialog open/close, flash message slide-in, accordion expand |
| `decorative` | `--motion-duration-decorative` | `1000ms+` | AI pulse, progress shimmer — nie dotyczy UI core |

**Zasada:** Interakcja bezpośrednia (user kliknął) = `fast`/`normal`. System feedback (coś się pojawiło) = `normal`/`slow`. Dekoracja = `decorative`.

#### Easing Curves [POST-HACKATHON]

| Token | CSS Variable | Wartość | Kiedy |
|-------|-------------|---------|-------|
| `default` | `--motion-ease-default` | `cubic-bezier(0.25, 0.1, 0.25, 1.0)` | Ogólne przejścia (≈ ease) |
| `enter` | `--motion-ease-enter` | `cubic-bezier(0.0, 0.0, 0.2, 1.0)` | Elementy wchodzące: dialog, popover, tooltip, flash |
| `exit` | `--motion-ease-exit` | `cubic-bezier(0.4, 0.0, 1.0, 1.0)` | Elementy wychodzące: dialog close, flash dismiss |
| `spring` | `--motion-ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1.0)` | Drobne efekty sprężyste: switch thumb, bounce badge |

#### Reguły Motion

**Co animować (GPU-accelerated):**
- `transform` (translate, scale, rotate)
- `opacity`
- `filter` (blur, brightness)
- `clip-path`

**Czego NIE animować (layout reflow):**
- `width`, `height`, `top`, `left`, `margin`, `padding`
- Wyjątek: `Progress` bar animuje width — akceptowalne bo to jednorazowe, nie repetitive

**`prefers-reduced-motion` — OBOWIĄZKOWE:** [HACKATHON — 15 min]

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

Dodać do `globals.css`. Nie wyłączamy animacji całkowicie (`0.01ms` zamiast `0ms`) żeby `animationend`/`transitionend` events nadal się odpalały.

#### Skeleton Loaders [POST-HACKATHON]

**Decyzja: Skeleton vs Spinner:**

| Sytuacja | Użyj | Dlaczego |
|----------|------|---------|
| Znany layout (lista, detail, form) | Skeleton | User widzi kształt nadchodzącego contentu — mniejszy perceived wait time |
| Nieznany layout (first load, search results) | Spinner (`LoadingMessage`) | Nie wiadomo co narysować |
| Akcja użytkownika (save, delete) | Spinner w button | Feedback na klik, nie na layout |
| Sekcja wewnątrz strony | `InlineLoader` z DataLoader | Nie blokuj reszty strony |

**Skeleton spec (gdy zaimplementowany):**

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

- Kolor bazowy: `--muted` (spójny z loading states)
- Highlight: muted +5% lightness (w OKLCH — perceptualnie poprawne)
- Duration: 1.5s (dłużej = mniej agresywne, lepsze dla a11y)
- Border-radius: `--radius-sm` (zaokrąglone jak content który zastępują)
- Sizing: dopasowane do contentu (text skeleton = h-4, avatar = h-10 w-10 rounded-full)

**Priorytet:** Skeleton component to [LATER]. `prefers-reduced-motion` to [HACKATHON].

---

### U.2 Prescriptive Type Hierarchy

Dane z audytu (sekcje 1.3, 1.4): 61 arbitralnych rozmiarów, h1 stylowany jako `text-2xl font-semibold` (14 wystąpień) lub `text-2xl font-bold tracking-tight` (3 wystąpienia). h2 ma 5 różnych stylów. h3 ma 5 różnych stylów.

#### Type Scale [HACKATHON]

| Semantic role | HTML | Tailwind classes | Size | Waga | Line-height | Letter-spacing | Kiedy używać |
|--------------|------|-----------------|------|------|-------------|---------------|-------------|
| Page title | `<h1>` | `text-2xl font-semibold tracking-tight` | 24px | 600 | `leading-tight` (1.25) | -0.025em | Tytuł strony w PageHeader. Max 1 per page. |
| Section title | `<h2>` | `text-lg font-semibold` | 18px | 600 | `leading-7` (1.75rem) | — | Tytuł sekcji w SectionHeader, card header. |
| Subsection title | `<h3>` | `text-base font-semibold` | 16px | 600 | `leading-6` (1.5rem) | — | Podtytuł wewnątrz sekcji, tab panel header. |
| Group title | `<h4>` | `text-sm font-semibold` | 14px | 600 | `leading-5` (1.25rem) | — | Nagłówek grupy pól w formularzu, settings section. |
| Body (default) | `<p>` | `text-sm` | 14px | 400 | `leading-5` (1.25rem) | — | Domyślny tekst w backend. Wszystkie opisy, paragrafy, cell content. |
| Body (large) | `<p>` | `text-base` | 16px | 400 | `leading-6` (1.5rem) | — | Portal body text, hero descriptions, feature cards. |
| Caption | `<span>` | `text-xs text-muted-foreground` | 12px | 400 | `leading-4` (1rem) | — | Pomocniczy tekst: timestamps, metadata, helper text pod polami. |
| Label | `<label>` | `text-sm font-medium` | 14px | 500 | `leading-5` (1.25rem) | — | Form labels w backend (CrudForm FieldControl). Via `<Label>` primitive. |
| Overline | `<span>` | `text-overline` | 11px | 600 | `leading-4` (1rem) | `tracking-wider` (0.05em) | Uppercase labels: entity type w FormHeader, portal field labels, category tags. |
| Code | `<code>` | `font-mono text-sm` | 14px | 400 | `leading-5` (1.25rem) | — | Kod, API paths, technical values. Geist Mono. |

**Token CSS do dodania:**

```css
/* W globals.css — jedyny custom token typograficzny */
--font-size-overline: 0.6875rem;    /* 11px */
--font-weight-overline: 600;
--letter-spacing-overline: 0.05em;
--text-transform-overline: uppercase;

/* W @theme inline */
--font-size-overline: var(--font-size-overline);
```

**Tailwind utility (w globals.css):**

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

| Don't | Dlaczego | Co zamiast |
|-------|----------|------------|
| Przeskakiwać heading levels (`h1` → `h3` bez `h2`) | Łamie a11y — screen reader traci strukturę | Zawsze zachowuj sekwencję. Jeśli nie potrzebujesz h2 — zmniejsz h1. |
| Używać heading class na non-heading (`<div className="text-2xl font-semibold">`) | Wizualna hierarchia ≠ semantyczna. Screen reader nie widzi headingu. | Użyj `<h2>` z właściwą klasą. |
| Mieszać rozmiarów w jednym kontekście (`text-lg` obok `text-xl` jako peer headings) | Sugeruje różną ważność tam gdzie jej nie ma. | Ten sam level = ten sam rozmiar. |
| Używać `font-bold` (700) w body text | Za ciężki dla body, koliduje z headings. | `font-medium` (500) dla akcentów w body. `font-semibold` (600) dla headings. |
| Używać arbitralnych rozmiarów (`text-[13px]`, `text-[15px]`) | Łamie skalę, utrudnia maintenance. | Mapuj na najbliższy Tailwind size (por. sekcja J mapping table). |

**Priorytet:** [HACKATHON] — 1 tabela, 15 minut, eliminuje 90% pytań o rozmiary.

---

### U.3 Icon Usage Guidelines

Decyzja DR-003: lucide-react jako jedyna biblioteka ikon. Audit: 14 plików z inline SVG do migracji.

#### Sizing Convention [HACKATHON]

| Token | Tailwind | Pixel | Kiedy używać | Przykład |
|-------|---------|-------|-------------|---------|
| `icon.xs` | `size-3` | 12px | Badge count, notification dot, inline indicator | Badge number overlay |
| `icon.sm` | `size-3.5` | 14px | W małych buttonach (`size="sm"`), compact row actions, breadcrumb separator | `<ChevronRight className="size-3.5" />` w breadcrumbs |
| `icon.default` | `size-4` | 16px | **Standard — 80% użyć.** Button icon, nav item icon, table cell icon, form field icon | `<Plus className="size-4" />` w `<Button>` |
| `icon.md` | `size-5` | 20px | Standalone icon buttons (`IconButton size="default"`), section header icon, alert icon | `<AlertCircle className="size-5" />` w `<Alert>` |
| `icon.lg` | `size-6` | 24px | Empty state icon, feature card icon, page header accent | `<Package className="size-6" />` w `<EmptyState>` |
| `icon.xl` | `size-8` | 32px | Hero illustrations, onboarding steps, large empty states | Portal feature cards, wizard step icons |

Dane z codebase: `size-4` (16px) dominuje z 602 użyciami `w-4` i 591 `h-4`. `size-3`/`size-3.5` to 154/72 użyć. `size-5` to 85 użyć.

#### Stroke Width [HACKATHON]

**Decyzja: `strokeWidth={2}` (lucide default) — wszędzie.** Bez wyjątków.

Uzasadnienie: Audit znalazł 19 wystąpień `strokeWidth="2"` (explicit default) i 11 wystąpień `strokeWidth="1.5"` (portal/frontend). `1.5` to legacy — cieńsze linie są mniej czytelne w małych rozmiarach (size-3, size-4) i niespójne z resztą systemu. Migracja: 11 zmian w ramach module migration.

**Nie przekazuj `strokeWidth` w JSX** — lucide domyślnie renderuje 2. Jeśli widzisz explicit `strokeWidth={2}` — usuń, to redundant.

#### Icon + Text vs Icon-Only [HACKATHON]

| Kontekst | Dozwolone icon-only? | Wymagania |
|----------|---------------------|-----------|
| Primary CTA (Create, Save) | ❌ NIE | Zawsze icon + text. User musi wiedzieć co robi przycisk. |
| Sidebar nav items | ❌ NIE (collapsed: icon-only z tooltip) | Pełna nawigacja: icon + text. Collapsed sidebar: icon + tooltip. |
| Toolbar / row actions (Edit, Delete, More) | ✅ TAK | `aria-label` OBOWIĄZKOWY. Tooltip ZALECANY. |
| Close button (X w dialog/alert) | ✅ TAK | `aria-label="Close"` OBOWIĄZKOWY. |
| Pagination (prev/next) | ✅ TAK | `aria-label="Previous page"` / `aria-label="Next page"`. |
| Status indicator (dot, check) | ✅ TAK (dekoracyjny) | `aria-hidden="true"` — status przekazywany przez tekst/badge, nie ikonę. |

**Zasada nadrzędna (por. Principle 3):** Jeśli ikona jest jedynym sposobem na zrozumienie akcji → `aria-label` jest WYMAGANY, nie zalecany. TypeScript powinien to wymuszać (prop `aria-label` required na `IconButton`).

#### Top 20 ikon w Open Mercato (z grep codebase)

| # | Ikona | Importy | Kontekst |
|---|-------|---------|----------|
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

**Jak znaleźć ikonę:** Otwórz [lucide.dev/icons](https://lucide.dev/icons), wyszukaj po nazwie akcji (np. "delete" → Trash2, "add" → Plus). Preferuj ikony z top 20 — contributorzy je znają.

#### Icon Don'ts

| Don't | Dlaczego | Co zamiast |
|-------|----------|------------|
| Import z innej biblioteki (Heroicons, Phosphor) | Niespójny stroke, sizing, style (por. DR-003) | Zawsze `from 'lucide-react'` |
| Inline SVG (`<svg viewBox="...">`) | Nie jest tree-shakeable, niespójny stroke | Znajdź odpowiednik w lucide lub zgłoś request |
| `strokeWidth={1.5}` lub inne custom | Cieńsze linie = mniej czytelne w size-4 | Usuń prop — lucide default (2) jest standardem |
| Ikona poza skalą (`size-7`, `size-10`, `size-[18px]`) | Łamie skalę, niespójne z resztą UI | Użyj najbliższego rozmiaru ze skali: 3, 3.5, 4, 5, 6, 8 |

---

## See also

- [Foundations](./foundations.md) — główna sekcja foundations (kolory, spacing, z-index)
- [Token Values](./token-values.md) — wartości tokenów OKLCH
- [Component Specs](./component-specs.md) — specyfikacje komponentów używających tych foundations
