# Open Mercato — Design System Audit & Foundation Plan

**Data:** 2026-04-10
**Branch:** develop
**Autor:** Claude (na zlecenie Product/Design Lead)
**Status:** Dokument roboczy

---

## Spis tresci

- [Czesc 1 — Audit istniejacego UI](#czesc-1--audit-istniejacego-ui)
- [Czesc 2 — Design Principles](#czesc-2--design-principles)
- [Czesc 3 — Foundations](#czesc-3--foundations)
- [Czesc 4 — MVP Komponentow](#czesc-4--mvp-komponentow)
- [A. Executive Summary](#a-executive-summary)
- [B. Plan na hackathon](#b-plan-na-hackathon)
- [C. Deliverables](#c-deliverables)
- [D. Tabela priorytetow](#d-tabela-priorytetow)

---

# CZESC 1 — AUDIT ISTNIEJACEGO UI

## Zakres audytu

- **160 backend pages** across **34 modules**
- **Portal pages** (customer-facing: login, signup, dashboard, profile)
- **Frontend pages** (auth login/reset, public quote view)
- **Shared UI library** (`packages/ui/`) — primitives, backend components, portal components
- **Styling system** — Tailwind v4, OKLCH CSS variables, CVA variants

---

## 1.1 Architektura ekranow i flow

### Co sprawdzic
- Czy kazdy modul ma spojny flow: lista → tworzenie → edycja → szczegoly?
- Czy wzorce stron sa powtarzalne miedzy modulami?
- Czy sa ekrany "osierocone" (brak nawigacji do nich)?

### Pytania kontrolne
- Czy uzytkownik zawsze wie, gdzie jest i jak wrocic?
- Czy flow CRUD jest identyczny w kazdym module?
- Czy stany posrednie (loading, error, empty) sa obsluzone na kazdym ekranie?

### Ustalenia z audytu

**Spojne wzorce (dobrze):**
- **List page pattern**: `<Page>` → `<DataTable>` z filtrami, wyszukiwarka, paginacja, row actions — uzywany w 46/160 stron
- **Create page pattern**: `<Page>` → `<CrudForm>` z polami/grupami, custom fields, walidacja — uzywany w ~20 stron
- **Detail page pattern**: `<Page>` → highlights → tabbed sections → editable fields — uzywany w ~10 zlozonych modulach (customers, sales, catalog)

**Problemy:**
- **104/160 stron (70%) nie uzywa DataTable** — niektorze uzywaja wlasnych list, kart lub surowych tabel
- **119/150 stron backend (79%) nie obsluguje empty state** — puste tabele bez zadnego komunikatu
- **61/150 stron (41%) nie ma loading state** — brak wskaznika ladowania
- Niektorze moduly maja pelen CRUD flow, inne maja tylko liste bez mozliwosci tworzenia

### Wplyw na UX
Uzytkownik napotyka niespojne zachowanie: w jednym module pusta lista pokazuje przyjazny komunikat z CTA, w innym — pustke.

### Wplyw na spojnosc systemu
Brak wymuszonego wzorca stron prowadzi do tego, ze kazdy contributor buduje swoj ekran od zera.

### Wplyw na accessibility
Brak loading/error states oznacza brak komunikatow dla screen readerow o stanie interfejsu.

### Priorytet naprawy: **WYSOKI**

### Czy do pierwszego etapu DS: **TAK** — zdefiniowac obowiazkowe page patterns

---

## 1.2 Nawigacja i Information Architecture

### Co sprawdzic
- Struktura sidebar (main / settings / profile)
- Breadcrumbs
- Mobile navigation
- Command palette / szybkie wyszukiwanie

### Ustalenia z audytu

**Sidebar (dobrze):**
- Trzy tryby: main, settings, profile
- Injection points dla modulow (`menu:sidebar:main`, `menu:sidebar:settings`)
- Customizacja sidebara (reorder, rename, hide) z persystencja w localStorage
- Responsive: collapse do 72px na desktop, drawer 260px na mobile

**Breadcrumbs:**
- Brak dedykowanego komponentu — renderowane inline w headerze AppShell
- `ApplyBreadcrumb` component ustawia breadcrumb via context
- Na mobile ukrywane posrednie elementy (`hidden md:inline`)
- Zawsze zaczyna od "Dashboard"

**Problemy:**
- Brak command palette / global search — cala nawigacja opiera sie na sidebar
- Breadcrumbs zaimplementowane jako czesc AppShell (1650+ linii), nie jako reusable component
- Detekcja sciezki settings oparta na string prefix matching — kruche rozwiazanie
- `dangerouslySetInnerHTML` uzywany do renderowania ikon z markup string — potencjalne ryzyko XSS

### Profile Dropdown
- Change Password, Notifications, Theme Toggle, Language selector, Sign Out
- Injection point: `menu:topbar:profile-dropdown`

### Wplyw na UX
Brak global search / command palette jest odczuwalny przy 34 modulach — nawigacja wymaga wielu klikniec.

### Priorytet naprawy: **SREDNI** (sidebar dziala dobrze, brakuje command palette)

### Czy do pierwszego etapu DS: **NIE** — sidebar jest funkcjonalny, command palette to feature, nie DS

---

## 1.3 Hierarchia wizualna

### Co sprawdzic
- Czy naglowki stron maja spojny rozmiar i styl?
- Czy jest jasna hierarchia: page title → section title → field label?
- Czy akcje (CTA) sa wizualnie wyroznialne?

### Ustalenia z audytu

**FormHeader — dwa tryby:**
- **Edit mode**: kompaktowy header z back link i tytulem
- **Detail mode**: duzy header z entity type label, subtitle, status badge, Actions dropdown

**Problemy:**
- **61 razy uzyto arbitralnych rozmiarow tekstu** (`text-[11px]`, `text-[13px]`, `text-[10px]`) zamiast skali Tailwind
- Brak zdefiniowanej hierarchii typograficznej — kazdy contributor wybiera rozmiar "na oko"
- Portal pages uzywaja `text-4xl sm:text-5xl lg:text-6xl` dla hero, ale backend uzywa `text-2xl` dla tytulu strony — brak spojnosci miedzy frontend/backend

### Wplyw na UX
Niespojne rozmiary tekstu utrudniaja skanowanie strony wzrokiem.

### Priorytet naprawy: **WYSOKI**

### Czy do pierwszego etapu DS: **TAK** — typography scale to foundation

---

## 1.4 Typografia

### Co sprawdzic
- Fonty (family, weights, sizes)
- Line heights
- Letter spacing
- Uzytkownik arbitralnych wartosci

### Ustalenia z audytu

**Fonty:**
- **Geist Sans** — primary (sans-serif)
- **Geist Mono** — code/monospace
- Zdefiniowane jako CSS custom properties w globals.css

**Rozmiary tekstu — uzycie w codebase:**

| Wartosc | Wystapienia | Kontekst |
|---------|-------------|----------|
| `text-[9px]` | 1 | notification badge count |
| `text-[10px]` | 15 | badge small, labels |
| `text-[11px]` | 33 | uppercase labels, captions |
| `text-[12px]` | 2 | role/feature pills |
| `text-[13px]` | 7 | small buttons, links |
| `text-[14px]` | 1 | button overrides |
| `text-[15px]` | 2 | portal header subtitle |
| `text-xs` (12px) | powszechne | general small text |
| `text-sm` (14px) | dominujace | default body |
| `text-base` (16px) | czeste | larger body |
| `text-2xl` (24px) | czeste | page titles |
| `text-3xl` (30px) | nieliczne | page subtitles |
| `text-4xl`–`text-6xl` | portal hero | responsive hero |

**Letter spacing:**
- `tracking-tight` — headings
- `tracking-wider` / `tracking-widest` / `tracking-[0.15em]` — uppercase labels (niespojne miedzy soba)

**Problemy:**
- **61 arbitralnych rozmiarow tekstu** lamie skale Tailwind
- **3 rozne warianty letter-spacing** dla uppercase labels
- Brak zdefiniowanej skali typograficznej (heading 1-6, body, caption, label, overline)

### Priorytet naprawy: **WYSOKI**

### Czy do pierwszego etapu DS: **TAK** — typography scale

---

## 1.5 Kolorystyka i semantyka koloru

### Co sprawdzic
- System tokenow kolorow
- Uzycie semantycznych kolorow (error, success, warning, info)
- Hardcoded wartosci vs tokeny
- Dark mode support

### Ustalenia z audytu

**System tokenow (dobrze):**
- OKLCH color space — nowoczesny, perceptually uniform
- CSS custom properties: `--primary`, `--secondary`, `--accent`, `--destructive`, `--muted`, `--card`, `--popover`, `--border`, `--input`, `--ring`
- Sidebar-specific tokens: `--sidebar`, `--sidebar-foreground`, etc.
- Chart colors: 10 named (`--chart-blue`, `--chart-emerald`, etc.)
- Dark mode: pelen zestaw tokenow, przelaczanie via `.dark` class
- `ThemeProvider` z localStorage persistence i OS preference detection

**KRYTYCZNY PROBLEM — 372 hardcoded semantic colors:**

| Pattern | Wystapienia | Przyklad |
|---------|-------------|---------|
| `text-red-*` | 159 | `text-red-600` (107x), `text-red-800` (26x) |
| `bg-red-*` | 39 | `bg-red-50` (24x), `bg-red-100` (14x) |
| `text-green-*` | 47 | `text-green-800` (26x), `text-green-600` (18x) |
| `bg-green-*` | 31 | `bg-green-100` (26x) |
| `text-blue-*` | 69 | `text-blue-600` (27x), `text-blue-800` (25x) |
| `bg-blue-*` | 47 | `bg-blue-50` (24x), `bg-blue-100` (19x) |
| `text-emerald-*` | 16 | `text-emerald-700` (6x) |
| `bg-emerald-*` | 12 | `bg-emerald-50` (5x) |
| `border-red-*` | ~10 | `border-red-200`, `border-red-500` |

**Gdzie to wystepuje:**
- Status badges (active/inactive/pending) — hardcoded per-module
- Alert/error banners w auth login (`border-red-200 bg-red-50 text-red-700`)
- Success banners (`border-emerald-200 bg-emerald-50 text-emerald-900`)
- Customer address tiles, sales document statuses, currency statuses

**Problem:**
System ma zdefiniowane tokeny (`--destructive`, `--accent`), ale **372 miejsc w kodzie ignoruje je** i uzywa bezposrednich kolorow Tailwind. Te kolory:
- Nie reaguja na dark mode
- Nie sa centralizowane — zmiana semantyki "error" wymaga edycji 159 plikow
- Rozne odcienie czerwonego (`red-500`, `red-600`, `red-700`, `red-800`, `red-900`) uzywane zamiennie

### Porownanie Alert/Notice/Badge:

| Komponent | Error | Success | Warning | Info |
|-----------|-------|---------|---------|------|
| Alert | `destructive` variant | `border-emerald-600/30 bg-emerald-500/10 text-emerald-900` | `border-amber-500/30 bg-amber-400/10 text-amber-950` | `border-sky-600/30 bg-sky-500/10 text-sky-900` |
| Notice | `border-red-200 bg-red-50 text-red-800` | brak | `border-amber-200 bg-amber-50 text-amber-800` | `border-blue-200 bg-blue-50 text-blue-900` |
| FlashMessages | `emerald-600` | `red-600` | `amber-500` | `blue-600` |
| Notifications | `text-destructive` | `text-green-500` | `text-amber-500` | `text-blue-500` |

**4 rozne komponenty, 4 rozne palety dla tych samych stanow semantycznych.**

### Priorytet naprawy: **KRYTYCZNY**

### Czy do pierwszego etapu DS: **TAK** — semantic color tokens to absolutne minimum

---

## 1.6 Spacing i Layout

### Co sprawdzic
- Spacing scale
- Spojnosc gap/padding/margin
- Grid system
- Layout patterns

### Ustalenia z audytu

**Spacing — dystrybucja uzycia:**

| Wartosc | gap | space-y | padding (p-) |
|---------|-----|---------|-------------|
| 0.5 (2px) | 7 | 9 | — |
| 1 (4px) | 101 | 168 | 166 |
| 1.5 (6px) | 29 | 44 | — |
| 2 (8px) | **525** | **268** | **559** |
| 3 (12px) | 207 | 163 | 336 |
| 4 (16px) | 82 | 136 | 250 |
| 5 (20px) | 7 | 4 | — |
| 6 (24px) | 13 | 66 | 69 |
| 8 (32px) | 2 | 15 | — |

**Obserwacje:**
- `gap-2`, `space-y-2`, `p-2` dominuja (45%+ uzycia) — ale brak udokumentowanego uzasadnienia
- Wartosci 5 (`gap-5`, `space-y-5`) sa prawie nieuzywane — sugeruje ze skala 2-3-4-6-8 jest "naturalna" dla projektu
- Outlier: `py-20`, `p-20` — jednorazowe hacki
- **27 roznych arbitralnych wysokosci** (`h-[50vh]`, `h-[60vh]`, `h-[90vh]`, etc.)
- **20 roznych arbitralnych szerokosci** (`w-[120px]`, `w-[200px]`, `w-[480px]`, etc.)

**Layout patterns:**
- `<Page>` wrapper: `space-y-6`
- `<PageBody>`: `space-y-4`
- Grid: 1-2-3 kolumny responsywne (`grid-cols-1 md:grid-cols-2 xl:grid-cols-3`)
- Sidebar: 72px/240px/320px (3 stany)
- Dialog: bottom sheet na mobile, centered na desktop

### Priorytet naprawy: **WYSOKI**

### Czy do pierwszego etapu DS: **TAK** — spacing scale

---

## 1.7 Formularze

### Co sprawdzic
- Spojnosc pol formularza
- Walidacja
- Error display
- Layout formularza (single column, multi-column, grouped)

### Ustalenia z audytu

**CrudForm (dobrze):**
- Centralny komponent formularza (1800+ linii)
- Obsluguje: pola, grupy, custom fields, walidacje Zod, server error mapping
- Auto-flash messaging na success/failure
- Keyboard shortcuts: `Cmd/Ctrl+Enter` submit, `Escape` cancel
- Injection: `crud-form:<entityId>:fields`

**Input components:**
- `DatePicker`, `DateTimePicker`, `TimePicker`
- `ComboboxInput` — searchable select z async loading
- `TagsInput` — multi-select tags
- `LookupSelect` — lookup table
- `PhoneNumberField` — phone z formatowaniem
- `SwitchableMarkdownInput` — rich text z markdown toggle

**Problemy:**
- Brak komponentu **Form Field wrapper** (label + input + description + error) jako reusable primitive
- Portal pages buduja formularze recznie (`gap-4` miedzy polami, `gap-1.5` wewnatrz pol) zamiast uzywac CrudForm
- Auth login page uzywa wlasnego layoutu formularza z hardcoded stylami
- **Brak spojnego Form Field** — label styling rozni sie miedzy modulami:
  - Portal: `text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70`
  - Backend CrudForm: wbudowane labele
  - Auth: `<Label>` z primitives

### Priorytet naprawy: **WYSOKI**

### Czy do pierwszego etapu DS: **TAK** — FormField wrapper

---

## 1.8 Karty, listy, tabele — prezentacja danych

### Co sprawdzic
- DataTable patterns
- Card patterns
- List patterns
- Detail page sections

### Ustalenia z audytu

**DataTable (dobrze):**
- Bogaty komponent (1000+ linii): sorting, filtering, pagination, row selection, bulk actions, column chooser, export, perspectives, virtual rows
- Extension points: `data-table:<tableId>:columns|:row-actions|:bulk-actions|:filters`
- Uzywany w 46/160 stron

**Card patterns — niespojne:**
- `packages/ui/src/primitives/card.tsx` — generyczny Card z CardHeader, CardTitle, CardDescription, CardContent, CardFooter
- `packages/ui/src/portal/components/PortalCard.tsx` — portal-specific `rounded-xl border bg-card p-5 sm:p-6`
- `PortalFeatureCard` — 3-column grid cards z ikona
- `PortalStatRow` — statystyki w cardzie
- Settings pages uzywaja card-grid do nawigacji

**Problem — 15+ Section components z powtarzalnym wzorcem:**

Customers module:
- `TagsSection`, `CustomDataSection`, `ActivitiesSection`, `DetailFieldsSection`, `AddressesSection`, `DealsSection`, `CompanyPeopleSection`, `TasksSection`

Sales module:
- `AdjustmentsSection`, `ShipmentsSection`, `PaymentsSection`, `AddressesSection`, `ItemsSection`, `ReturnsSection`

Kazda sekcja implementuje niezaleznie: header + content + action + empty state + loading. Brak wspolnego base component.

### Priorytet naprawy: **SREDNI**

### Czy do pierwszego etapu DS: **TAK** — Section component, Card component

---

## 1.9 Feedback systemowy

### Co sprawdzic
- Error states
- Success feedback
- Warning messages
- Loading indicators
- Empty states

### Ustalenia z audytu

**Mechanizmy feedbacku — 4 niezalezne systemy:**

| System | Komponent | Czas zycia | Trigger |
|--------|-----------|-----------|---------|
| Flash messages | `FlashMessages` | 3s auto-dismiss | Programmatic `flash()` lub URL params |
| Notices | `Notice` / `Alert` | Persistent inline | Renderowane w JSX |
| Notifications | `NotificationBell` + panel | Persistent, SSE-based | Server events |
| Confirm dialogs | `useConfirmDialog` | Until user action | Programmatic `confirm()` |

**Flash messages (dobrze):**
- 4 warianty: success (emerald-600), error (red-600), warning (amber-500), info (blue-600)
- Fixed positioning: top-right desktop, bottom sheet mobile
- 3s auto-dismiss z manual close

**Notice vs Alert — duplikacja:**
- `Notice`: 3 warianty (error, info, warning) — uzywa hardcoded kolorow (`border-red-200`, `bg-red-50`)
- `Alert`: 5 wariantow (default, destructive, success, warning, info) — uzywa bardziej abstrakcyjnych klas
- **Oba komponenty sluza do tego samego celu** — inline komunikaty na stronie

**ErrorNotice:**
- Wrapper wokol `Notice variant="error"`
- Default i18n title i message

**Empty states — slabe pokrycie:**
- `EmptyState` komponent istnieje (centered layout, dashed border, muted bg, optional icon + CTA)
- `TabEmptyState` wrapper dla sekcji w zakladkach
- **Ale 79% stron backend nie uzywa zadnego z nich**

**Loading states:**
- `LoadingMessage` — spinner + tekst w bordered container
- `Spinner` — standalone spinner
- **41% stron nie ma loading state**
- Pattern: recznie zarzadzany `isLoading` state, nie opakowany we wspolny komponent

### Priorytet naprawy: **WYSOKI**

### Czy do pierwszego etapu DS: **TAK** — ujednolicic Notice/Alert, wymusic empty/loading states

---

## 1.10 Stany interakcji

### Co sprawdzic
- Hover, focus, active, disabled states
- Focus management
- Keyboard navigation

### Ustalenia z audytu

**Button/IconButton (dobrze):**
- CVA-based variants z hover/focus/disabled states
- Focus ring: `focus-visible:ring-ring/50 focus-visible:ring-[3px]`
- Disabled: `disabled:pointer-events-none disabled:opacity-50`
- 7 wariantow Button, 2 warianty IconButton, 4 rozmiary kazdego

**CrudForm keyboard shortcuts (dobrze):**
- `Cmd/Ctrl+Enter` — submit
- `Escape` — cancel
- ConfirmDialog: `Enter` confirm, `Escape` cancel

**Problemy:**
- Tab navigation nie jest testowana systematycznie
- Niektorze custom inline editors moga nie obslugiwac keyboard navigation
- Focus trapping w modalach: Dialog uzywa Radix (dobrze), ale ConfirmDialog uzywa natywnego `<dialog>` (tez ok)

### Priorytet naprawy: **SREDNI**

### Czy do pierwszego etapu DS: **NIE** — obecny stan jest akceptowalny, mozna poprawic iteracyjnie

---

## 1.11 Dostepnosc (Accessibility)

### Co sprawdzic
- ARIA attributes
- Semantic HTML
- Color contrast
- Screen reader support
- Keyboard navigation

### Ustalenia z audytu

**Dobre praktyki:**
- `aria-label` na IconButtons (`aria-label="Close"`, `aria-label="Open menu"`)
- `role="alert"` i `aria-live="polite"` na error messages
- Semantic HTML: `<nav>`, `<h1>`-`<h2>`, `<button>`, `<label>`
- Formularze: `htmlFor` na labelach

**Problemy:**
- **370+ interactive elements bez aria-label** — glownie icon buttons w roznych modulach
- Niektorze inline SVG ikony nie maja `aria-hidden="true"`
- Brak skip-to-content link
- Brak focus indicator na niektorych custom komponentach
- OKLCH kolory — brak zautomatyzowanego contrast checking

### Priorytet naprawy: **WYSOKI**

### Czy do pierwszego etapu DS: **TAK** — accessibility foundations

---

## 1.12 Responsywnosc

### Co sprawdzic
- Breakpoints
- Mobile-first approach
- Touch targets
- Viewport scaling

### Ustalenia z audytu

**Breakpoints (spojne):**
- `sm:` (640px), `md:` (768px), `lg:` (1024px), `xl:` (1280px)
- Mobile-first: base styles → modyfikacje na wieksze ekrany

**Responsive patterns:**
- Hero: `text-4xl sm:text-5xl lg:text-6xl`
- Grid: `grid-cols-1 sm:grid-cols-3`, `md:grid-cols-2 xl:grid-cols-3`
- Padding: `p-5 sm:p-6`, `px-4 lg:px-8`
- Sidebar: `hidden lg:block` (drawer na mobile)
- Dialog: bottom sheet na mobile, centered na desktop

**Problemy:**
- Breadcrumbs ukrywaja posrednie elementy na mobile — moze byc mylace
- DataTable na mobile — brak specjalnego widoku (horizontal scroll)
- Touch targets — nie sprawdzane systematycznie (minimum 44x44px)

### Priorytet naprawy: **SREDNI**

### Czy do pierwszego etapu DS: **NIE** — obecne podejscie jest wystarczajace

---

## 1.13 Content design i microcopy

### Co sprawdzic
- i18n coverage
- Hardcoded strings
- Error messages
- Empty state copy
- Button labels

### Ustalenia z audytu

**i18n (dobrze):**
- 10,848 uzyc translation keys (`useT()`, `t()`)
- `useT()` hook client-side, `resolveTranslations()` server-side
- Fallback pattern: `t('key', 'Default fallback text')`

**Problemy:**
- **Portal frontend pages maja hardcoded English text** — signup, login, landing page
- Niektorze opisy komponentow i error messages nie uzywaja i18n
- Brak guidelines dla content tone (formalny vs nieformalny, techniczny vs user-friendly)

### Priorytet naprawy: **NISKI** (core jest dobrze pokryty)

### Czy do pierwszego etapu DS: **NIE** — to jest praca contentowa, nie DS

---

## 1.14 Wzorce UX i duplikacja komponentow

### Co sprawdzic
- Czy sa wzorce ktore powtarzaja sie miedzy modulami ale sa implementowane niezaleznie?
- Czy sa komponenty ktore robia to samo ale inaczej?

### Ustalenia z audytu

**Duplikacje:**

1. **Notice vs Alert** — dwa komponenty do inline komunikatow, rozne API, rozne kolory
2. **15+ Section components** — kazdy modul implementuje sekcje niezaleznie (header + content + empty + loading)
3. **Icon system** — `lucide-react` (oficjalna biblioteka) vs custom inline SVG (portal, sales) — rozne stroke widths (`1.5` vs `2`), rozne sizing (`size-4` vs `size-5`)
4. **Status badges** — kazdy modul definiuje wlasne kolory statusow (hardcoded)
5. **Markdown rendering** — te same pseudo-selektory kopiowane miedzy plikami (`[&_ul]:ml-4 [&_ul]:list-disc ...`)

**Raw fetch vs apiCall:**
- 8 miejsc uzywa raw `fetch()` zamiast `apiCall` wrapper — auth login, auth reset, workflows demo, currency providers

### Priorytet naprawy: **WYSOKI**

### Czy do pierwszego etapu DS: **TAK** — Notice/Alert unification, Section component, Icon system

---

## 1.15 Border radius

### Co sprawdzic
- Spojnosc uzycia border radius
- Semantyka (kiedy rounded-md vs rounded-lg vs rounded-xl)

### Ustalenia z audytu

| Wartosc | Wystapienia | % |
|---------|-------------|---|
| `rounded-lg` | 279 | 47% |
| `rounded-md` | 222 | 37% |
| `rounded-full` | 104 | 18% |
| `rounded-none` | 25 | 4% |
| `rounded-xl` | 18 | 3% |
| `rounded-sm` | 1 | <1% |

**Tokeny zdefiniowane w globals.css:**
- `--radius: 0.625rem`
- `--radius-sm: calc(var(--radius) - 4px)` = ~0.25rem
- `--radius-md: calc(var(--radius) - 2px)` = ~0.375rem
- `--radius-lg: var(--radius)` = 0.625rem
- `--radius-xl: calc(var(--radius) + 4px)` = ~1.025rem

**Problem:** Tokeny istnieja, ale brak guideline kiedy uzywac ktorego. `rounded-md` i `rounded-lg` uzywane zamiennie (84% uzycia) bez semantycznego rozroznienia. Portal uzywa `rounded-xl`, auth login `rounded-md`, prymitywy mieszaja.

### Priorytet naprawy: **NISKI**

### Czy do pierwszego etapu DS: **TAK** — udokumentowac usage guidelines

---

## 1.16 Shadows / Elevation

### Co sprawdzic
- Uzycie cieni
- Layering / z-index management

### Ustalenia z audytu

**Z-index w AppShell:**
- Sidebar: implicit (no explicit z-index, uses DOM order)
- Mobile drawer overlay: `bg-black/40`
- ProgressTopBar: `z-10`
- Flash messages: fixed positioning

**Problemy:**
- Brak zdefiniowanej skali elevation
- Brak tokenow `shadow.*` poza domyslnymi Tailwind
- Z-index nie jest scentralizowany — potencjalne konflikty przy wiekszej ilosci overlayow

### Priorytet naprawy: **NISKI**

### Czy do pierwszego etapu DS: **TAK** — zdefiniowac 3-4 poziomy elevation

---

## Podsumowanie audytu — Scoring Rubric

| # | Obszar | Ocena (1-5) | Priorytet | Do DS MVP |
|---|--------|-------------|-----------|-----------|
| 1 | Architektura ekranow | 3 | Wysoki | Tak |
| 2 | Nawigacja i IA | 4 | Sredni | Nie |
| 3 | Hierarchia wizualna | 2 | Wysoki | Tak |
| 4 | Typografia | 2 | Wysoki | Tak |
| 5 | Kolorystyka i semantyka | 2 | **Krytyczny** | Tak |
| 6 | Spacing i layout | 3 | Wysoki | Tak |
| 7 | Formularze | 3 | Wysoki | Tak |
| 8 | Prezentacja danych | 3 | Sredni | Tak |
| 9 | Feedback systemowy | 2 | Wysoki | Tak |
| 10 | Stany interakcji | 4 | Sredni | Nie |
| 11 | Dostepnosc | 2 | Wysoki | Tak |
| 12 | Responsywnosc | 4 | Sredni | Nie |
| 13 | Content design | 4 | Niski | Nie |
| 14 | Duplikacja komponentow | 2 | Wysoki | Tak |
| 15 | Border radius | 3 | Niski | Tak (docs) |
| 16 | Shadows / elevation | 3 | Niski | Tak (tokens) |

**Skala ocen:**
- 5 = Spojne, udokumentowane, dobrze dzialajace
- 4 = W wiekszosci spojne, drobne luki
- 3 = Czesciowo spojne, wymaga standaryzacji
- 2 = Niespojne, wymaga natychmiastowej pracy
- 1 = Brak lub powaznie uszkodzone

**Kryteria priorytetu:**
- **Krytyczny**: Aktywnie psuje UX i blokuje spojnosc (np. 372 hardcoded kolory)
- **Wysoki**: Widoczny wplyw na UX, latwy do naprawy z DS
- **Sredni**: Wplyw na UX, ale obecny stan jest funkcjonalny
- **Niski**: Kosmetyczne lub do rozwiazania pozniej

**Rekomendowana kolejnosc dzialan po audycie:**
1. Semantic color tokens (eliminuje 372 hardcoded kolorow)
2. Typography scale (eliminuje 61 arbitralnych rozmiarow)
3. Spacing scale documentation
4. Notice/Alert unification
5. FormField wrapper component
6. Section base component
7. Empty/loading state enforcement
8. Icon system standardization
9. Accessibility pass (aria-labels)
10. Border radius / elevation documentation

---

# CZESC 2 — DESIGN PRINCIPLES

## Propozycja Design Principles dla Open Mercato

### Principle 1: Clarity Over Cleverness

**Definicja:** Kazdy element interfejsu powinien byc oczywisty w swoim przeznaczeniu. Zero magii, zero ukrytych zachowan.

**Rozwiniecie:** W projekcie open source contributorzy maja rozny poziom doswiadczenia. Interface musi byc zrozumialy zarowno dla uzytkownika koncowego, jak i dla developera czytajacego kod. Jesli trzeba tlumaczyc, co robi komponent — jest zbyt skomplikowany.

**Dlaczego wazny w OSS:** Nowi contributorzy musza zrozumiec UI patterns bez mentoringu. Klarowne wzorce redukuja onboarding time.

**Jakie decyzje wspiera:**
- Explicit props over magic defaults
- Descriptive naming over abbreviations
- Visible state over hidden state
- Documentation of "why" not just "how"

**Dobry przyklad:** `<EmptyState title="No customers yet" description="Create your first customer" action={{ label: "Add customer", onClick: handleCreate }} />` — kzde zachowanie widoczne w props.

**Naruszenie:** Komponent ktory zmienia swoje zachowanie w zaleznosci od kontekstu parent, bez widocznego prop.

**Wplyw na contributora:** Moze budowac UI bez studiowania internals.
**Wplyw na UX:** Uzytkownik zawsze wie, co sie dzieje i dlaczego.
**Wplyw na spojnosc:** Explicit patterns sa latwiejsze do replikowania.

---

### Principle 2: Consistency Is a Feature

**Definicja:** Te same problemy rozwiazujemy w ten sam sposob. Zawsze.

**Rozwiniecie:** Spojnosc nie jest ograniczeniem — jest produktem. Uzytkownik ucze sie wzorcow raz i stosuje je wszedzie. Contributor buduje nowy modul szybciej, bo wzorce sa znane.

**Dlaczego wazny w OSS:** 34 moduly, wielu contributorow. Bez consistency kazdy modul wyglada jak oddzielna aplikacja.

**Jakie decyzje wspiera:**
- Uzyj istniejacego komponentu zamiast tworzenia nowego
- Stosuj te same spacing, colors, typography tokens
- Ten sam CRUD flow w kazdym module
- Ten sam error/success pattern wszedzie

**Dobry przyklad:** Kazda lista uzytkownikow, produktow, zamowien wyglada i dziala identycznie — DataTable z tymi samymi filtrami, akcjami, paginacja.

**Naruszenie:** Portal signup page z recznie zbudowanym formularzem o innym spacing i labelach niz reszta systemu.

**Wplyw na contributora:** Mniej decyzji = szybsze budowanie.
**Wplyw na UX:** Uzytkownik czuje sie "jak w domu" w kazdym module.
**Wplyw na spojnosc:** Eliminuje design debt zanim powstanie.

---

### Principle 3: Accessible by Default

**Definicja:** Accessibility nie jest dodatkiem ani checklist item. Jest wbudowana w kazdy komponent od poczatku.

**Rozwiniecie:** Komponent bez aria-label nie jest "prawie gotowy" — jest niekompletny. DS musi gwarantowac, ze uzywajac komponentow z systemu, contributor automatycznie dostarcza accessible UI.

**Dlaczego wazny w OSS:** Roznorodni contributorzy maja rozna swiadomosc a11y. System musi wymusic dobre praktyki.

**Jakie decyzje wspiera:**
- Wymagane `aria-label` na IconButton (enforced przez TypeScript)
- Semantic HTML jako default (nie `<div>` z onClick)
- Focus management w kazdym komponencie interaktywnym
- Color contrast sprawdzany na poziomie tokenow
- Keyboard navigation jako czesc definicji "done"

**Dobry przyklad:** `<IconButton aria-label="Delete customer">` — TypeScript error jesli brak aria-label.

**Naruszenie:** 370+ interactive elements bez aria-label w obecnym codebase.

**Wplyw na contributora:** Nie musi pamietac o a11y — system wymusza.
**Wplyw na UX:** Produkt jest uzywalny dla wszystkich.
**Wplyw na spojnosc:** Accessibility rules sa czescia design system contract.

---

### Principle 4: Reuse Over Reinvention

**Definicja:** Nie buduj tego, co juz istnieje. Rozszerzaj istniejace komponenty zamiast tworzenia nowych.

**Rozwiniecie:** Kazdy nowy komponent to koszt utrzymania. W OSS ten koszt jest rozlozony na wielu maintainerow. Im mniej komponentow, tym latwiej je utrzymac, testowac, dokumentowac.

**Dlaczego wazny w OSS:** Duplikacja to naturalny efekt decentralized contribution. 15+ Section components w Open Mercato to dowod.

**Jakie decyzje wspiera:**
- Sprawdz istniejace komponenty przed budowaniem nowego
- Uzywaj composition (children, slots) zamiast tworzenia wariantow
- Jeden komponent Alert zamiast Notice + Alert + ErrorNotice
- Jeden sposob wyswietlania statusow zamiast hardcoded kolorow per modul

**Dobry przyklad:** Uzycie `<DataTable>` z customizacja zamiast budowania wlasnej listy.

**Naruszenie:** `Notice` i `Alert` — dwa komponenty robiace to samo z roznymi API i kolorami.

**Wplyw na contributora:** Mniej do nauki, mniej do utrzymania.
**Wplyw na UX:** Spojne zachowanie feedbacku.
**Wplyw na spojnosc:** Redukcja surface area systemu.

---

### Principle 5: Predictable Behavior

**Definicja:** Uzytkownik powinien moc przewidziec zachowanie UI zanim kliknie. Zadnych niespodzianek.

**Rozwiniecie:** Jesli przycisk "Delete" w jednym module pokazuje dialog potwierdzenia, musi to robic w kazdym module. Jesli `Escape` zamyka formularz, musi zamykac kazdy formularz.

**Dlaczego wazny w OSS:** Rozni contributorzy moga inaczej implementowac ten sam pattern. System musi gwarantowac spojne zachowanie.

**Jakie decyzje wspiera:**
- Destructive actions zawsze wymagaja potwierdzenia
- Keyboard shortcuts sa globalne i spojne
- Loading states zawsze sa widoczne
- Error messages zawsze pojawiaja sie w tym samym miejscu

**Dobry przyklad:** `Cmd/Ctrl+Enter` submit w kazdym formularzu, `Escape` cancel — ujednolicone przez CrudForm.

**Naruszenie:** Formularz auth login ktory nie obsluguje `Escape` do anulowania.

**Wplyw na contributora:** Jasne reguły = mniej edge case'ow do obslugi.
**Wplyw na UX:** Uzytkownik buduje muscle memory.
**Wplyw na spojnosc:** Zachowania sa czescia systemu, nie czescia modulu.

---

### Principle 6: System Thinking

**Definicja:** Kazdy komponent jest czescia wiekszego systemu. Nie projektuj w izolacji.

**Rozwiniecie:** Zmiana koloru buttona wplywa na kontrast z tlem, czytelnosc tekstu, dark mode, alert states. Zmiana spacing jednego komponentu wplywa na layout calej strony. Mysl o zaleznosach.

**Dlaczego wazny w OSS:** Contributor widzi swoj PR, nie widzi calego systemu. Design system musi wymuszac myslenie systemowe.

**Jakie decyzje wspiera:**
- Uzywaj tokenow zamiast hardcoded wartosci
- Testuj zmiany w kontekscie calej strony, nie tylko komponentu
- Rozumiej zaleznosci miedzy komponentami
- Dokumentuj side effects zmian

**Dobry przyklad:** Zmiana `--destructive` color token automatycznie aktualizuje wszystkie error states w systemie.

**Naruszenie:** 372 hardcoded kolorow — zmiana semantyki "error" wymaga edycji 159 plikow.

**Wplyw na contributora:** Zmiana w jednym miejscu propaguje sie prawidlowo.
**Wplyw na UX:** Spojny system bez "dziur".
**Wplyw na spojnosc:** System jest self-reinforcing.

---

### Principle 7: Progressive Disclosure

**Definicja:** Pokazuj tylko to, co jest potrzebne teraz. Reszta dostepna na zadanie.

**Rozwiniecie:** Formularz z 30 polami przytlacza. Tabela z 20 kolumnami jest nieczytelna. Pokazuj minimum, pozwol uzytkownikowi odslaniac wiecej gdy potrzebuje.

**Dlaczego wazny w OSS:** Nowi contributorzy dodaja pola "na wszelki wypadek". System musi zachecac do minimalizmu.

**Jakie decyzje wspiera:**
- Default column set w DataTable (5-7 kolumn), reszta w column chooser
- Grouped form fields z collapsible sections
- Summary view → detail view pattern
- Advanced filters ukryte za "More filters" trigger

**Dobry przyklad:** DataTable z column chooser — domyslnie 5 kolumn, uzytkownik dodaje kolejne.

**Naruszenie:** Formularz z 20 widocznymi polami bez grupowania.

**Wplyw na contributora:** Jasne guidelines ile pol/kolumn jest "za duzo".
**Wplyw na UX:** Mniejsze cognitive load.
**Wplyw na spojnosc:** Wszystkie listy i formularze maja podobna gestosc informacji.

---

### Principle 8: Contribution-Friendly Design

**Definicja:** Design system musi byc latwy do uzycia, trudny do zlamania.

**Rozwiniecie:** Contributor powinien moc zbudowac spojny ekran uzywajac 5-10 komponentow, bez czytania 100 stron dokumentacji. TypeScript powinien lapac bledy zanim trafi do PR review.

**Dlaczego wazny w OSS:** Design system dla zamknietego zespolu moze polegac na tribal knowledge. OSS musi byc self-documenting.

**Jakie decyzje wspiera:**
- Proste API komponentow (malo wymaganych props, sensowne defaults)
- TypeScript enforcement (required aria-label, required variant)
- Komponent-templates zamiast budowania od zera
- Dobre error messages w dev mode
- Przyklad referencyjny (customers module)

**Dobry przyklad:** `<CrudForm fields={[...]} onSubmit={fn} />` — contributor podaje pola i submit handler, reszta jest automatyczna.

**Naruszenie:** Komponent z 25 props, z czego 15 jest wymaganych.

**Wplyw na contributora:** Szybki start, trudno o blad.
**Wplyw na UX:** Kazdy contributor dostarcza podobnej jakosci UI.
**Wplyw na spojnosc:** System wymusza dobre praktyki zamiast na nie polegac.

---

## Skrocona wersja principles (do README)

```
## Design Principles

1. **Clarity Over Cleverness** — Every UI element should be obvious in purpose
2. **Consistency Is a Feature** — Same problems, same solutions, always
3. **Accessible by Default** — A11y is built-in, not bolted-on
4. **Reuse Over Reinvention** — Extend existing components, don't create new ones
5. **Predictable Behavior** — Users should predict UI behavior before clicking
6. **System Thinking** — Every component is part of a larger system
7. **Progressive Disclosure** — Show what's needed now, reveal more on demand
8. **Contribution-Friendly** — Easy to use correctly, hard to use wrong
```

## Design Review / PR Review Checklist (based on principles)

### Clarity
- [ ] Czy komponent ma oczywiste przeznaczenie bez czytania dokumentacji?
- [ ] Czy prop names sa opisowe i jednoznaczne?
- [ ] Czy stany (loading, error, empty) sa jawnie obslugiwane?

### Consistency
- [ ] Czy uzyto istniejacych tokenow (colors, spacing, typography)?
- [ ] Czy CRUD flow jest identyczny z innymi modulami?
- [ ] Czy error/success feedback uzywa tych samych komponentow?
- [ ] Czy spacing jest zgodny ze skala systemu?

### Accessibility
- [ ] Czy kazdy interactive element ma aria-label lub visible label?
- [ ] Czy uzytko semantic HTML (button, nav, heading)?
- [ ] Czy komponent jest nawigowany klawiatura?
- [ ] Czy contrast ratio jest wystarczajacy?

### Reuse
- [ ] Czy sprawdzono istniejace komponenty przed budowaniem nowego?
- [ ] Czy nie zduplikowano logiki innego komponentu?
- [ ] Czy uzyto composition zamiast nowego wariantu?

### Predictability
- [ ] Czy destructive actions maja dialog potwierdzenia?
- [ ] Czy keyboard shortcuts sa spojne z reszta systemu?
- [ ] Czy uzytkownik wie, co sie stanie po kliknieciu?

### System Thinking
- [ ] Czy uzyto design tokenow zamiast hardcoded wartosci?
- [ ] Czy zmiana dziala poprawnie w dark mode?
- [ ] Czy komponent dziala poprawnie w roznych kontekstach (modal, page, sidebar)?

### Progressive Disclosure
- [ ] Czy formularz nie ma wiecej niz 7-10 widocznych pol?
- [ ] Czy tabela nie ma wiecej niz 7 domyslnych kolumn?
- [ ] Czy zaawansowane opcje sa ukryte za triggerem?

### Contribution-Friendly
- [ ] Czy nowy contributor moze uzyc komponentu bez mentoringu?
- [ ] Czy TypeScript lapi typowe bledy?
- [ ] Czy istnieje przyklad uzycia (w customers module lub Storybook)?

---

# CZESC 3 — FOUNDATIONS

## 3.1 Color System

### Co obejmuje
Pelny system kolorow obejmujacy: palette, semantic tokens, status colors, surface colors, interactive colors, chart colors.

### Po co jest potrzebny
Eliminuje 372 hardcoded kolorow. Umozliwia dark mode. Centralizuje decyzje kolorystyczne.

### Decyzje do podjecia
- Czy zachowac OKLCH? (TAK — juz wdrozone, nowoczesne, dobre)
- Ile status colors? (4: error, success, warning, info)
- Czy dodac "neutral" status? (np. draft, archived)
- Jak mapowac na Tailwind utilities?

### Stan obecny
Dobre: `--primary`, `--secondary`, `--destructive`, `--muted`, `--accent`, `--card`, `--popover`, `--border`, chart colors.
Brak: semantic status tokens, surface hierarchy, interactive state tokens.

### Tokeny do zdefiniowania

```
// Primitive palette (juz istnieje w OKLCH)
color.primary.DEFAULT / foreground
color.secondary.DEFAULT / foreground
color.destructive.DEFAULT / foreground
color.muted.DEFAULT / foreground
color.accent.DEFAULT / foreground

// Semantic status (BRAKUJE — krytyczne)
color.status.error.bg / text / border / icon
color.status.success.bg / text / border / icon
color.status.warning.bg / text / border / icon
color.status.info.bg / text / border / icon
color.status.neutral.bg / text / border / icon

// Surface hierarchy (czesciowo istnieje)
color.surface.page          // --background
color.surface.card          // --card
color.surface.popover       // --popover
color.surface.sidebar       // --sidebar
color.surface.overlay       // bg-black/50

// Interactive (czesciowo w CVA)
color.interactive.focus      // --ring
color.interactive.hover      // computed
color.interactive.disabled   // opacity-50

// Border
color.border.default         // --border
color.border.input           // --input
color.border.focus           // --ring
```

### Bledy bez tej warstwy
- 372 hardcoded kolorow — kazdy contributor "zgaduje" jaki kolor uzyc
- Dark mode broken dla semantic colors
- Zmiana palette wymaga grep+replace w calym codebase

### MVP: **TAK** — semantic status tokens (eliminuje 80% problemu)
### Pozniej: palette refinement, surface hierarchy documentation

---

## 3.2 Typography

### Co obejmuje
Font family, size scale, weight scale, line height, letter spacing, text style tokens.

### Po co jest potrzebny
Eliminuje 61 arbitralnych rozmiarow tekstu. Daje jasna hierarchie wizualna.

### Decyzje do podjecia
- Ile poziomow heading? (4-6)
- Ile rozmiarow body? (2-3: default, small, large)
- Jakie specjalne style? (caption, label, overline, code)
- Czy zachowac Geist Sans/Mono? (TAK — juz wdrozone)

### Tokeny do zdefiniowania

```
// Font family (istnieje)
font.sans           // Geist Sans
font.mono           // Geist Mono

// Size scale (mapowanie na Tailwind)
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

### Bledy bez tej warstwy
- `text-[11px]` vs `text-xs` vs `text-[12px]` — 3 sposoby na "maly tekst"
- 3 rozne warianty letter-spacing dla uppercase labels
- Brak hierarchii = kazdy contributor wybiera rozmiar "na oko"

### MVP: **TAK** — size scale + text style tokens
### Pozniej: line height fine-tuning, responsive typography

---

## 3.3 Spacing Scale

### Co obejmuje
Siatka spacing, gap/padding/margin scale, breakpoints.

### Po co jest potrzebny
Standaryzuje odstepy. Eliminuje "dlaczego tu gap-3 a tam gap-4?".

### Decyzje do podjecia
- Jaka baza? (4px = wersja Tailwind default)
- Ktore wartosci sa "oficjalne"?
- Jak dokumentowac "ktory spacing kiedy"?

### Tokeny do zdefiniowania

```
// Spacing scale (Tailwind defaults, ale z naming)
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
- `gap-2` (8px): default gap miedzy powiazanymi elementami (buttons, badges, inline items)
- `gap-3` (12px): gap miedzy polami formularza
- `gap-4` (16px): gap miedzy sekcjami na stronie
- `gap-6` (24px): gap miedzy glownymi sekcjami strony
- **NIE uzywac** `gap-5`, `gap-7` — te wartosci nie sa w oficjalnej skali

### MVP: **TAK** — usage guidelines document + lint rules
### Pozniej: Semantic spacing tokens jako CSS variables

---

## 3.4 Border Radius

### Co obejmuje
Radiusy zaokraglenia dla roznych kontekstow.

### Tokeny do zdefiniowania

```
// Juz istnieja w globals.css:
radius.sm      // 0.25rem — small inputs, tags
radius.md      // 0.375rem — buttons, inputs, badges
radius.lg      // 0.625rem — cards, alerts, containers
radius.xl      // 1.025rem — modals, portal cards
radius.full    // 9999px — avatars, pills, circular buttons
radius.none    // 0 — tables, embedded elements
```

### Usage guidelines
- `rounded-sm`: tagi, male tokeny
- `rounded-md`: buttony, inputy, badge, drobiazgi
- `rounded-lg`: karty, alerty, kontener
- `rounded-xl`: modale, portal karty, duze kontenery
- `rounded-full`: avatary, pille, status dots
- `rounded-none`: tabele, elementy wtopione w kontener

### MVP: **TAK** — documentation only (tokeny juz istnieja)
### Pozniej: enforcement via lint

---

## 3.5 Borders

### Co obejmuje
Grubosc, styl, kolory obramowania.

### Tokeny do zdefiniowania

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

### MVP: **TAK** — w ramach color tokens
### Pozniej: oddzielne tokeny

---

## 3.6 Elevation / Shadows

### Co obejmuje
System cieni i warstw dla depth perception.

### Tokeny do zdefiniowania

```
shadow.none         // brak — flat elements
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

### MVP: **TAK** — z-index scale (zapobiega konfliktom)
### Pozniej: shadow tokens

---

## 3.7 Iconography

### Co obejmuje
Icon library, sizing, stroke width, usage patterns.

### Stan obecny
- **Oficjalna biblioteka:** `lucide-react` (v0.556.0) w root package.json
- **Problem:** Portal i niektorze moduly uzywaja custom inline SVG z roznymi stroke widths (1.5 vs 2) i sizing (size-4 vs size-5)

### Decyzje do podjecia
- Standardize na lucide-react everywhere
- Jeden stroke width (2px — lucide default)
- Jeden sizing system

### Tokeny do zdefiniowania

```
icon.size.xs      // size-3 (12px) — inline, badge icons
icon.size.sm      // size-4 (16px) — default icon size
icon.size.md      // size-5 (20px) — prominent icons
icon.size.lg      // size-6 (24px) — hero icons, empty states
icon.size.xl      // size-8 (32px) — feature icons
icon.stroke       // 2 (lucide default)
```

### MVP: **TAK** — standardize na lucide-react, usunac inline SVG
### Pozniej: custom icon set jesli potrzebny

---

## 3.8 Motion / Animation

### Co obejmuje
Timing, easing, transition patterns.

### Stan obecny
- AI-specific animations w globals.css (pulse, glow, sparkle)
- Flash message: `slide-in` 300ms ease-out
- Dialog: Radix animations (fade-in/out, slide-in/out)
- Brak zdefiniowanej skali timing

### Tokeny do zdefiniowania

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

### MVP: **NIE** — obecne animacje sa wystarczajace
### Pozniej: standardize duration/easing tokens

---

## 3.9 Interaction States

### Co obejmuje
Hover, focus, active, disabled, selected, loading states.

### Tokeny do zdefiniowania

```
state.hover.opacity        // used for bg-opacity changes
state.disabled.opacity     // 0.5
state.focus.ring.width     // 3px
state.focus.ring.color     // --ring
state.focus.ring.offset    // 0
state.selected.bg          // bg-accent
state.loading.opacity      // 0.7
```

### MVP: **NIE** — CVA juz obsluguje stany w buttonach
### Pozniej: centralize w tokenach

---

## 3.10 Accessibility Foundations

### Co obejmuje
Focus management, color contrast, screen reader support, reduced motion, touch targets.

### Decyzje do podjecia
- WCAG level: AA (minimum) czy AAA?
- Minimum touch target: 44x44px
- Focus visible strategy
- Reduced motion support

### Tokeny / reguły

```
a11y.focus.visible          // focus-visible:ring-[3px] focus-visible:ring-ring/50
a11y.touch.target.min       // 44px
a11y.contrast.min           // 4.5:1 (AA for normal text)
a11y.contrast.large.min     // 3:1 (AA for large text)
a11y.motion.reduced         // prefers-reduced-motion: reduce
```

### MVP: **TAK** — wymagany aria-label na IconButton (TypeScript), skip-to-content link
### Pozniej: automated contrast checking, WCAG AAA

---

## 3.11 Content Foundations

### Co obejmuje
Tone of voice, microcopy patterns, error message guidelines.

### Decyzje do podjecia
- Formalny vs nieformalny ton?
- Techniczny vs user-friendly error messages?
- Max dlugosc button labels?
- Wzorce empty state copy?

### Guidelines

```
// Error messages
"Could not save changes. Please try again."      // DOBRZE
"Error 500: Internal Server Error"                // ZLE

// Empty states
"No customers yet"                                // Title
"Create your first customer to get started."      // Description
"Add customer"                                    // Action

// Button labels
"Save"                                            // DOBRZE (krotki, jasny)
"Click here to save your changes"                 // ZLE (za dlugi)
"Submit"                                          // OK (generyczny)
"Save customer"                                   // LEPIEJ (kontekstowy)

// Confirmation dialogs
"Delete this customer?"                           // Title
"This action cannot be undone."                   // Description
"Delete" / "Cancel"                               // Actions
```

### MVP: **NIE** — to jest praca contentowa
### Pozniej: content style guide

---

## Foundations — kolejnosc wdrazania

```
1. Color System (semantic status tokens)     ← eliminuje 372 hardcoded kolorow
   ↓
2. Typography Scale                          ← eliminuje 61 arbitralnych rozmiarow
   ↓
3. Spacing Scale (documentation)             ← standaryzuje 793+ spacing decisions
   ↓
4. Border Radius (documentation)             ← tokeny juz istnieja, trzeba udokumentowac
   ↓
5. Iconography (lucide-react standard)       ← eliminuje custom inline SVG
   ↓
6. Z-index / Elevation                       ← zapobiega layering conflicts
   ↓
7. Accessibility Foundations                 ← TypeScript enforcement
   ↓
8. Motion                                    ← mozna odlozyc
   ↓
9. Content Foundations                       ← mozna odlozyc
```

**Zaleznosci:**
- Typography zalezy od spacing (line height)
- Border/Elevation zalezy od Color System
- Iconography jest niezalezna
- Accessibility jest cross-cutting — dotyczy wszystkich

**Hackathon MVP:**
1. Semantic color tokens (CSS variables + Tailwind mapping)
2. Typography scale (Tailwind config + documentation)
3. Spacing guidelines (documentation)
4. Z-index scale (CSS variables)
5. Border radius guidelines (documentation)

---

# CZESC 4 — MVP KOMPONENTOW

## Metodologia

Komponenty oceniane pod katem:
- **Priorytet**: jak wazny dla spojnosci systemu
- **Reuse**: jak czesto uzywany w codebase
- **Complexity risk**: ryzyko ze komponent stanie sie zbyt zlozony
- **Hackathon MVP**: czy da sie zrobic w 2-3 dni

---

## 4.1 Button

| | |
|---|---|
| **Kategoria** | Actions |
| **Priorytet** | P0 — krytyczny |
| **Uzasadnienie** | Najczesciej uzywany interactive element. Juz istnieje i dziala dobrze. |
| **Kiedy uzywac** | Kazda akcja uzytkownika: submit, cancel, delete, create, navigate |
| **Kiedy NIE uzywac** | Nawigacja do innej strony (uzyj Link). Display-only text. |
| **Anatomy** | `[icon?] [label] [icon?]` |
| **Warianty** | default, destructive, outline, secondary, ghost, muted, link |
| **Rozmiary** | sm (h-8), default (h-9), lg (h-10), icon (size-9) |
| **Stany** | default, hover, focus, active, disabled, loading |
| **Accessibility** | `aria-label` required jesli icon-only. `disabled` prevents interaction. Focus ring visible. |
| **Zaleznosci** | color tokens, typography, spacing, border-radius, focus ring |
| **Complexity risk** | Niskie — juz dobrze zaimplementowany z CVA |
| **Status** | **ISTNIEJE** — `packages/ui/src/primitives/button.tsx` |
| **Hackathon** | NIE — juz gotowy, ewentualnie dokumentacja |

---

## 4.2 Icon Button

| | |
|---|---|
| **Kategoria** | Actions |
| **Priorytet** | P0 |
| **Uzasadnienie** | Uzywany w row actions, close buttons, toolbars. |
| **Kiedy uzywac** | Akcja reprezentowana ikona (close, delete, edit, more) |
| **Kiedy NIE uzywac** | Jesli akcja wymaga label (uzyj Button). Jesli jest dekoracyjna. |
| **Anatomy** | `[icon]` |
| **Warianty** | outline, ghost |
| **Rozmiary** | xs (size-6), sm (size-7), default (size-8), lg (size-9) |
| **Stany** | default, hover, focus, active, disabled |
| **Accessibility** | `aria-label` **WYMAGANY** (TypeScript enforcement) |
| **Zaleznosci** | icon system, color tokens, border-radius |
| **Complexity risk** | Niskie |
| **Status** | **ISTNIEJE** — `packages/ui/src/primitives/icon-button.tsx` |
| **Hackathon** | NIE — juz gotowy, potrzebna TypeScript enforcement na aria-label |

---

## 4.3 Link

| | |
|---|---|
| **Kategoria** | Navigation |
| **Priorytet** | P1 |
| **Uzasadnienie** | Nawigacja miedzy stronami. Next.js Link jest uzywany bezposrednio. |
| **Kiedy uzywac** | Nawigacja do innej strony, zewnetrzny link |
| **Kiedy NIE uzywac** | Akcja in-place (uzyj Button) |
| **Anatomy** | `[icon?] [text] [external-icon?]` |
| **Warianty** | default (underline), subtle (no underline), nav (sidebar item) |
| **Stany** | default, hover, focus, active, visited |
| **Accessibility** | External links: `target="_blank" rel="noopener"` + visual indicator |
| **Zaleznosci** | typography, color tokens |
| **Complexity risk** | Niskie |
| **Status** | Czesciowo istnieje (Button variant="link"), brak dedykowanego komponentu |
| **Hackathon** | NIE — niski priorytet, Button variant="link" wystarczy |

---

## 4.4 Input

| | |
|---|---|
| **Kategoria** | Forms |
| **Priorytet** | P0 |
| **Uzasadnienie** | Podstawowy element formularzy |
| **Kiedy uzywac** | Jednoliniowy tekst: name, email, url, number, password |
| **Kiedy NIE uzywac** | Wieloliniowy tekst (Textarea), wybor z listy (Select) |
| **Anatomy** | `[prefix?] [input] [suffix?]` |
| **Warianty** | default, error |
| **Stany** | default, focus, disabled, readonly, error |
| **Accessibility** | Powiazany `<label>` via htmlFor. `aria-invalid` przy error. `aria-describedby` dla description/error. |
| **Zaleznosci** | color tokens (border, focus ring), typography, spacing, border-radius |
| **Complexity risk** | Niskie |
| **Status** | **ISTNIEJE** — `packages/ui/src/primitives/input.tsx` |
| **Hackathon** | NIE — juz gotowy |

---

## 4.5 Textarea

| | |
|---|---|
| **Kategoria** | Forms |
| **Priorytet** | P1 |
| **Status** | **ISTNIEJE** — `packages/ui/src/primitives/textarea.tsx` |
| **Hackathon** | NIE |

---

## 4.6 Select / Combobox

| | |
|---|---|
| **Kategoria** | Forms |
| **Priorytet** | P0 |
| **Status** | **ISTNIEJE** — `ComboboxInput` w `packages/ui/src/backend/inputs/` |
| **Hackathon** | NIE |

---

## 4.7 Checkbox

| | |
|---|---|
| **Kategoria** | Forms |
| **Priorytet** | P1 |
| **Status** | **ISTNIEJE** — `packages/ui/src/primitives/checkbox.tsx` |
| **Hackathon** | NIE |

---

## 4.8 Switch

| | |
|---|---|
| **Kategoria** | Forms |
| **Priorytet** | P1 |
| **Status** | **ISTNIEJE** — `packages/ui/src/primitives/switch.tsx` |
| **Hackathon** | NIE |

---

## 4.9 Form Field Wrapper

| | |
|---|---|
| **Kategoria** | Forms |
| **Priorytet** | **P0 — KRYTYCZNY, NIE ISTNIEJE** |
| **Uzasadnienie** | Brak spojnego wrappera label + input + description + error. Kazdy modul implementuje to recznie. |
| **Kiedy uzywac** | Kazde pole formularza poza CrudForm |
| **Kiedy NIE uzywac** | Wewnatrz CrudForm (ma wbudowany) |
| **Anatomy** | `[label] [required-indicator?] → [input (slot)] → [description?] → [error-message?]` |
| **Warianty** | default, horizontal (label obok input) |
| **Stany** | default, error, disabled |
| **Accessibility** | Auto-generowane `id` i `htmlFor`. `aria-describedby` linking description/error. `aria-invalid` przy error. `aria-required` przy required. |
| **Zaleznosci** | typography (label style), color tokens (error), spacing |
| **Complexity risk** | Niskie — to jest wrapper, nie logika |
| **Status** | **NIE ISTNIEJE** — `<Label>` istnieje ale brak wrapper composing label+input+error |
| **Hackathon** | **TAK** — priorytetowy komponent do stworzenia |

---

## 4.10 Card

| | |
|---|---|
| **Kategoria** | Layout |
| **Priorytet** | P1 |
| **Status** | **ISTNIEJE** — `packages/ui/src/primitives/card.tsx` (Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter) |
| **Problem** | Portal ma oddzielny `PortalCard` z innym padding/radius. Nalezy ujednolicic. |
| **Hackathon** | NIE — istnieje, wymaga unifikacji z PortalCard |

---

## 4.11 Badge

| | |
|---|---|
| **Kategoria** | Data Display |
| **Priorytet** | P1 |
| **Status** | **ISTNIEJE** — `packages/ui/src/primitives/badge.tsx` |
| **Problem** | Warianty (default, secondary, destructive, outline, muted) nie pokrywaja status colors. Moduly uzywaja hardcoded kolorow na badge zamiast wariantow. |
| **Hackathon** | TAK — dodac warianty status (success, warning, info) oparte na semantic tokens |

---

## 4.12 Alert / Notice (UNIFIKACJA)

| | |
|---|---|
| **Kategoria** | Feedback |
| **Priorytet** | **P0 — KRYTYCZNY** |
| **Uzasadnienie** | Dwa komponenty (Alert + Notice) robiace to samo. 4 rozne palety kolorow. |
| **Kiedy uzywac** | Inline komunikaty na stronie: error, success, warning, info |
| **Kiedy NIE uzywac** | Tymczasowy feedback (uzyj Flash/Toast). Potwierdzenie akcji (uzyj ConfirmDialog). |
| **Anatomy** | `[icon] [title?] [description] [action?] [close?]` |
| **Warianty** | error, success, warning, info, default |
| **Stany** | default, dismissible |
| **Accessibility** | `role="alert"` dla error/warning. `aria-live="polite"` dla info/success. |
| **Zaleznosci** | semantic color tokens (KRYTYCZNE), typography, spacing, border-radius, icon system |
| **Complexity risk** | Srednie — trzeba zmigrować uzytkownikow Notice na zunifikowany komponent |
| **Status** | Alert istnieje z 5 wariantami, Notice istnieje z 3 wariantami, ErrorNotice to wrapper |
| **Hackathon** | **TAK** — zunifikowac do jednego komponentu opartego na semantic tokens |

---

## 4.13 Toast / Flash Message

| | |
|---|---|
| **Kategoria** | Feedback |
| **Priorytet** | P1 |
| **Status** | **ISTNIEJE** — `FlashMessages` z `flash()` API |
| **Problem** | Kolory hardcoded (emerald-600, red-600). Powinny uzywac semantic tokens. |
| **Hackathon** | TAK — zmigrować na semantic color tokens |

---

## 4.14 Modal / Dialog

| | |
|---|---|
| **Kategoria** | Overlay |
| **Priorytet** | P0 |
| **Status** | **ISTNIEJE** — `packages/ui/src/primitives/dialog.tsx` (Radix-based) + `useConfirmDialog` |
| **Hackathon** | NIE — dziala dobrze |

---

## 4.15 Dropdown Menu

| | |
|---|---|
| **Kategoria** | Navigation / Actions |
| **Priorytet** | P1 |
| **Status** | **ISTNIEJE** — `RowActions` uzywa dropdown, `ProfileDropdown` ma custom dropdown |
| **Hackathon** | NIE |

---

## 4.16 Tabs

| | |
|---|---|
| **Kategoria** | Navigation |
| **Priorytet** | P1 |
| **Status** | **ISTNIEJE** — `packages/ui/src/primitives/tabs.tsx` |
| **Hackathon** | NIE |

---

## 4.17 Table

| | |
|---|---|
| **Kategoria** | Data Display |
| **Priorytet** | P0 |
| **Status** | **ISTNIEJE** — `DataTable` (1000+ linii, feature-rich) + primitives `table.tsx` |
| **Hackathon** | NIE — juz bardzo rozbudowany |

---

## 4.18 Empty State

| | |
|---|---|
| **Kategoria** | Feedback |
| **Priorytet** | **P0 — KRYTYCZNY** |
| **Status** | **ISTNIEJE** ale 79% stron go nie uzywa |
| **Hackathon** | **TAK** — documentation + enforcement guidelines, nie nowy komponent |

---

## 4.19 Loader / Skeleton

| | |
|---|---|
| **Kategoria** | Feedback |
| **Priorytet** | P1 |
| **Status** | **ISTNIEJE** — `Spinner`, `LoadingMessage`. Brak Skeleton. |
| **Hackathon** | NIE — Spinner wystarczy na teraz |

---

## 4.20 Page Header / Section Header

| | |
|---|---|
| **Kategoria** | Layout |
| **Priorytet** | P1 |
| **Status** | **ISTNIEJE** — `PageHeader` w `Page.tsx`, `FormHeader` w `forms/` |
| **Problem** | Brak wspolnego `SectionHeader` — 15+ sekcji implementuje wlasny header |
| **Hackathon** | **TAK** — `SectionHeader` component (title + action + collapse) |

---

## 4.21 Pagination

| | |
|---|---|
| **Kategoria** | Navigation |
| **Priorytet** | P1 |
| **Status** | **ISTNIEJE** — wbudowana w DataTable |
| **Hackathon** | NIE |

---

## 4.22 Status Badge (NOWY)

| | |
|---|---|
| **Kategoria** | Data Display |
| **Priorytet** | **P0 — KRYTYCZNY, NIE ISTNIEJE JAKO ODRERBNY** |
| **Uzasadnienie** | Kazdy modul hardcoduje kolory statusow. Potrzebny komponent mapujacy status → kolor z semantic tokens. |
| **Kiedy uzywac** | Wyswietlanie statusu: active/inactive, draft/published, paid/unpaid, open/closed |
| **Anatomy** | `[dot?] [label]` |
| **Warianty** | success, warning, error, info, neutral, custom (color prop) |
| **Hackathon** | **TAK** — oparty na Badge + semantic color tokens |

---

## Priorytety wdrazania komponentow

### Must Have — Hackathon (dni 1-3)

| # | Komponent | Typ | Uzasadnienie |
|---|-----------|-----|-------------|
| 1 | Semantic Color Tokens | Foundation | Eliminuje 372 hardcoded kolorow |
| 2 | Alert (unified) | Refactor | Zastepuje Notice + Alert + ErrorNotice |
| 3 | FormField Wrapper | Nowy | Brakujacy wrapper label+input+error |
| 4 | Status Badge | Nowy | Eliminuje hardcoded status colors |
| 5 | Badge (status variants) | Refactor | Dodanie success/warning/info wariantow |
| 6 | Flash Messages | Refactor | Migracja na semantic tokens |
| 7 | SectionHeader | Nowy | Eliminuje 15+ duplikatow |
| 8 | Empty State guidelines | Docs | Enforcement w 79% stron |

### Should Have — po hackathonie (tydzien 1-2)

| # | Komponent | Uzasadnienie |
|---|-----------|-------------|
| 9 | Typography scale | Tailwind config + documentation |
| 10 | Icon system standardization | lucide-react everywhere |
| 11 | Card unification | Card + PortalCard merge |
| 12 | Skeleton loader | Progressive loading |
| 13 | Accessibility audit pass | 370+ missing aria-labels |

### Nice to Have — pozniej

| # | Komponent | Uzasadnienie |
|---|-----------|-------------|
| 14 | Command palette | Navigation improvement |
| 15 | Breadcrumb component | Extraction from AppShell |
| 16 | Content style guide | Tone, microcopy |
| 17 | Motion tokens | Animation standardization |
| 18 | Responsive DataTable | Mobile view |

---

# A. EXECUTIVE SUMMARY

## Najwazniejsze wnioski

1. **Open Mercato ma solidne fundamenty UI**: Tailwind v4, OKLCH color system, shadcn/ui primitives, CVA variants, Radix UI. Infrastruktura jest nowoczesna.

2. **Glowny problem to brak semantic layer**: 372 hardcoded kolory, 61 arbitralnych rozmiarow tekstu, 4 rozne komponenty feedbacku z roznymi paletami. System ma tokeny bazowe, ale brakuje warstwy semantycznej.

3. **Wzorce sa dobre, ale nie wymuszone**: CrudForm, DataTable, Page layout istnieja i dzialaja dobrze. Problem w tym, ze 70% stron ich nie uzywa lub uzywa czesciowo.

4. **Duplikacja jest naturalna dla OSS**: 15+ Section components, Notice vs Alert, custom SVG vs lucide — to klasyczny efekt wielu contributorow bez shared guidelines.

## Najwieksze ryzyka

1. **Dark mode broken**: 372 hardcoded kolorow nie reaguje na dark mode — uzytkownik widzi bialy tekst na bialym tle lub nieczytlny kontrast
2. **Accessibility debt**: 370+ interactive elements bez aria-label — potencjalne ryzyko prawne (WCAG compliance)
3. **Scaling problem**: Bez design system kazdy nowy modul dodaje wlasne wzorce — dlug rosnie liniowo z iloscia modulow

## Najwazniejsze quick wins

1. **Semantic color tokens** (CSS variables) — 1 dzien pracy, eliminuje 80% problemu kolorystycznego
2. **Typography scale documentation** — pol dnia, eliminuje "ktory rozmiar uzyc?"
3. **Alert unification** — 1 dzien, zamienia 3 komponenty w 1
4. **FormField wrapper** — pol dnia, nowy prosty komponent
5. **Empty state enforcement** — documentation + PR review checklist

## Rekomendowana kolejnosc dzialan

```
Tydzien 1 (hackathon):
  → Semantic color tokens
  → Typography scale
  → Alert unification
  → FormField wrapper
  → Status Badge
  → SectionHeader
  → Documentation

Tydzien 2-3:
  → Icon standardization
  → Card unification
  → Spacing guidelines enforcement
  → Accessibility audit (aria-labels)

Tydzien 4+:
  → Storybook setup
  → Migration of existing pages
  → Content style guide
  → Motion tokens
```

---

# B. PLAN NA HACKATHON

**Czas trwania:** 11 kwietnia 2026 (piatek) 9:00 – 12 kwietnia 2026 (sobota) 11:00
**Budzet czasu:** ~18h roboczych (26h kalendarzowych minus sen/przerwy)
**Strategia:** Foundations first, potem komponenty, na koniec dokumentacja. Kazdy blok konczy sie commitem.

---

## BLOK 1 — Piątek 9:00–12:00 (3h): Foundations + Tokens

**Cel: miec dzialajace semantic color tokens w Tailwind**

- [ ] Dodac 20 CSS custom properties do `globals.css` (light mode)
- [ ] Dodac 20 CSS custom properties do `.dark` (dark mode)
- [ ] Dodac `text-overline` token (11px)
- [ ] Dodac `@theme inline` mappings dla Tailwind v4
- [ ] Zweryfikowac contrast w Chrome DevTools (light + dark) — wszystkie 5 statusow
- [ ] Udokumentowac typography scale (tabela)
- [ ] Udokumentowac spacing guidelines (usage rules)
→ **Commit:** `feat(ds): add semantic status tokens, text-overline, and foundation docs`

## BLOK 2 — Piątek 13:00–17:00 (4h): Migracja primitives

**Cel: wszystkie primitives uzywaja semantic tokenow**

- [ ] Zamienic Alert CVA variants na semantic tokens (`alert.tsx` — 4 linie)
- [ ] Zamienic Notice colors na semantic tokens + deprecation warning (`Notice.tsx`)
- [ ] Zamienic FlashMessages colors (`FlashMessages.tsx`)
- [ ] Zamienic Notification severity colors
- [ ] Dodac status warianty do Badge (`badge.tsx` — success, warning, info)
- [ ] Zmigrować CrudForm FieldControl colors (`text-red-600` → `text-destructive`)
→ **Commit:** `refactor(ds): migrate all primitives to semantic status tokens`

## BLOK 3 — Piątek 18:00–21:00 (3h): Nowe komponenty

**Cel: 3 nowe komponenty gotowe do uzycia**

- [ ] Stworzyc `FormField` wrapper (`packages/ui/src/primitives/form-field.tsx`)
- [ ] Stworzyc `StatusBadge` (`packages/ui/src/primitives/status-badge.tsx`)
- [ ] Stworzyc `Section` / `SectionHeader` (`packages/ui/src/backend/Section.tsx`)
→ **Commit:** `feat(ds): add FormField, StatusBadge, Section components`

## BLOK 4 — Piątek 21:00–23:00 (2h): Migracja referencyjnego modulu

**Cel: customers module w pelni zmigrowany — proof of concept**

- [ ] Uruchomic `ds-migrate-colors.sh` na `packages/core/src/modules/customers/`
- [ ] Uruchomic `ds-migrate-typography.sh` na tym samym module
- [ ] Manual review + fix edge cases
- [ ] Screenshot before/after (light + dark)
→ **Commit:** `refactor(ds): migrate customers module to DS tokens`

## BLOK 5 — Sobota 8:00–11:00 (3h): Dokumentacja + Wrap-up

**Cel: wszystko udokumentowane, gotowe do uzycia przez contributorow**

- [ ] Napisac Design Principles document (skrocona wersja do README)
- [ ] Napisac PR Review Checklist
- [ ] Zaktualizowac AGENTS.md z DS rules
- [ ] Zaktualizowac PR template z DS compliance checkboxami
- [ ] Zdefiniowac z-index scale w globals.css
- [ ] Udokumentowac border-radius usage guidelines
- [ ] Uruchomic `ds-health-check.sh` — zapisac baseline
→ **Commit:** `docs(ds): add principles, update AGENTS.md and PR template`

---

**Bufor bezpieczenstwa:** Plan pokrywa ~15h. Zostaja ~3h buforu na:
- Edge case'y w migracji customers
- Debugging dark mode contrast
- Niespodzianki w CrudForm FieldControl
- Odswiezenie przed prezentacja

---

# C. DELIVERABLES

Po hackathonie (SO 12.04 11:00) powinny byc gotowe:

1. **Audit checklist** — ten dokument (Czesc 1) ✅ (gotowy przed hackathon)
2. **Design Principles** — 8 principles z checklist do PR review (BLOK 5)
3. **Foundations v0** — semantic color tokens w globals.css, typography scale, spacing guidelines, z-index scale, border-radius guidelines (BLOK 1 + BLOK 5)
4. **Lista komponentow MVP** — z priorytetami i statusem ✅ (gotowa przed hackathon)
5. **Nowe/zaktualizowane komponenty** (BLOK 2 + BLOK 3):
   - Alert (semantic tokens + compact + dismissible)
   - Notice (deprecated, deleguje do Alert)
   - FormField wrapper
   - StatusBadge
   - SectionHeader / Section
   - Badge (+ status variants)
   - FlashMessages (semantic tokens)
   - CrudForm FieldControl (semantic tokens)
6. **Zmigrowany modul referencyjny** — customers module (BLOK 4)
7. **Documentation** (BLOK 5):
   - Design Principles document
   - PR Review Checklist (checkboxes)
   - AGENTS.md update z DS rules
   - PR template update
   - ds-health-check.sh baseline report

---

# D. TABELA PRIORYTETOW

| Obszar | Opis | Priorytet | Wplyw spojnosc | Wplyw UX | Wysilek | Hackathon |
|--------|------|-----------|---------------|----------|---------|-----------|
| Semantic color tokens | CSS variables dla status colors | **Krytyczny** | 5/5 | 4/5 | Sredni | **TAK** |
| Alert unification | Notice + Alert → 1 komponent | **Krytyczny** | 5/5 | 4/5 | Sredni | **TAK** |
| Typography scale | Dokumentacja + Tailwind config | Wysoki | 4/5 | 3/5 | Niski | **TAK** |
| FormField wrapper | Nowy komponent | Wysoki | 4/5 | 4/5 | Niski | **TAK** |
| StatusBadge | Nowy komponent | Wysoki | 4/5 | 3/5 | Niski | **TAK** |
| SectionHeader | Nowy komponent | Wysoki | 3/5 | 2/5 | Niski | **TAK** |
| Badge status variants | Rozszerzenie Badge | Wysoki | 3/5 | 3/5 | Niski | **TAK** |
| Flash semantic tokens | Migracja kolorow | Wysoki | 3/5 | 2/5 | Niski | **TAK** |
| Spacing guidelines | Dokumentacja | Wysoki | 4/5 | 2/5 | Niski | **TAK** |
| Z-index scale | CSS variables | Sredni | 2/5 | 1/5 | Niski | **TAK** |
| Border-radius docs | Dokumentacja | Sredni | 2/5 | 1/5 | Niski | **TAK** |
| Empty state enforcement | Guidelines + review | Wysoki | 3/5 | 4/5 | Niski | **TAK** (docs) |
| Design Principles | Dokument | Wysoki | 5/5 | 3/5 | Niski | **TAK** |
| PR Review Checklist | Checklist | Wysoki | 5/5 | 2/5 | Niski | **TAK** |
| Icon standardization | Migracja na lucide | Sredni | 3/5 | 2/5 | Sredni | Nie |
| Card unification | Card + PortalCard | Sredni | 2/5 | 2/5 | Sredni | Nie |
| Accessibility audit | 370+ aria-labels | Wysoki | 2/5 | 4/5 | Wysoki | Nie |
| Skeleton loader | Nowy komponent | Niski | 1/5 | 3/5 | Sredni | Nie |
| Command palette | Nowy feature | Niski | 1/5 | 4/5 | Wysoki | Nie |
| Content style guide | Dokumentacja | Niski | 2/5 | 3/5 | Sredni | Nie |
| Motion tokens | CSS variables | Niski | 1/5 | 2/5 | Niski | Nie |
| Responsive DataTable | Refactor | Niski | 1/5 | 3/5 | Wysoki | Nie |

**Legenda wysilku:** Niski = <4h, Sredni = 4-8h, Wysoki = >8h

**Legenda wplywu:** 1 = minimalny, 5 = krytyczny

---

---

# SUPPLEMENT: ENFORCEMENT, METRICS, APIs, RISK ANALYSIS

> Sekcje ponizej uzupelniaja glowny dokument o warstwe egzekucji, mierzalnosci, konkretnych API komponentow i strategii migracji.

---

# E. ENFORCEMENT & MIGRATION PLAN

## E.1 Hardcoded Colors (372 wystapienia)

### ESLint Rule

Dodac custom rule do `eslint.config.mjs` blokujaca semantic color classes w nowych plikach:

```javascript
// eslint-plugin-open-mercato/no-hardcoded-status-colors.js
// Blokuje: text-red-*, bg-red-*, border-red-*, text-green-*, bg-green-*,
//          text-emerald-*, bg-emerald-*, text-blue-* (status contexts),
//          text-amber-*, bg-amber-*
// Dozwolone: text-destructive, bg-destructive/*, text-status-*, bg-status-*

const BLOCKED_PATTERNS = [
  /\btext-red-\d+/,
  /\bbg-red-\d+/,
  /\bborder-red-\d+/,
  /\btext-green-\d+/,
  /\bbg-green-\d+/,
  /\bborder-green-\d+/,
  /\btext-emerald-\d+/,
  /\bbg-emerald-\d+/,
  /\bborder-emerald-\d+/,
  /\btext-amber-\d+/,
  /\bbg-amber-\d+/,
  /\bborder-amber-\d+/,
  /\btext-blue-\d+/,   // tylko w statusowych kontekstach
  /\bbg-blue-\d+/,
  /\bborder-blue-\d+/,
]
```

**Strategia:** Wlaczyc jako `warn` od dnia 1 (nie blokuje build). Po 2 sprintach przelaczac na `error` dla nowych plikow. Po 4 sprintach — `error` globalnie.

### Codemod / regex strategy

**Faza 1 — Error states (`text-red-600` → semantic token):**

```bash
# Znajdz wszystkie wystapienia
rg 'text-red-600' --type tsx -l
# 107 wystapien — wiekszosc to error messages i required indicators

# Zamiana w CrudForm FieldControl (wewnetrzna):
# text-red-600 → text-destructive
# Dotyczy: required indicator, error message

# Mapowanie:
# text-red-600  → text-destructive
# text-red-700  → text-destructive
# text-red-800  → text-destructive (darker context)
# bg-red-50     → bg-destructive/5
# bg-red-100    → bg-destructive/10
# border-red-200 → border-destructive/20
# border-red-500 → border-destructive/60
```

**Faza 2 — Success states:**

```bash
# Mapowanie:
# text-green-600  → text-status-success
# text-green-800  → text-status-success
# bg-green-100    → bg-status-success/10
# bg-green-50     → bg-status-success/5
# text-emerald-*  → text-status-success (zamiennie)
# bg-emerald-*    → bg-status-success/*
```

**Faza 3 — Warning/Info states:**

```bash
# Mapowanie:
# text-amber-500  → text-status-warning
# text-amber-800  → text-status-warning
# bg-amber-50     → bg-status-warning/5
# text-blue-600   → text-status-info
# text-blue-800   → text-status-info
# bg-blue-50      → bg-status-info/5
# bg-blue-100     → bg-status-info/10
```

### Strategia migracji: per-modul, nie atomowy PR

**Kolejnosc modulow:**

| # | Modul | Powod | Wysilekek | Pliki |
|---|-------|-------|----------|-------|
| 1 | `packages/ui/src/primitives/` | Fundament — Notice, Alert, Badge | Niski | 4 pliki |
| 2 | `packages/ui/src/backend/` | CrudForm FieldControl, FlashMessages, EmptyState | Sredni | ~10 plikow |
| 3 | `packages/core/src/modules/customers/` | Najbardziej zlozony, referencyjny modul | Sredni | ~15 plikow |
| 4 | `packages/core/src/modules/auth/` | Frontend login z hardcoded alert colors | Niski | 3 pliki |
| 5 | `packages/core/src/modules/sales/` | Status badges na dokumentach | Sredni | ~10 plikow |
| 6 | `packages/core/src/modules/portal/` | Frontend pages z hardcoded colors | Niski | 4 pliki |
| 7 | Pozostale moduly | Katalogowa migracja | Sredni | ~40 plikow |

**Jeden PR per modul.** Kazdy PR:
- Zamienia hardcoded colors na semantic tokens
- Dodaje `// DS-MIGRATED` komentarz w ostatniej linii pliku (do trackingu)
- Testowany wizualnie (screenshot before/after)

---

## E.2 Arbitrary Text Sizes (61 wystapien)

### Tabela mapowania

| Stary | Nowy | Uzasadnienie |
|-------|------|-------------|
| `text-[9px]` | `text-[9px]` (wyjątek) | Notification badge count — zbyt maly na standardową skalę, zachowac |
| `text-[10px]` | `text-xs` (12px) | Zaokraglenie w gore, czytelniejsze |
| `text-[11px]` | `text-xs` (12px) lub nowy `text-overline` | 33 wystapienia — to jest de facto "overline" pattern |
| `text-[12px]` | `text-xs` | Identyczne z text-xs |
| `text-[13px]` | `text-sm` (14px) | Zaokraglenie w gore o 1px |
| `text-[14px]` | `text-sm` | Identyczne z text-sm |
| `text-[15px]` | `text-base` (16px) lub `text-sm` | Zalezy od kontekstu |

**Opcja: dodac `text-overline` do Tailwind config:**

```css
/* globals.css - w sekcji @theme */
--font-size-overline: 0.6875rem; /* 11px */
--font-size-overline--line-height: 1rem;
```

To pozwoli zachowac `text-[11px]` jako `text-overline` bez arbitralnej wartosci.

### Lint rule

```javascript
// Blokuje text-[Npx] w nowych plikach
// Wyjatki: text-[9px] (badge count)
const BLOCKED = /\btext-\[\d+px\]/
const ALLOWED = ['text-[9px]']
```

---

## E.3 Notice → Alert Migration

### Zakres

- **Notice**: 7 plikow
- **Alert**: 18 plikow
- **ErrorNotice**: 2 pliki
- **Razem do migracji**: 9 plikow (Notice + ErrorNotice)

### Strategia: Adapter → Hard Replace

**Krok 1 (hackathon):** Deprecation notice w Notice.tsx

```typescript
// packages/ui/src/primitives/Notice.tsx
/**
 * @deprecated Use <Alert variant="error|warning|info"> instead.
 * Will be removed in v0.6.0.
 * Migration: Notice variant="error" → Alert variant="destructive"
 *            Notice variant="warning" → Alert variant="warning"
 *            Notice variant="info" → Alert variant="info"
 */
export function Notice(props: NoticeProps) {
  if (process.env.NODE_ENV === 'development') {
    console.warn('[DS] Notice is deprecated. Use Alert instead. See migration guide.')
  }
  // ... existing implementation
}
```

**Krok 2 (tydzien po hackathonie):** Migracja 7 plikow Notice → Alert

| Stary (Notice) | Nowy (Alert) |
|-----------------|-------------|
| `<Notice variant="error" title="..." message="..." />` | `<Alert variant="destructive"><AlertTitle>...</AlertTitle><AlertDescription>...</AlertDescription></Alert>` |
| `<Notice variant="warning" title="..." />` | `<Alert variant="warning"><AlertTitle>...</AlertTitle></Alert>` |
| `<Notice variant="info" message="..." />` | `<Alert variant="info"><AlertDescription>...</AlertDescription></Alert>` |
| `<Notice compact message="..." />` | `<Alert variant="info" compact><AlertDescription>...</AlertDescription></Alert>` |
| `<Notice action={<Button>...</Button>} />` | `<Alert variant="info"><AlertDescription>...<AlertAction>...</AlertAction></AlertDescription></Alert>` |
| `<ErrorNotice title="..." message="..." />` | `<Alert variant="destructive"><AlertTitle>...</AlertTitle><AlertDescription>...</AlertDescription></Alert>` |

**Krok 3 (v0.6.0):** Usuniecie Notice.tsx i ErrorNotice.tsx

### Pliki do migracji (konkretne)

**Notice (7 plikow):**
1. `packages/core/src/modules/portal/frontend/[orgSlug]/portal/signup/page.tsx`
2. `packages/core/src/modules/portal/frontend/[orgSlug]/portal/page.tsx`
3. `packages/core/src/modules/portal/frontend/[orgSlug]/portal/login/page.tsx`
4. `packages/core/src/modules/auth/frontend/login.tsx`
5. `packages/core/src/modules/audit_logs/components/AuditLogsActions.tsx`
6. `packages/core/src/modules/data_sync/backend/data-sync/page.tsx`
7. `packages/core/src/modules/data_sync/components/IntegrationScheduleTab.tsx`

**ErrorNotice (2 pliki):**
8. `packages/core/src/modules/customers/backend/customers/deals/pipeline/page.tsx`
9. `packages/core/src/modules/entities/backend/entities/user/[entityId]/page.tsx`

---

## E.4 Icon System (inline SVG → lucide-react)

### Zakres: 14 plikow z inline `<svg>`

**Mapowanie custom SVG → lucide equivalent:**

| Plik | Custom SVG | Lucide equivalent |
|------|-----------|-------------------|
| Portal `signup/page.tsx` | CheckIcon, XIcon | `Check`, `X` |
| Portal `dashboard/page.tsx` | BellIcon, WidgetIcon | `Bell`, `LayoutGrid` |
| Portal `page.tsx` | ShoppingBagIcon, UserIcon, ShieldIcon | `ShoppingBag`, `User`, `Shield` |
| `auth/lib/profile-sections.tsx` | Custom icons | Sprawdzic per-icon |
| `workflows/checkout-demo/page.tsx` | CheckIcon, decorative SVG | `Check`, `CircleCheck` |
| `workflows/definitions/[id]/page.tsx` | Flow icons | `Workflow`, `GitBranch` |
| `workflows/EdgeEditDialog.tsx` | Edge icons | `ArrowRight`, `Cable` |
| `workflows/NodeEditDialog.tsx` | Node icons | `Square`, `Circle` |
| `workflows/BusinessRulesSelector.tsx` | Rule icon | `Scale`, `Gavel` |
| `integrations/.../widget.client.tsx` | External ID icon | `ExternalLink`, `Link2` |
| `staff/team-members/page.tsx` | Team icon | `Users`, `UserPlus` |
| `staff/team-roles/page.tsx` | Role icon | `Shield`, `Key` |

**2 pliki testowe** (`__tests__/`) — SVG w mockach, nie wymagaja migracji.

### Strategia

```bash
# Znajdz wszystkie inline SVG (pomijajac testy)
rg '<svg' --type tsx -l --glob '!**/__tests__/**' packages/core/src/modules/
# 12 plikow do migracji (2 testowe pominiete)
```

Migracja per-plik. Kazdy PR zamienia inline SVG na lucide import.

---

## E.5 PR Template Update

Dodac do `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
### Design System Compliance
- [ ] No hardcoded status colors (`text-red-*`, `bg-green-*`, etc.) — use semantic tokens
- [ ] No arbitrary text sizes (`text-[Npx]`) — use typography scale
- [ ] Empty state handled for list/data pages
- [ ] Loading state handled for async pages
- [ ] `aria-label` on all icon-only buttons
- [ ] Uses existing DS components (Button, Alert, Badge) — no custom replacements
```

---

## E.6 AGENTS.md Update

Dodac do root `AGENTS.md` w sekcji `## Conventions` lub jako nowa sekcja `## Design System Rules`:

```markdown
## Design System Rules

### Colors
- NEVER use hardcoded Tailwind colors for status semantics (`text-red-*`, `bg-green-*`, etc.)
- USE semantic tokens: `text-destructive`, `bg-status-success/10`, `border-status-warning/20`
- Status colors: `destructive` (error), `status-success`, `status-warning`, `status-info`, `status-neutral`

### Typography
- NEVER use arbitrary text sizes (`text-[11px]`, `text-[13px]`)
- USE Tailwind scale: `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`
- For 11px overline pattern: use `text-overline` (custom utility)

### Feedback
- USE `Alert` for inline messages (NOT `Notice` — deprecated)
- USE `flash()` for transient toast messages
- USE `useConfirmDialog()` for destructive action confirmation
- Every list page MUST handle empty state via `<EmptyState>`
- Every async page MUST show loading via `<LoadingMessage>` or `<Spinner>`

### Icons
- USE `lucide-react` for all icons — NEVER inline `<svg>` elements
- Icon sizes: `size-3` (xs), `size-4` (sm/default), `size-5` (md), `size-6` (lg)

### Components
- USE `Button`/`IconButton` — NEVER raw `<button>`
- USE `apiCall()`/`apiCallOrThrow()` — NEVER raw `fetch()` in backend pages
- USE `StatusBadge` for entity status display — NEVER hardcoded color Badge
- USE `FormField` wrapper for standalone forms — CrudForm handles internally
- USE `SectionHeader` for collapsible detail sections
```

---

## E.7 Boy Scout Rule

**Policy:** Kazdy PR ktory dotyka pliku z hardcoded status colors MUSI zmigrować przynajmniej dotknięte linie.

**Implementacja:**
- Dodac do PR review checklist
- Dodac komentarz w AGENTS.md:

```markdown
### Boy Scout Rule (Design System)
When modifying a file that contains hardcoded status colors (text-red-*, bg-green-*, etc.),
you MUST migrate at minimum the lines you touched to semantic tokens.
Optionally migrate the entire file if scope allows.
```

- CI check (opcjonalny): skrypt porownujacy `git diff --name-only` z lista plikow zawierajacych hardcoded colors. Jesli PR dotyka pliku z listy ale nie zmniejsza count — warning.

---

# F. SUCCESS METRICS & TRACKING

## KPI Dashboard

| # | Metryka | Obecna wartosc | Target | Target date | Jak mierzyc |
|---|---------|---------------|--------|-------------|-------------|
| 1 | Hardcoded semantic colors | 372 | 0 | v0.6.0 (8 tyg.) | `rg 'text-red-\|bg-red-\|text-green-\|bg-green-\|text-emerald-\|bg-emerald-\|text-amber-\|bg-amber-\|text-blue-[0-9]\|bg-blue-[0-9]' --type tsx -c \| awk -F: '{s+=$2} END{print s}'` |
| 2 | Arbitrary text sizes | 61 | 1 (wyjątek: `text-[9px]`) | v0.6.0 | `rg 'text-\[\d+px\]' --type tsx -c \| awk -F: '{s+=$2} END{print s}'` |
| 3 | Empty state coverage | 21% (31/150) | 80% | v0.7.0 (12 tyg.) | Manual audit + grep for EmptyState/TabEmptyState imports |
| 4 | Loading state coverage | 59% (89/150) | 90% | v0.7.0 | Grep for LoadingMessage/Spinner/isLoading patterns |
| 5 | aria-label coverage | ~50% | 95% | v0.7.0 | Automated a11y scan (axe-core w Playwright) |
| 6 | Notice component usage | 7 plikow | 0 | v0.6.0 | `rg "from.*Notice" --type tsx -l \| wc -l` |
| 7 | ErrorNotice usage | 2 pliki | 0 | v0.6.0 | `rg "ErrorNotice" --type tsx -l \| wc -l` |
| 8 | Inline SVG count | 12 plikow | 0 | v0.7.0 | `rg '<svg' --type tsx -l --glob '!**/__tests__/**' \| wc -l` |
| 9 | Raw fetch() count | 8 | 0 | v0.7.0 | `rg 'fetch\(' --type tsx --glob '**/backend/**' -l \| wc -l` |
| 10 | StatusBadge adoption | 0 | 100% status displays | v0.7.0 | Manual audit |

## Skrypt raportujacy

```bash
#!/bin/bash
# ds-health-check.sh — uruchamiac co sprint
# Uzycie: bash .ai/scripts/ds-health-check.sh

echo "=== DESIGN SYSTEM HEALTH CHECK ==="
echo "Date: $(date +%Y-%m-%d)"
echo ""

echo "--- Hardcoded Status Colors ---"
HC=$(rg 'text-red-[0-9]|bg-red-[0-9]|border-red-[0-9]|text-green-[0-9]|bg-green-[0-9]|border-green-[0-9]|text-emerald-[0-9]|bg-emerald-[0-9]|border-emerald-[0-9]|text-amber-[0-9]|bg-amber-[0-9]|border-amber-[0-9]|text-blue-[0-9]|bg-blue-[0-9]|border-blue-[0-9]' \
  --type tsx --glob '!**/__tests__/**' --glob '!**/node_modules/**' -c 2>/dev/null | \
  awk -F: '{s+=$2} END{print s+0}')
echo "  Count: $HC (target: 0)"

echo ""
echo "--- Arbitrary Text Sizes ---"
AT=$(rg 'text-\[\d+px\]' --type tsx --glob '!**/__tests__/**' -c 2>/dev/null | \
  awk -F: '{s+=$2} END{print s+0}')
echo "  Count: $AT (target: 1)"

echo ""
echo "--- Deprecated Notice Usage ---"
NC=$(rg "from.*primitives/Notice" --type tsx -l 2>/dev/null | wc -l | tr -d ' ')
echo "  Notice imports: $NC (target: 0)"
EN=$(rg "ErrorNotice" --type tsx -l 2>/dev/null | wc -l | tr -d ' ')
echo "  ErrorNotice imports: $EN (target: 0)"

echo ""
echo "--- Inline SVG ---"
SVG=$(rg '<svg' --type tsx --glob '!**/__tests__/**' --glob '!**/node_modules/**' -l 2>/dev/null | wc -l | tr -d ' ')
echo "  Files with inline SVG: $SVG (target: 0)"

echo ""
echo "--- Raw fetch() in Backend ---"
RF=$(rg 'fetch\(' --type tsx --glob '**/backend/**' --glob '!**/node_modules/**' -l 2>/dev/null | wc -l | tr -d ' ')
echo "  Raw fetch files: $RF (target: 0)"

echo ""
echo "--- Empty State Coverage ---"
PAGES=$(find packages/core/src/modules/*/backend -name "page.tsx" 2>/dev/null | wc -l | tr -d ' ')
ES=$(rg 'EmptyState|TabEmptyState' --type tsx --glob '**/backend/**/page.tsx' -l 2>/dev/null | wc -l | tr -d ' ')
echo "  Pages with empty state: $ES / $PAGES ($(( ES * 100 / PAGES ))%)"

echo ""
echo "--- Loading State Coverage ---"
LS=$(rg 'LoadingMessage|isLoading|Spinner' --type tsx --glob '**/backend/**/page.tsx' -l 2>/dev/null | wc -l | tr -d ' ')
echo "  Pages with loading state: $LS / $PAGES ($(( LS * 100 / PAGES ))%)"

echo ""
echo "=== END REPORT ==="
```

**Tracking cadence:** Uruchamiac na poczatku kazdego sprintu. Wyniki wklejac do sprint review.

---

# G. COMPONENT API PROPOSALS

## G.1 FormField

### TypeScript Interface

```typescript
import type { ReactNode } from 'react'

export type FormFieldProps = {
  /** Visible label text. If omitted, field is label-less (aria-label should be on input). */
  label?: string
  /** Auto-generated if not provided. Links label → input via htmlFor/id. */
  id?: string
  /** Show required indicator (*) next to label */
  required?: boolean
  /** Help text below input */
  description?: ReactNode
  /** Error message below input (replaces description when present) */
  error?: string
  /** Layout direction */
  orientation?: 'vertical' | 'horizontal'
  /** Disabled state — propagates to label styling */
  disabled?: boolean
  /** Additional className on root wrapper */
  className?: string
  /** The input element (slot) */
  children: ReactNode
}
```

### Przyklady uzycia

**Default (vertical):**
```tsx
<FormField label="Email" required error={errors.email}>
  <Input
    type="email"
    value={email}
    onChange={(e) => setEmail(e.target.value)}
  />
</FormField>
```

**Horizontal layout:**
```tsx
<FormField label="Active" orientation="horizontal">
  <Switch checked={isActive} onCheckedChange={setIsActive} />
</FormField>
```

**With description:**
```tsx
<FormField
  label="API Key"
  description="Your API key is used for authentication. Keep it secret."
  error={errors.apiKey}
>
  <Input type="password" value={apiKey} onChange={...} />
</FormField>
```

**Without label (custom input):**
```tsx
<FormField error={errors.color}>
  <ColorPicker value={color} onChange={setColor} aria-label="Pick a color" />
</FormField>
```

### Implementacja — auto-generated id

```typescript
const generatedId = React.useId()
const fieldId = props.id ?? generatedId
const descriptionId = props.description ? `${fieldId}-desc` : undefined
const errorId = props.error ? `${fieldId}-error` : undefined

// Clones child to inject id, aria-describedby, aria-invalid
const child = React.cloneElement(children, {
  id: fieldId,
  'aria-describedby': [descriptionId, errorId].filter(Boolean).join(' ') || undefined,
  'aria-invalid': !!props.error,
  'aria-required': props.required,
})
```

### Relacja z CrudForm

- CrudForm **NIE uzywa** FormField — ma wlasny wbudowany `FieldControl` (linia 3367 CrudForm.tsx)
- FormField jest przeznaczony do **standalone forms** (portal, auth, custom pages)
- Dlugoterminowo: CrudForm moze byc refaktorowany zeby uzywac FormField wewnetrznie, ale to nie jest cel hackathonu
- **Brak duplikacji logiki** — FormField jest prosty wrapper, CrudForm FieldControl obsluguje tez loadOptions, field types, validation triggers

### Storybook stories

1. `Default` — label + input + submit
2. `Required` — z gwiazdka
3. `WithError` — error message visible
4. `WithDescription` — help text
5. `Horizontal` — switch/checkbox layout
6. `Disabled` — disabled state
7. `WithoutLabel` — custom input z aria-label
8. `Composed` — kilka FormField w formularzu

### Test cases

- Unit: renders label, links htmlFor→id, shows error, shows description, hides description when error present
- Unit: auto-generates id when not provided
- Unit: injects aria-describedby, aria-invalid on child
- Unit: horizontal orientation renders flex-row
- a11y: axe-core passes on all variants

### Accessibility checklist

- [ ] Label linked to input via htmlFor/id
- [ ] `aria-describedby` links input to description/error
- [ ] `aria-invalid="true"` when error present
- [ ] `aria-required="true"` when required
- [ ] Error message has `role="alert"`
- [ ] Required indicator is visible AND communicated to screen readers

---

## G.2 StatusBadge

### TypeScript Interface

```typescript
import type { ReactNode } from 'react'

export type StatusBadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral'

export type StatusBadgeProps = {
  /** Visual variant — maps to semantic color tokens */
  variant: StatusBadgeVariant
  /** Badge text */
  children: ReactNode
  /** Show colored dot before text */
  dot?: boolean
  /** Additional className */
  className?: string
}

/**
 * Helper: map arbitrary status string to variant.
 * Modules define their own mapping.
 */
export type StatusMap<T extends string = string> = Record<T, StatusBadgeVariant>
```

### Mapowanie status → variant → color token

```typescript
const variantStyles: Record<StatusBadgeVariant, string> = {
  success: 'border-status-success/30 bg-status-success/10 text-status-success',
  warning: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  error:   'border-status-error/30 bg-status-error/10 text-status-error',
  info:    'border-status-info/30 bg-status-info/10 text-status-info',
  neutral: 'border-border bg-muted text-muted-foreground',
}
```

### Jak moduly definiuja statusy

Kazdy modul definiuje swoj `StatusMap`:

```typescript
// packages/core/src/modules/customers/lib/status.ts
import type { StatusMap } from '@open-mercato/ui/primitives/status-badge'

export const personStatusMap: StatusMap<'active' | 'inactive' | 'archived'> = {
  active: 'success',
  inactive: 'neutral',
  archived: 'warning',
}

// Uzycie w komponencie:
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { personStatusMap } from '../lib/status'

<StatusBadge variant={personStatusMap[person.status]} dot>
  {t(`customers.status.${person.status}`)}
</StatusBadge>
```

**Przyklady per-modul:**

```typescript
// Sales documents
const documentStatusMap: StatusMap = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'success',
  rejected: 'error',
  expired: 'warning',
}

// Currencies
const currencyStatusMap: StatusMap = {
  active: 'success',
  inactive: 'neutral',
  base: 'info',
}

// Workflows
const workflowStatusMap: StatusMap = {
  running: 'info',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
  pending: 'neutral',
}
```

### Unknown/custom statusy

```typescript
// Fallback dla nieznanych statusow:
<StatusBadge variant={statusMap[status] ?? 'neutral'}>
  {status}
</StatusBadge>
```

### Storybook stories

1. `AllVariants` — success, warning, error, info, neutral
2. `WithDot` — dot indicator
3. `WithStatusMap` — przyklad z personStatusMap
4. `Unknown` — fallback do neutral

### Test cases

- Unit: renders correct variant classes
- Unit: renders dot when `dot={true}`
- Unit: renders children text
- a11y: sufficient contrast for all variants in light + dark mode

### Accessibility checklist

- [ ] Text has sufficient contrast (AA minimum) on colored background
- [ ] Dark mode colors maintain contrast
- [ ] Dot is decorative (`aria-hidden="true"`)

---

## G.3 SectionHeader

### TypeScript Interface

```typescript
import type { ReactNode } from 'react'

export type SectionHeaderProps = {
  /** Section title */
  title: string
  /** Optional item count badge */
  count?: number
  /** Action button(s) on the right */
  action?: ReactNode
  /** Enable collapse/expand */
  collapsible?: boolean
  /** Controlled collapsed state */
  collapsed?: boolean
  /** Callback when collapse state changes */
  onCollapsedChange?: (collapsed: boolean) => void
  /** Default collapsed state (uncontrolled) */
  defaultCollapsed?: boolean
  /** Additional className */
  className?: string
}

export type SectionProps = {
  /** Section header props (or custom header via children) */
  header: SectionHeaderProps
  /** Empty state — rendered when children is null/empty */
  emptyState?: {
    title: string
    description?: string
    action?: { label: string; onClick: () => void }
  }
  /** Section content */
  children?: ReactNode
  /** Additional className on content wrapper */
  contentClassName?: string
}
```

### Przyklady uzycia

**Z akcja:**
```tsx
<Section
  header={{ title: 'Tags', count: tags.length, action: <Button variant="ghost" size="sm" onClick={addTag}>Add</Button> }}
  emptyState={{ title: 'No tags', description: 'Add tags to organize this record' }}
>
  {tags.map(tag => <TagChip key={tag.id} tag={tag} />)}
</Section>
```

**Z collapse:**
```tsx
<Section
  header={{ title: 'Activities', count: 12, collapsible: true, defaultCollapsed: false }}
>
  <ActivitiesList items={activities} />
</Section>
```

**Bez akcji (prosty):**
```tsx
<Section header={{ title: 'Custom Data' }}>
  <CustomFieldsGrid fields={fields} />
</Section>
```

### Jak zastepuje 15+ istniejacych sekcji

| Obecny komponent | Zmiana |
|-----------------|--------|
| `TagsSection` | `<Section header={{ title, count, action }}>` + tag content |
| `ActivitiesSection` | `<Section header={{ title, count, collapsible }}>` + activity list |
| `AddressesSection` | `<Section header={{ title, count, action }}>` + address tiles |
| `DealsSection` | `<Section header={{ title, count }}>` + deal cards |
| `CustomDataSection` | `<Section header={{ title }}>` + custom fields |
| `TasksSection` | `<Section header={{ title, count, action }}>` + task list |
| `CompanyPeopleSection` | `<Section header={{ title, count }}>` + people list |
| Sales `ItemsSection` | `<Section header={{ title, count, action }}>` + line items table |
| Sales `PaymentsSection` | `<Section header={{ title, count }}>` + payments list |
| Sales `ShipmentsSection` | `<Section header={{ title, count }}>` + shipments list |

**Nie trzeba migrować od razu** — sekcje moga byc refaktorowane przy okazji (Boy Scout Rule). SectionHeader jest composition pattern: header jest nowy, content pozostaje wlasnoscia modulu.

### Storybook stories

1. `Default` — title only
2. `WithCount` — title + count badge
3. `WithAction` — title + action button
4. `Collapsible` — expand/collapse
5. `CollapsedByDefault` — starts collapsed
6. `WithEmptyState` — no children, empty state visible
7. `FullExample` — all features combined

### Test cases

- Unit: renders title, count badge, action
- Unit: collapse toggle works (click → hide content)
- Unit: empty state renders when no children
- Unit: controlled collapsed state
- a11y: collapsible uses `aria-expanded`

### Accessibility checklist

- [ ] Title is semantic heading (`<h3>` or `role="heading"`)
- [ ] Collapse button has `aria-expanded`
- [ ] Collapse button has descriptive `aria-label` ("Collapse Tags section")
- [ ] Count is communicated to screen readers

---

## G.4 Alert (unified)

### TypeScript Interface (nowa wersja)

```typescript
import type { ReactNode } from 'react'

export type AlertVariant = 'default' | 'destructive' | 'success' | 'warning' | 'info'

export type AlertProps = {
  variant?: AlertVariant
  /** Compact mode — less padding, no icon */
  compact?: boolean
  /** Dismissible — shows close button */
  dismissible?: boolean
  /** Callback when dismissed */
  onDismiss?: () => void
  /** Additional className */
  className?: string
  /** Role override — default: "alert" for destructive/warning, "status" for others */
  role?: 'alert' | 'status'
  children: ReactNode
}

// Sub-components (composition pattern):
export type AlertTitleProps = React.HTMLAttributes<HTMLHeadingElement>
export type AlertDescriptionProps = React.HTMLAttributes<HTMLParagraphElement>
export type AlertActionProps = { children: ReactNode; className?: string }
```

### Migration guide: stary API → nowy API

| Stary (Notice) | Nowy (Alert) | Uwagi |
|-----------------|-------------|-------|
| `variant="error"` | `variant="destructive"` | Nazwa alignowana z Button |
| `variant="info"` | `variant="info"` | Bez zmian |
| `variant="warning"` | `variant="warning"` | Bez zmian |
| `title="..."` | `<AlertTitle>...</AlertTitle>` | Composition pattern |
| `message="..."` | `<AlertDescription>...</AlertDescription>` | Composition pattern |
| `action={<Button>}` | `<AlertAction><Button></AlertAction>` | Explicit slot |
| `compact` | `compact` | Zachowany prop |
| `children` | `children` | Zachowany — renders inside AlertDescription |

| Stary (ErrorNotice) | Nowy (Alert) | Uwagi |
|----------------------|-------------|-------|
| `<ErrorNotice />` | `<Alert variant="destructive"><AlertTitle>{defaultTitle}</AlertTitle><AlertDescription>{defaultMsg}</AlertDescription></Alert>` | Defaults trzeba explicit |
| `title="X" message="Y"` | `<Alert variant="destructive"><AlertTitle>X</AlertTitle><AlertDescription>Y</AlertDescription></Alert>` | 1:1 mapping |
| `action={btn}` | `<AlertAction>{btn}</AlertAction>` | Explicit slot |

### Backward compatibility

**Podejscie: backward compatible z deprecation warnings.**

Alert juz istnieje z 5 wariantami. Zmiany:
1. **Dodac** `compact` prop (nowy, additive)
2. **Dodac** `dismissible` + `onDismiss` props (nowy, additive)
3. **Dodac** `AlertAction` sub-component (nowy, additive)
4. **Zmiana kolorow** Alert na semantic tokens (visual change, nie API change)

**NIE jest breaking change** — istniejace uzycia Alert dzialaja bez zmian. Tylko Notice jest deprecated.

### Dismissible behavior

```typescript
const [visible, setVisible] = React.useState(true)

if (!visible) return null

return (
  <div role={role} className={cn(alertVariants({ variant }), className)}>
    {/* ... content ... */}
    {dismissible && (
      <IconButton
        variant="ghost"
        size="xs"
        aria-label="Dismiss"
        onClick={() => { setVisible(false); onDismiss?.() }}
        className="absolute top-2 right-2"
      >
        <X className="size-3" />
      </IconButton>
    )}
  </div>
)
```

### Color tokens (semantic, zamiast hardcoded)

```typescript
const alertVariants = cva('...base...', {
  variants: {
    variant: {
      default:     'border-border bg-card text-card-foreground',
      destructive: 'border-status-error/30 bg-status-error/5 text-status-error [&_svg]:text-status-error',
      success:     'border-status-success/30 bg-status-success/5 text-status-success [&_svg]:text-status-success',
      warning:     'border-status-warning/30 bg-status-warning/5 text-status-warning [&_svg]:text-status-warning',
      info:        'border-status-info/30 bg-status-info/5 text-status-info [&_svg]:text-status-info',
    },
  },
})
```

### Storybook stories

1. `Default` — neutral alert
2. `Destructive` — error state
3. `Success` — success state
4. `Warning` — warning state
5. `Info` — informational
6. `WithTitle` — title + description
7. `WithAction` — z action button
8. `Dismissible` — close button
9. `Compact` — compact mode
10. `MigrationFromNotice` — side-by-side old Notice vs new Alert

### Test cases

- Unit: renders all 5 variants
- Unit: renders title, description, action
- Unit: dismissible — click close → hidden
- Unit: compact mode — smaller padding
- Unit: correct role attribute per variant
- a11y: `role="alert"` for destructive/warning, `role="status"` for info/success

### Accessibility checklist

- [ ] `role="alert"` for destructive and warning (announced immediately)
- [ ] `role="status"` for info and success (polite announcement)
- [ ] Dismiss button has `aria-label="Dismiss"`
- [ ] Icon is `aria-hidden="true"` (decorative)
- [ ] Contrast ratio meets AA for all variants in light + dark mode

---

# H. MIGRATION RISK ANALYSIS

## Risk 1: Breaking changes w Alert/Notice unification

| | |
|---|---|
| **Opis** | 7 plikow importuje Notice, 2 importuja ErrorNotice. Zmiana API wymaga edycji tych plikow. Contributorzy moga miec otwarte PR-y uzywajace Notice. |
| **Prawdopodobienstwo** | Niskie — Notice jest uzywane w 9 plikach, malo popularne |
| **Impact** | Niski — migration jest mechaniczna, 1:1 prop mapping |
| **Mitigation** | 1. Deprecation warning w Notice (nie usuwamy od razu). 2. Notice wrapper wewnetrznie deleguje do Alert (backward compatible). 3. Migration guide w PR description. 4. 2 minorowe wersje z deprecation zanim usunac. |
| **Rollback** | Przywrocic Notice.tsx — git revert. Zero data loss, zero runtime risk. |

## Risk 2: Semantic tokens z zlym kontrastem w dark mode

| | |
|---|---|
| **Opis** | OKLCH kolory sa trudne do manualnego sprawdzenia pod katem kontrastu. Nowe semantic tokens moga miec niewystarczajacy kontrast w dark mode. |
| **Prawdopodobienstwo** | Srednie — OKLCH jest perceptually uniform, ale opacity-based tokens (`bg-status-error/5`) moga nie dzialac na ciemnym tle |
| **Impact** | Wysoki — nieczytelne alerty/badges w dark mode |
| **Mitigation** | 1. Testowac KAZDY token w light + dark mode przed merge. 2. Uzyc narzedzia: Chrome DevTools Color Contrast checker, axe-core automated scan. 3. Dla opacity-based tokens: zdefiniowac oddzielne wartosci dla dark mode zamiast polegac na opacity. 4. Screenshot comparison light vs dark dla kazdego komponentu. |
| **Rollback** | Zmiana CSS custom properties — natychmiastowa, zero kodu do revertowania. |

**Konkretne ryzyko z opacity:**

```css
/* Problem: bg-status-error/5 na ciemnym tle jest prawie niewidoczne */
/* Light: rgba(239,68,68,0.05) na bialym → subtlny rozowy */
/* Dark: rgba(239,68,68,0.05) na czarnym → prawie niewidoczny */

/* Rozwiazanie: dedykowane dark mode wartosci */
.dark {
  --color-status-error-bg: oklch(0.3 0.08 25);    /* ciemny czerwony */
  --color-status-success-bg: oklch(0.3 0.08 145);  /* ciemny zielony */
  --color-status-warning-bg: oklch(0.3 0.08 80);   /* ciemny zolty */
  --color-status-info-bg: oklch(0.3 0.08 240);     /* ciemny niebieski */
}
```

## Risk 3: 372 color migrations — regresja wizualna

| | |
|---|---|
| **Opis** | Zamiana 372 hardcoded kolorow na semantic tokens moze spowodowac nieoczekiwane zmiany wizualne. Rozne odcienie (red-500 vs red-600 vs red-700) sa zamieniane na jeden token. |
| **Prawdopodobienstwo** | Srednie — wiekszosc zamian jest 1:1, ale niuanse (np. red-800 uzywane swiadomie jako ciemniejszy wariant) moga zniknac |
| **Impact** | Sredni — zmiany wizualne, nie funkcjonalne |
| **Mitigation** | 1. Migracja per-modul (nie atomowy PR) — latwiejszy review. 2. Screenshot before/after dla kazdego PR. 3. Reviewer musi potwierdzic ze wizualnie wyglada dobrze. 4. Dla niuansow (swiadome uzycie red-800): dodac komentarz `/* intentional: darker shade for X */` i uzyc token z modyfikatorem (np. `text-status-error dark:text-status-error-emphasis`). |
| **Rollback** | Git revert per-modul PR. |

**Narzedzia do visual regression:**
- Playwright screenshot comparison (juz jest w stacku)
- Manual review w PR (screenshot before/after jako attachment)
- Opcjonalnie: Chromatic / Percy dla automatycznego visual diff (koszt)

## Risk 4: External contributor confusion

| | |
|---|---|
| **Opis** | Contributorzy z otwartymi PR-ami moga uzywac starego API (Notice, hardcoded colors). Po merge DS changes ich PR-y beda mialy conflicty lub lint errors. |
| **Prawdopodobienstwo** | Srednie — zalezy od ilosci aktywnych PR-ow |
| **Impact** | Sredni — frustracja contributorow, dluszy czas merge |
| **Mitigation** | 1. **Changelog entry** w PR z DS changes — jasny opis co sie zmienilo. 2. **Migration guide** w `MIGRATION.md` lub sekcja w AGENTS.md. 3. **Deprecation warnings** (nie hard breaks) przez 2 minorowe wersje. 4. **GitHub Discussion / Issue** announcing DS changes before hackathon. 5. Lint rules jako `warn` (nie `error`) przez pierwszy sprint. |
| **Rollback** | N/A — to jest communication risk, nie technical. |

## Risk 5: CrudForm coupling

| | |
|---|---|
| **Opis** | FormField wrapper i CrudForm FieldControl robia podobne rzeczy (label + input + error). Ryzyko ze logika zacznie sie rozjezdzac. |
| **Prawdopodobienstwo** | Niskie — FormField jest prosty wrapper (zero logiki walidacji), CrudForm FieldControl jest complex (loadOptions, field types, validation triggers) |
| **Impact** | Sredni — niespojny styl formularzy miedzy CrudForm a standalone forms |
| **Mitigation** | 1. FormField **NIE duplikuje** logiki CrudForm — jest pure layout wrapper. 2. CrudForm zachowuje wlasny FieldControl. 3. Wspolne elementy (label style, error style) wyciagniete do **shared CSS classes** lub **shared sub-components** (np. `FieldLabel`, `FieldError`). 4. Dlugoterminowo (v1.0): CrudForm moze byc refaktorowany zeby uzywac FormField wewnetrznie. |
| **Rollback** | N/A — FormField jest additive, nie zmienia CrudForm. |

**Architektura docelowa:**

```
FormField (layout wrapper)
  ├── FieldLabel (shared)
  ├── {children} (input slot)
  ├── FieldDescription (shared)
  └── FieldError (shared)

CrudForm FieldControl (logic wrapper)
  ├── FieldLabel (shared)       ← te same sub-components
  ├── {field type renderer}
  ├── FieldDescription (shared) ← te same sub-components
  └── FieldError (shared)       ← te same sub-components
```

## Risk 6: Performance — duze komponenty

| | |
|---|---|
| **Opis** | AppShell (1650 linii), CrudForm (1800 linii), DataTable (1000+ linii). Refaktory DS (np. zmiana kolorow, dodanie tokenow) w tych plikach moga wplynac na render performance. |
| **Prawdopodobienstwo** | Niskie — zmiany sa CSS-only (klasy Tailwind), nie logika render |
| **Impact** | Niski — Tailwind classes sa resolved at build time, nie runtime |
| **Mitigation** | 1. DS hackathon **NIE refaktoruje** AppShell/CrudForm/DataTable — zmienia tylko CSS klasy. 2. Wieksze refaktory (np. extraction SectionHeader z CrudForm) dopiero w fazie 2 z performance benchmarkiem. 3. React DevTools Profiler przed i po zmianach. 4. `React.memo` juz uzywane na FieldControl — zachowac. |
| **Rollback** | CSS class changes sa trivial do revert. |

---

## Risk Matrix — Podsumowanie

| Risk | Prawdop. | Impact | Overall | Priorytet mitigation |
|------|----------|--------|---------|---------------------|
| R1: Alert/Notice breaking | Niskie | Niski | **Niski** | Deprecation path |
| R2: Dark mode contrast | Srednie | Wysoki | **Wysoki** | Test every token |
| R3: Visual regression | Srednie | Sredni | **Sredni** | Per-module PR + screenshots |
| R4: Contributor confusion | Srednie | Sredni | **Sredni** | Communication plan |
| R5: CrudForm coupling | Niskie | Sredni | **Niski** | Shared sub-components |
| R6: Performance | Niskie | Niski | **Niski** | CSS-only changes |

**Top risk requiring immediate action:** R2 (dark mode contrast) — musi byc testowany na hackathonie ZANIM merge tokenow.

---

---

# I. CONCRETE TOKEN VALUES (DRAFT)

## Kontekst istniejącej palety

Projekt używa OKLCH color space. Kluczowe istniejące wartości referencyjne:

```
Light:  --background: oklch(1 0 0)          /* biały */
        --foreground: oklch(0.145 0 0)       /* prawie czarny */
        --card:       oklch(1 0 0)           /* biały */
        --destructive: oklch(0.577 0.245 27.325) /* czerwony */
        --muted:      oklch(0.97 0 0)        /* jasnoszary */
        --border:     oklch(0.922 0 0)       /* szary border */

Dark:   --background: oklch(0.145 0 0)       /* prawie czarny */
        --foreground: oklch(0.985 0 0)       /* prawie biały */
        --card:       oklch(0.205 0 0)       /* ciemnoszary */
        --destructive: oklch(0.704 0.191 22.216)  /* jasniejszy czerwony */
        --muted:      oklch(0.269 0 0)       /* ciemnoszary */
        --border:     oklch(1 0 0 / 10%)     /* biały 10% */
```

## Zasady projektowania tokenów

1. **Hue angles** zaczerpnięte z istniejących chart colors (spójność palety):
   - Error: ~25° (hue z `--destructive` = 27.325°, `--chart-rose` = 16.439°)
   - Success: ~160° (hue z `--chart-emerald` = 163.225°)
   - Warning: ~80° (hue z `--chart-amber` = 70.08°, `--chart-4` = 84.429°)
   - Info: ~260° (hue z `--chart-blue` = 262.881°)

2. **Lightness ranges:**
   - Light mode bg: L=0.95-0.97 (subtle, prawie biały z odcieniem)
   - Light mode text: L=0.30-0.40 (ciemny, kontrastowy)
   - Light mode border: L=0.80-0.85 (pośredni)
   - Light mode icon: L=0.55-0.65 (nasycony, widoczny)
   - Dark mode bg: L=0.20-0.25 (subtle, ciemny z odcieniem)
   - Dark mode text: L=0.80-0.90 (jasny, kontrastowy)
   - Dark mode border: L=0.35-0.45 (pośredni)
   - Dark mode icon: L=0.65-0.75 (nasycony, widoczny)

3. **Chroma (saturation):**
   - bg: niska (0.01-0.03) — subtlny odcień, nie krzyczy
   - text: średnia (0.06-0.12) — wyraźny kolor, czytelny
   - border: niska-średnia (0.04-0.08)
   - icon: wysoka (0.12-0.20) — wyrazisty, przyciąga wzrok

## Proponowane wartości — Light Mode

```css
:root {
  /* ═══ ERROR (hue ~25°) ═══ */
  --status-error-bg:     oklch(0.965 0.015 25);
  --status-error-text:   oklch(0.365 0.120 25);
  --status-error-border: oklch(0.830 0.060 25);
  --status-error-icon:   oklch(0.577 0.245 27.325); /* = istniejące --destructive */

  /* ═══ SUCCESS (hue ~160°) ═══ */
  --status-success-bg:     oklch(0.965 0.015 160);
  --status-success-text:   oklch(0.350 0.080 160);
  --status-success-border: oklch(0.830 0.050 160);
  --status-success-icon:   oklch(0.596 0.145 163.225); /* ≈ --chart-emerald */

  /* ═══ WARNING (hue ~80°) ═══ */
  --status-warning-bg:     oklch(0.970 0.020 80);
  --status-warning-text:   oklch(0.370 0.090 60);  /* hue shift do 60° — cieplejszy, czytelniejszy */
  --status-warning-border: oklch(0.830 0.070 80);
  --status-warning-icon:   oklch(0.700 0.160 70);

  /* ═══ INFO (hue ~260°) ═══ */
  --status-info-bg:     oklch(0.965 0.015 260);
  --status-info-text:   oklch(0.370 0.100 260);
  --status-info-border: oklch(0.830 0.060 260);
  --status-info-icon:   oklch(0.546 0.245 262.881); /* = --chart-blue */

  /* ═══ NEUTRAL (achromatic) ═══ */
  --status-neutral-bg:     oklch(0.965 0 0);     /* ≈ --muted */
  --status-neutral-text:   oklch(0.445 0 0);
  --status-neutral-border: oklch(0.850 0 0);
  --status-neutral-icon:   oklch(0.556 0 0);     /* = --muted-foreground */
}
```

## Proponowane wartości — Dark Mode

```css
.dark {
  /* ═══ ERROR (hue ~25°) ═══ */
  --status-error-bg:     oklch(0.220 0.025 25);
  --status-error-text:   oklch(0.850 0.090 25);
  --status-error-border: oklch(0.400 0.060 25);
  --status-error-icon:   oklch(0.704 0.191 22.216); /* = istniejące dark --destructive */

  /* ═══ SUCCESS (hue ~160°) ═══ */
  --status-success-bg:     oklch(0.220 0.025 160);
  --status-success-text:   oklch(0.850 0.080 160);
  --status-success-border: oklch(0.400 0.050 160);
  --status-success-icon:   oklch(0.696 0.170 162.480); /* = dark --chart-emerald */

  /* ═══ WARNING (hue ~80°) ═══ */
  --status-warning-bg:     oklch(0.225 0.025 80);
  --status-warning-text:   oklch(0.870 0.080 80);
  --status-warning-border: oklch(0.420 0.060 80);
  --status-warning-icon:   oklch(0.820 0.160 84.429); /* = dark --chart-amber */

  /* ═══ INFO (hue ~260°) ═══ */
  --status-info-bg:     oklch(0.220 0.025 260);
  --status-info-text:   oklch(0.840 0.080 260);
  --status-info-border: oklch(0.400 0.060 260);
  --status-info-icon:   oklch(0.623 0.214 259.815); /* = dark --chart-blue */

  /* ═══ NEUTRAL (achromatic) ═══ */
  --status-neutral-bg:     oklch(0.230 0 0);
  --status-neutral-text:   oklch(0.750 0 0);
  --status-neutral-border: oklch(0.380 0 0);
  --status-neutral-icon:   oklch(0.708 0 0);     /* = dark --muted-foreground */
}
```

## Contrast Ratio — Light Mode

| Para | Text L | Bg L | Estimated CR | WCAG AA (4.5:1) | WCAG AAA (7:1) |
|------|--------|------|-------------|-----------------|----------------|
| error text / error bg | 0.365 / 0.965 | ~7.0:1 | PASS | PASS |
| error text / white bg | 0.365 / 1.000 | ~7.5:1 | PASS | PASS |
| error text / card bg | 0.365 / 1.000 | ~7.5:1 | PASS | PASS |
| success text / success bg | 0.350 / 0.965 | ~7.5:1 | PASS | PASS |
| success text / white bg | 0.350 / 1.000 | ~8.0:1 | PASS | PASS |
| warning text / warning bg | 0.370 / 0.970 | ~6.8:1 | PASS | BORDERLINE |
| warning text / white bg | 0.370 / 1.000 | ~7.2:1 | PASS | PASS |
| info text / info bg | 0.370 / 0.965 | ~6.8:1 | PASS | BORDERLINE |
| info text / white bg | 0.370 / 1.000 | ~7.2:1 | PASS | PASS |
| neutral text / neutral bg | 0.445 / 0.965 | ~4.7:1 | PASS | FAIL |
| neutral text / white bg | 0.445 / 1.000 | ~5.0:1 | PASS | FAIL |

## Contrast Ratio — Dark Mode

| Para | Text L | Bg L | Estimated CR | WCAG AA (4.5:1) | WCAG AAA (7:1) |
|------|--------|------|-------------|-----------------|----------------|
| error text / error bg | 0.850 / 0.220 | ~6.5:1 | PASS | BORDERLINE |
| error text / card bg | 0.850 / 0.205 | ~7.0:1 | PASS | PASS |
| success text / success bg | 0.850 / 0.220 | ~6.5:1 | PASS | BORDERLINE |
| success text / card bg | 0.850 / 0.205 | ~7.0:1 | PASS | PASS |
| warning text / warning bg | 0.870 / 0.225 | ~6.5:1 | PASS | BORDERLINE |
| warning text / card bg | 0.870 / 0.205 | ~7.5:1 | PASS | PASS |
| info text / info bg | 0.840 / 0.220 | ~6.3:1 | PASS | BORDERLINE |
| info text / card bg | 0.840 / 0.205 | ~7.0:1 | PASS | PASS |
| neutral text / neutral bg | 0.750 / 0.230 | ~5.0:1 | PASS | FAIL |
| neutral text / card bg | 0.750 / 0.205 | ~5.5:1 | PASS | FAIL |

> **Uwaga:** Contrast ratio w OKLCH jest szacunkowy (L nie jest liniowe jak w sRGB). Finalne wartości MUSZĄ być zweryfikowane w Chrome DevTools po implementacji. Wszystkie pary text/bg zdają WCAG AA. Dla AAA na kolorowym tle — borderline. Na neutralnym tle (card, background) — wszystkie zdają AAA oprócz neutral.

## Integracja z Tailwind v4

```css
/* globals.css — w sekcji @theme inline */
@theme inline {
  --color-status-error-bg: var(--status-error-bg);
  --color-status-error-text: var(--status-error-text);
  --color-status-error-border: var(--status-error-border);
  --color-status-error-icon: var(--status-error-icon);

  --color-status-success-bg: var(--status-success-bg);
  --color-status-success-text: var(--status-success-text);
  --color-status-success-border: var(--status-success-border);
  --color-status-success-icon: var(--status-success-icon);

  --color-status-warning-bg: var(--status-warning-bg);
  --color-status-warning-text: var(--status-warning-text);
  --color-status-warning-border: var(--status-warning-border);
  --color-status-warning-icon: var(--status-warning-icon);

  --color-status-info-bg: var(--status-info-bg);
  --color-status-info-text: var(--status-info-text);
  --color-status-info-border: var(--status-info-border);
  --color-status-info-icon: var(--status-info-icon);

  --color-status-neutral-bg: var(--status-neutral-bg);
  --color-status-neutral-text: var(--status-neutral-text);
  --color-status-neutral-border: var(--status-neutral-border);
  --color-status-neutral-icon: var(--status-neutral-icon);
}
```

**Użycie w komponentach:**

```tsx
// Zamiast: className="border-red-200 bg-red-50 text-red-800"
// Teraz:   className="border-status-error-border bg-status-error-bg text-status-error-text"

// Zamiast: className="border-emerald-200 bg-emerald-50 text-emerald-900"
// Teraz:   className="border-status-success-border bg-status-success-bg text-status-success-text"
```

## Weryfikacja przed merge — obowiązkowa checklist

- [ ] Wszystkie pary text/bg sprawdzone w Chrome DevTools → Contrast ratio
- [ ] Light mode: screenshot AlertError, AlertSuccess, AlertWarning, AlertInfo, AlertNeutral
- [ ] Dark mode: screenshot AlertError, AlertSuccess, AlertWarning, AlertInfo, AlertNeutral
- [ ] Badge w light mode: StatusBadge all variants
- [ ] Badge w dark mode: StatusBadge all variants
- [ ] Flash message w obu trybach
- [ ] Text on `--background` (page) + `--card` (card) + status bg — 3 konteksty

---

# J. MIGRATION MAPPING TABLES

## J.1 Typography Mapping

### Tabela zamiany

| Obecne | Zastąp na | Kontekst | Plików | Typ zamiany |
|--------|-----------|----------|--------|-------------|
| `text-[9px]` | `text-[9px]` (ZACHOWAJ) | Notification badge count — 9px jest poniżej minimalnej skali. Jedyne użycie, wyjątek. | 1 | Brak |
| `text-[10px]` | `text-xs` (12px) | Badge small, compact labels. 2px różnicy jest akceptowalna — zyskujemy spójność. | 15 | Regex: `s/text-\[10px\]/text-xs/g` |
| `text-[11px]` | `text-overline` (nowy token, 11px) | Uppercase labels, section headers, captions. To jest de facto "overline" pattern używany w 33 miejscach — zasługuje na własny token. | 33 | 1. Dodaj token do CSS. 2. Regex: `s/text-\[11px\]/text-overline/g` |
| `text-[12px]` | `text-xs` | Identyczne z text-xs (12px). Zamiana 1:1. | 2 | Regex: `s/text-\[12px\]/text-xs/g` |
| `text-[13px]` | `text-sm` (14px) | Small buttons, links. 1px różnicy. Zyskujemy spójność kosztem mikro-zmiany wizualnej. | 7 | Regex: `s/text-\[13px\]/text-sm/g` |
| `text-[14px]` | `text-sm` | Identyczne z text-sm (14px). Zamiana 1:1. | 1 | Regex: `s/text-\[14px\]/text-sm/g` |
| `text-[15px]` | `text-base` (16px) LUB `text-sm` | Portal header subtitle. Kontekstowa decyzja — jeśli to subtitle pod dużym tytułem, `text-base` lepsze. | 2 | Manualna — sprawdzić kontekst |

### Token `text-overline` — definicja

```css
/* globals.css — dodać w @theme inline */
@theme inline {
  --font-size-overline: 0.6875rem;      /* 11px */
  --font-size-overline--line-height: 1rem; /* 16px */
}
```

**Zastosowanie:**
```tsx
// Przed:
<span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">

// Po:
<span className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
```

### Letter spacing — standaryzacja

Trzy warianty (`tracking-wider`, `tracking-widest`, `tracking-[0.15em]`) używane zamiennie z `text-[11px] uppercase`.

| Obecne | Zastąp na | Uzasadnienie |
|--------|-----------|-------------|
| `tracking-wider` | `tracking-wider` (zachowaj) | Tailwind standard: 0.05em |
| `tracking-widest` | `tracking-wider` | Zbyt szeroki (0.1em). 0.05em wystarczy. |
| `tracking-[0.15em]` | `tracking-wider` | Arbitralny. Standaryzujemy na jedną wartość. |

### Codemod — pełny skrypt

```bash
#!/bin/bash
# ds-migrate-typography.sh
# Uruchamiać per-moduł, potem review diff

MODULE_PATH="$1"  # np. packages/core/src/modules/customers

if [ -z "$MODULE_PATH" ]; then
  echo "Usage: bash ds-migrate-typography.sh <module-path>"
  exit 1
fi

echo "=== Typography migration: $MODULE_PATH ==="

# text-[10px] → text-xs
find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' 's/text-\[10px\]/text-xs/g' {} +
echo "  text-[10px] → text-xs: done"

# text-[11px] → text-overline
find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' 's/text-\[11px\]/text-overline/g' {} +
echo "  text-[11px] → text-overline: done"

# text-[12px] → text-xs
find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' 's/text-\[12px\]/text-xs/g' {} +
echo "  text-[12px] → text-xs: done"

# text-[13px] → text-sm
find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' 's/text-\[13px\]/text-sm/g' {} +
echo "  text-[13px] → text-sm: done"

# text-[14px] → text-sm
find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' 's/text-\[14px\]/text-sm/g' {} +
echo "  text-[14px] → text-sm: done"

# tracking-widest → tracking-wider (standaryzacja)
find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' 's/tracking-widest/tracking-wider/g' {} +
echo "  tracking-widest → tracking-wider: done"

# tracking-[0.15em] → tracking-wider
find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' 's/tracking-\[0\.15em\]/tracking-wider/g' {} +
echo "  tracking-[0.15em] → tracking-wider: done"

echo "=== MANUAL CHECK NEEDED: text-[15px] (2 instances, contextual decision) ==="
rg 'text-\[15px\]' "$MODULE_PATH" --type tsx || echo "  (none in this module)"

echo "=== Done. Review with: git diff $MODULE_PATH ==="
```

---

## J.2 Color Mapping (Semantic)

### Error colors

| Obecne | Wystąpień | Zastąp na | Typ zamiany | Uwagi |
|--------|-----------|-----------|-------------|-------|
| `text-red-600` | 107 | `text-status-error-text` | Regex 1:1 | Głównie error messages, required indicators |
| `text-red-700` | 19 | `text-status-error-text` | Regex 1:1 | Error text w ciemniejszym kontekście |
| `text-red-800` | 26 | `text-status-error-text` | Regex 1:1 | Error text na jasnym tle (Notice) |
| `text-red-500` | 6 | `text-status-error-icon` | Regex 1:1 | Ikony error |
| `text-red-900` | 1 | `text-status-error-text` | Regex 1:1 | |
| `bg-red-50` | 24 | `bg-status-error-bg` | Regex 1:1 | Error background |
| `bg-red-100` | 14 | `bg-status-error-bg` | Regex 1:1 | Nieco intensywniejsze bg — ten sam token |
| `bg-red-600` | 1 | `bg-destructive` | Manual | Solid error button bg — użyj istniejącego `destructive` |
| `border-red-200` | ~5 | `border-status-error-border` | Regex 1:1 | Error border |
| `border-red-500` | ~5 | `border-status-error-border` | Regex 1:1 | Intensywniejszy error border |
| `text-destructive` | (zachowaj) | — | Nie zmieniaj | Już jest tokenem — prawidłowe użycie |

**Uwaga:** `text-red-600` użyte jako required indicator w CrudForm FieldControl (linia 3418) to wewnętrzna zmiana w `packages/ui/src/backend/CrudForm.tsx`. Jeden PR, duży impact.

### Success colors

| Obecne | Wystąpień | Zastąp na | Typ zamiany |
|--------|-----------|-----------|-------------|
| `text-green-600` | 18 | `text-status-success-text` | Regex 1:1 |
| `text-green-700` | 2 | `text-status-success-text` | Regex 1:1 |
| `text-green-800` | 26 | `text-status-success-text` | Regex 1:1 |
| `text-green-500` | 1 | `text-status-success-icon` | Regex 1:1 |
| `bg-green-100` | 26 | `bg-status-success-bg` | Regex 1:1 |
| `bg-green-50` | 4 | `bg-status-success-bg` | Regex 1:1 |
| `bg-green-200` | 1 | `bg-status-success-bg` | Manual — sprawdzić intensywność |
| `border-green-*` | ~5 | `border-status-success-border` | Regex 1:1 |
| `text-emerald-600` | 4 | `text-status-success-text` | Regex 1:1 |
| `text-emerald-700` | 6 | `text-status-success-text` | Regex 1:1 |
| `text-emerald-800` | 2 | `text-status-success-text` | Regex 1:1 |
| `text-emerald-900` | 3 | `text-status-success-text` | Regex 1:1 |
| `text-emerald-300` | 1 | `text-status-success-icon` | Manual — dark context? |
| `bg-emerald-100` | 2 | `bg-status-success-bg` | Regex 1:1 |
| `bg-emerald-50` | 5 | `bg-status-success-bg` | Regex 1:1 |
| `bg-emerald-500` | 4 | `bg-status-success-icon` | Manual — solid bg? Może `bg-status-success-text` |
| `bg-emerald-600` | 1 | `bg-status-success-icon` | Manual |
| `border-emerald-*` | ~5 | `border-status-success-border` | Regex 1:1 |

### Warning colors

| Obecne | Wystąpień | Zastąp na | Typ zamiany |
|--------|-----------|-----------|-------------|
| `text-amber-500` | ~10 | `text-status-warning-icon` | Regex 1:1 |
| `text-amber-800` | ~5 | `text-status-warning-text` | Regex 1:1 |
| `text-amber-950` | ~2 | `text-status-warning-text` | Regex 1:1 |
| `bg-amber-50` | ~5 | `bg-status-warning-bg` | Regex 1:1 |
| `bg-amber-400/10` | ~2 | `bg-status-warning-bg` | Regex 1:1 |
| `border-amber-200` | ~3 | `border-status-warning-border` | Regex 1:1 |
| `border-amber-500/30` | ~2 | `border-status-warning-border` | Regex 1:1 |

### Info colors

| Obecne | Wystąpień | Zastąp na | Typ zamiany |
|--------|-----------|-----------|-------------|
| `text-blue-600` | 27 | `text-status-info-text` | Regex 1:1 |
| `text-blue-800` | 25 | `text-status-info-text` | Regex 1:1 |
| `text-blue-700` | 8 | `text-status-info-text` | Regex 1:1 |
| `text-blue-900` | 9 | `text-status-info-text` | Regex 1:1 |
| `text-blue-500` | ~5 | `text-status-info-icon` | Regex 1:1 |
| `bg-blue-50` | 24 | `bg-status-info-bg` | Regex 1:1 |
| `bg-blue-100` | 19 | `bg-status-info-bg` | Regex 1:1 |
| `bg-blue-600` | 4 | `bg-status-info-icon` | Manual — solid bg for active state? |
| `border-blue-200` | ~3 | `border-status-info-border` | Regex 1:1 |
| `border-blue-500` | ~2 | `border-status-info-border` | Regex 1:1 |
| `border-sky-600/30` | ~2 | `border-status-info-border` | Regex 1:1 |
| `bg-sky-500/10` | ~2 | `bg-status-info-bg` | Regex 1:1 |
| `text-sky-900` | ~2 | `text-status-info-text` | Regex 1:1 |

### Codemod — pełny skrypt

```bash
#!/bin/bash
# ds-migrate-colors.sh
# Uruchamiać per-moduł, potem review diff

MODULE_PATH="$1"

if [ -z "$MODULE_PATH" ]; then
  echo "Usage: bash ds-migrate-colors.sh <module-path>"
  exit 1
fi

echo "=== Color migration: $MODULE_PATH ==="

# ═══ ERROR ═══
for shade in 600 700 800 900; do
  find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' "s/text-red-$shade/text-status-error-text/g" {} +
done
find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' 's/text-red-500/text-status-error-icon/g' {} +
for shade in 50 100; do
  find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' "s/bg-red-$shade/bg-status-error-bg/g" {} +
done
for shade in 200 300 500; do
  find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' "s/border-red-$shade/border-status-error-border/g" {} +
done

# ═══ SUCCESS (green) ═══
for shade in 500 600 700 800; do
  find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' "s/text-green-$shade/text-status-success-text/g" {} +
done
for shade in 50 100 200; do
  find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' "s/bg-green-$shade/bg-status-success-bg/g" {} +
done
for shade in 200 300 500; do
  find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' "s/border-green-$shade/border-status-success-border/g" {} +
done

# ═══ SUCCESS (emerald) ═══
for shade in 300 600 700 800 900; do
  find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' "s/text-emerald-$shade/text-status-success-text/g" {} +
done
for shade in 50 100; do
  find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' "s/bg-emerald-$shade/bg-status-success-bg/g" {} +
done
for shade in 200 300; do
  find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' "s/border-emerald-$shade/border-status-success-border/g" {} +
done

# ═══ WARNING (amber) ═══
for shade in 500 800 950; do
  find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' "s/text-amber-$shade/text-status-warning-text/g" {} +
done
for shade in 50; do
  find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' "s/bg-amber-$shade/bg-status-warning-bg/g" {} +
done
for shade in 200 500; do
  find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' "s/border-amber-$shade/border-status-warning-border/g" {} +
done

# ═══ INFO (blue) ═══
for shade in 600 700 800 900; do
  find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' "s/text-blue-$shade/text-status-info-text/g" {} +
done
find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' 's/text-blue-500/text-status-info-icon/g' {} +
for shade in 50 100; do
  find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' "s/bg-blue-$shade/bg-status-info-bg/g" {} +
done
for shade in 200 500; do
  find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' "s/border-blue-$shade/border-status-info-border/g" {} +
done

# ═══ INFO (sky — used in Alert component) ═══
find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' 's/text-sky-900/text-status-info-text/g' {} +
find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' 's/border-sky-600\/30/border-status-info-border/g' {} +
find "$MODULE_PATH" -name "*.tsx" -exec sed -i '' 's/bg-sky-500\/10/bg-status-info-bg/g' {} +

echo "=== MANUAL REVIEW NEEDED ==="
echo "  Check: bg-red-600, bg-emerald-500, bg-emerald-600, bg-blue-600"
echo "  These are solid backgrounds — may need different token (icon/emphasis)"
rg 'bg-red-600|bg-emerald-[56]00|bg-blue-600' "$MODULE_PATH" --type tsx || echo "  (none in this module)"

echo "=== Done. Review with: git diff $MODULE_PATH ==="
```

### Zamiana w Alert component (packages/ui/src/primitives/alert.tsx)

**Obecne CVA variants → nowe:**

```typescript
// PRZED:
destructive: 'border-destructive/60 bg-destructive/10 text-destructive [&_svg]:text-destructive',
success:     'border-emerald-600/30 bg-emerald-500/10 text-emerald-900 [&_svg]:text-emerald-600',
warning:     'border-amber-500/30 bg-amber-400/10 text-amber-950 [&_svg]:text-amber-600',
info:        'border-sky-600/30 bg-sky-500/10 text-sky-900 [&_svg]:text-sky-600',

// PO:
destructive: 'border-status-error-border bg-status-error-bg text-status-error-text [&_svg]:text-status-error-icon',
success:     'border-status-success-border bg-status-success-bg text-status-success-text [&_svg]:text-status-success-icon',
warning:     'border-status-warning-border bg-status-warning-bg text-status-warning-text [&_svg]:text-status-warning-icon',
info:        'border-status-info-border bg-status-info-bg text-status-info-text [&_svg]:text-status-info-icon',
```

### Zamiana w Notice component (packages/ui/src/primitives/Notice.tsx)

```typescript
// PRZED:
error:   { border: 'border-red-200',   bg: 'bg-red-50',   text: 'text-red-800',   iconBorder: 'border-red-500' }
warning: { border: 'border-amber-200', bg: 'bg-amber-50', text: 'text-amber-800', iconBorder: 'border-amber-500' }
info:    { border: 'border-blue-200',  bg: 'bg-blue-50',  text: 'text-blue-900',  iconBorder: 'border-blue-500' }

// PO (jeśli zachowujemy Notice z deprecation warning):
error:   { border: 'border-status-error-border',   bg: 'bg-status-error-bg',   text: 'text-status-error-text',   iconBorder: 'border-status-error-icon' }
warning: { border: 'border-status-warning-border', bg: 'bg-status-warning-bg', text: 'text-status-warning-text', iconBorder: 'border-status-warning-icon' }
info:    { border: 'border-status-info-border',    bg: 'bg-status-info-bg',    text: 'text-status-info-text',    iconBorder: 'border-status-info-icon' }
```

### Zamiana w FlashMessages (packages/ui/src/backend/FlashMessages.tsx)

```typescript
// PRZED:
const kindColors: Record<FlashKind, string> = {
  success: 'emerald-600',
  error:   'red-600',
  warning: 'amber-500',
  info:    'blue-600',
}

// PO:
const kindColors: Record<FlashKind, string> = {
  success: 'status-success-icon',
  error:   'status-error-icon',
  warning: 'status-warning-icon',
  info:    'status-info-icon',
}
```

### Zamiana w Notifications (packages/ui/src/backend/notifications/)

```typescript
// PRZED:
const severityColors = {
  info:    'text-blue-500',
  warning: 'text-amber-500',
  success: 'text-green-500',
  error:   'text-destructive',
}

// PO:
const severityColors = {
  info:    'text-status-info-icon',
  warning: 'text-status-warning-icon',
  success: 'text-status-success-icon',
  error:   'text-status-error-icon',
}
```

---

## J.3 Component Mapping (Notice → Alert)

### Prop-level mapping

| Notice usage | Alert equivalent | Uwagi |
|-------------|-----------------|-------|
| `<Notice variant="error">` | `<Alert variant="destructive">` | Nazwa zmieniona na "destructive" — spójna z Button |
| `<Notice variant="info">` | `<Alert variant="info">` | Bez zmian |
| `<Notice variant="warning">` | `<Alert variant="warning">` | Bez zmian |
| `title="Tytuł"` | `<AlertTitle>Tytuł</AlertTitle>` | Composition pattern zamiast prop |
| `message="Treść"` | `<AlertDescription>Treść</AlertDescription>` | Composition pattern zamiast prop |
| `action={<Button>Retry</Button>}` | `<AlertAction><Button>Retry</Button></AlertAction>` | Explicit slot |
| `compact` | `compact` | Zachowany — mniej paddingu, brak ikony |
| `children` | `children` (wewnątrz Alert) | Zachowane |
| `className="..."` | `className="..."` | Zachowane |

### ErrorNotice mapping

| ErrorNotice usage | Alert equivalent |
|-------------------|-----------------|
| `<ErrorNotice />` (bez props) | `<Alert variant="destructive"><AlertTitle>{t('ui.errors.defaultTitle')}</AlertTitle><AlertDescription>{t('ui.errors.defaultMessage')}</AlertDescription></Alert>` |
| `<ErrorNotice title="X" />` | `<Alert variant="destructive"><AlertTitle>X</AlertTitle><AlertDescription>{t('ui.errors.defaultMessage')}</AlertDescription></Alert>` |
| `<ErrorNotice title="X" message="Y" />` | `<Alert variant="destructive"><AlertTitle>X</AlertTitle><AlertDescription>Y</AlertDescription></Alert>` |
| `<ErrorNotice action={btn} />` | `<Alert variant="destructive"><AlertTitle>...</AlertTitle><AlertDescription>...<AlertAction>{btn}</AlertAction></AlertDescription></Alert>` |

### Plik-po-pliku migration plan

| # | Plik | Obecne | Zamień na | Złożoność |
|---|------|--------|-----------|-----------|
| 1 | `portal/signup/page.tsx` | `<Notice variant="error" message={...} />` | `<Alert variant="destructive"><AlertDescription>{...}</AlertDescription></Alert>` | Niska |
| 2 | `portal/page.tsx` | `<Notice variant="info" ...>` | `<Alert variant="info">...` | Niska |
| 3 | `portal/login/page.tsx` | `<Notice variant="error" message={...} />` | `<Alert variant="destructive">...` | Niska |
| 4 | `auth/frontend/login.tsx` | `<Notice variant="error" ...>` + custom error banners | `<Alert variant="destructive">...` + migracja hardcoded banners | **Średnia** — ma też ręcznie stylowane banery |
| 5 | `audit_logs/AuditLogsActions.tsx` | `<Notice variant="info" ...>` | `<Alert variant="info">...` | Niska |
| 6 | `data_sync/backend/.../page.tsx` | `<Notice variant="warning" ...>` | `<Alert variant="warning">...` | Niska |
| 7 | `data_sync/.../IntegrationScheduleTab.tsx` | `<Notice variant="info" ...>` | `<Alert variant="info">...` | Niska |
| 8 | `customers/deals/pipeline/page.tsx` | `<ErrorNotice />` | `<Alert variant="destructive"><AlertTitle>...` | Niska |
| 9 | `entities/user/[entityId]/page.tsx` | `<ErrorNotice />` | `<Alert variant="destructive"><AlertTitle>...` | Niska |

**Estimated effort:** 6 plików → 15 min każdy = 1.5h. 2 pliki wymagają więcej uwagi (auth login, data_sync page) = +1h. **Razem: ~2.5h.**

---

## J.4 Kolejność operacji na hackathonie

**Timing:** PT 11.04.2026 9:00 – SO 12.04.2026 11:00 (~18h roboczych)

```
PIĄTEK 9:00–12:00 (BLOK 1 — Foundations):
  1. Dodaj CSS custom properties (sekcja I — token values) do globals.css
  2. Dodaj @theme inline mappings
  3. Dodaj text-overline token
  4. Zweryfikuj contrast w Chrome DevTools (light + dark)
  5. Udokumentuj typography scale + spacing guidelines
  → Commit: "feat(ds): add semantic status tokens and text-overline"

PIĄTEK 13:00–17:00 (BLOK 2 — Migracja primitives):
  6. Zamień Alert CVA variants na semantic tokens (alert.tsx — 4 linie)
  7. Zamień Notice colors na semantic tokens + dodaj deprecation (Notice.tsx)
  8. Zamień FlashMessages colors (FlashMessages.tsx)
  9. Zamień Notification severity colors
  10. Dodaj Badge status variants (badge.tsx)
  11. Zmigruj CrudForm FieldControl colors (text-red-600 → text-destructive)
  → Commit: "refactor(ds): migrate all primitives to semantic status tokens"

PIĄTEK 18:00–21:00 (BLOK 3 — Nowe komponenty):
  12. Stwórz FormField component (packages/ui/src/primitives/form-field.tsx)
  13. Stwórz StatusBadge component (packages/ui/src/primitives/status-badge.tsx)
  14. Stwórz SectionHeader/Section (packages/ui/src/backend/Section.tsx)
  → Commit: "feat(ds): add FormField, StatusBadge, Section components"

PIĄTEK 21:00–23:00 (BLOK 4 — Migracja customers):
  15. Uruchom ds-migrate-colors.sh na packages/core/src/modules/customers/
  16. Uruchom ds-migrate-typography.sh na tym samym module
  17. Manual review + fix edge cases + screenshots
  → Commit: "refactor(ds): migrate customers module to DS tokens"

SOBOTA 8:00–11:00 (BLOK 5 — Dokumentacja + Wrap-up):
  18. Napisz Design Principles doc + PR Review Checklist
  19. Zaktualizuj AGENTS.md z DS rules
  20. Zaktualizuj PR template z DS compliance checkboxami
  21. Zdefiniuj z-index scale + border-radius guidelines
  22. Uruchom ds-health-check.sh — zapisz baseline
  → Commit: "docs(ds): add principles, update AGENTS.md and PR template"
```

**Bufor:** ~3h na edge case'y, dark mode debugging, niespodzianki.

---

*Koniec supplementu. Sekcje E-J stanowią kompletny, egzekucyjny plan design systemu.*
