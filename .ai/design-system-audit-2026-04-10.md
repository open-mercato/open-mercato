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

### Decyzja architekturalna: Flat tokens, NIE opacity-based

**Uzywamy flat tokens** — oddzielny CSS custom property per rola (bg, text, border, icon) z pelna wartoscia koloru. Kazdy token ma oddzielna wartosc dla light i dark mode.

```
TAK:  --status-error-bg: oklch(0.965 0.015 25);     /* pelna wartosc, kontrolowany kontrast */
      .dark { --status-error-bg: oklch(0.220 0.025 25); }

NIE:  --status-error: oklch(0.577 0.245 27);         /* jeden bazowy kolor */
      bg-status-error/5                                /* opacity w Tailwind */
```

**Dlaczego:** Opacity-based tokens (`bg-status-error/5`) nie kontroluja kontrastu w dark mode. `oklch(0.577 0.245 27) / 5%` na bialym tle daje subtlny rozowy, ale na czarnym tle jest prawie niewidoczny. Flat tokens daja pelna kontrole nad kontrastem w obu trybach.

**Konwencja naming:**
- CSS variable: `--status-{status}-{role}` np. `--status-error-bg`
- Tailwind class: `{property}-status-{status}-{role}` np. `bg-status-error-bg`, `text-status-error-text`
- Tailwind mapping: `--color-status-{status}-{role}: var(--status-{status}-{role})`

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

**Cel: działające semantic color tokens w Tailwind + documentation foundations**

- [ ] Dodać 20 CSS custom properties do `globals.css` (light mode)
- [ ] Dodać 20 CSS custom properties do `.dark` (dark mode)
- [ ] Dodać `text-overline` token (11px)
- [ ] Dodać `@theme inline` mappings dla Tailwind v4
- [ ] Zweryfikować contrast w Chrome DevTools (light + dark) — wszystkie 5 statusów
- [ ] Udokumentować typography scale (tabela)
- [ ] Udokumentować spacing guidelines (usage rules)
- [ ] `yarn lint && yarn typecheck` — upewnić się, że nic nie zepsute
→ **Commit:** `feat(ds): add semantic status tokens, text-overline, and foundation docs`

## BLOK 2 — Piątek 13:00–17:00 (4h): Migracja primitives

**Cel: wszystkie primitives używają semantic tokenów**

- [ ] Zamienić Alert CVA variants na flat semantic tokens (`alert.tsx` — 4 linie)
- [ ] Zamienić Notice colors na semantic tokens + deprecation warning (`Notice.tsx`)
- [ ] Zamienić FlashMessages colors (`FlashMessages.tsx`)
- [ ] Zamienić Notification severity colors
- [ ] Dodać status warianty do Badge (`badge.tsx` — success, warning, info)
- [ ] Zmigrować CrudForm FieldControl colors (`text-red-600` → `text-destructive`)
- [ ] `yarn lint && yarn typecheck && yarn test`
→ **Commit:** `refactor(ds): migrate all primitives to semantic status tokens`

## BLOK 3 — Piątek 18:00–20:00 (2h): Nowe komponenty

**Cel: FormField + StatusBadge gotowe (Section jako stretch goal)**

- [ ] Stworzyć `FormField` wrapper (`packages/ui/src/primitives/form-field.tsx`)
- [ ] Stworzyć `StatusBadge` (`packages/ui/src/primitives/status-badge.tsx`)
- [ ] Jeśli czas pozwala: `Section` / `SectionHeader` (`packages/ui/src/backend/Section.tsx`)
- [ ] `yarn lint && yarn typecheck`
→ **Commit:** `feat(ds): add FormField, StatusBadge components`

## Piątek 20:00–21:00: PRZERWA / BUFOR

Odpoczynek. Jeśli Blok 3 się przeciągnął — dokończ go teraz. Nie zaczynaj nowej pracy.

## BLOK 4 — Piątek 21:00–22:00 (1h): Dokumentacja (lekka praca)

**Cel: principles i checklist gotowe (niskoryzykowa praca na koniec dnia)**

- [ ] Napisać Design Principles — skrócona wersja do README
- [ ] Napisać PR Review Checklist (checkboxy DS compliance)
- [ ] Zdefiniować z-index scale + border-radius usage guidelines
→ **Commit:** `docs(ds): add principles, PR review checklist, foundation guidelines`

## BLOK 5 — Sobota 8:00–10:00 (2h): Migracja customers module

**Cel: proof of concept — jeden moduł w pełni zmigrowany (świeża głowa)**

- [ ] Uruchomić `ds-migrate-colors.sh` na `packages/core/src/modules/customers/`
- [ ] Uruchomić `ds-migrate-typography.sh` na tym samym module
- [ ] Manual review + fix edge cases
- [ ] Screenshot before/after (light + dark)
- [ ] `yarn lint && yarn typecheck && yarn test`
→ **Commit:** `refactor(ds): migrate customers module to DS tokens`

## BLOK 6 — Sobota 10:00–11:00 (1h): Wrap-up

**Cel: system gotowy do adopcji**

- [ ] Zaktualizować AGENTS.md z DS rules
- [ ] Zaktualizować PR template z DS compliance checkboxami
- [ ] Uruchomić `ds-health-check.sh` — zapisać baseline
- [ ] Final `yarn lint && yarn typecheck` pass
→ **Commit:** `docs(ds): update AGENTS.md, PR template, baseline report`

---

**Bufor:** Plan pokrywa ~13h. Zostaje ~5h buforu na:
- Edge case'y w migracji customers
- Debugging dark mode contrast
- Section component (jeśli nie zmieścił się w Bloku 3)
- Niespodzianki w CrudForm FieldControl

---

## B.1 Cut Lines — co jeśli nie zdążymy

### MUST HAVE — 8h minimum (Bloki 1 + 2)

**Definicja sukcesu:** Semantic color tokens istnieją i są używane przez istniejące komponenty. Nowe PR-y mogą korzystać z tokenów. Dark mode działa.

Commity:
1. `feat(ds): add semantic status tokens, text-overline, and foundation docs`
2. `refactor(ds): migrate all primitives to semantic status tokens`

**Co to daje:**
- 20 semantic tokens w globals.css (light + dark)
- Alert, Notice, Badge, FlashMessages, Notifications — wszystkie na tokenach
- CrudForm FieldControl — error colors na tokenach
- Typography scale i spacing guidelines udokumentowane
- Foundation na której buduje się reszta

**Jeśli nic więcej nie zdążymy** — hackathon jest sukcesem. Mamy system tokenów, który eliminuje 80% problemu kolorystycznego. Każdy nowy PR od teraz może używać `text-status-error-text` zamiast `text-red-600`.

### SHOULD HAVE — 14h (+ Bloki 3, 4)

**Commity dodatkowe:**
3. `feat(ds): add FormField, StatusBadge components`
4. `docs(ds): add principles, PR review checklist, foundation guidelines`

**Co to dodaje:**
- Nowe komponenty do użycia od zaraz
- Principles i PR checklist — enforcement dla contributorów
- Z-index scale i border-radius guidelines

### NICE TO HAVE — 18h (+ Bloki 5, 6)

**Commity dodatkowe:**
5. `refactor(ds): migrate customers module to DS tokens`
6. `docs(ds): update AGENTS.md, PR template, baseline report`

**Co to dodaje:**
- Proof of concept: cały moduł zmigrowany
- AGENTS.md rules — AI agents generują DS-compliant kod
- Baseline health report do trackowania postępu
- Section component (jeśli zmieścił się w buforze)

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
# bg-green-100    → bg-status-success-bg
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
- USE semantic tokens: `text-status-error-text`, `bg-status-success-bg`, `border-status-warning-border`
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
# Portable: dziala na macOS i Linux

set -euo pipefail

REPORT_DIR=".ai/reports"
mkdir -p "$REPORT_DIR"

DATE=$(date +%Y-%m-%d)
REPORT_FILE="$REPORT_DIR/ds-health-$DATE.txt"

# Funkcja zapisu do stdout i pliku jednoczesnie
report() {
  echo "$1" | tee -a "$REPORT_FILE"
}

# Wyczysc plik raportu (nowy raport)
> "$REPORT_FILE"

report "=== DESIGN SYSTEM HEALTH CHECK ==="
report "Date: $DATE"
report ""

report "--- Hardcoded Status Colors ---"
HC=$(rg 'text-red-[0-9]|bg-red-[0-9]|border-red-[0-9]|text-green-[0-9]|bg-green-[0-9]|border-green-[0-9]|text-emerald-[0-9]|bg-emerald-[0-9]|border-emerald-[0-9]|text-amber-[0-9]|bg-amber-[0-9]|border-amber-[0-9]|text-blue-[0-9]|bg-blue-[0-9]|border-blue-[0-9]' \
  --type tsx --glob '!**/__tests__/**' --glob '!**/node_modules/**' -c 2>/dev/null | \
  awk -F: '{s+=$2} END{print s+0}')
report "  Count: $HC (target: 0)"

report ""
report "--- Arbitrary Text Sizes ---"
AT=$(rg 'text-\[\d+px\]' --type tsx --glob '!**/__tests__/**' -c 2>/dev/null | \
  awk -F: '{s+=$2} END{print s+0}')
report "  Count: $AT (target: 1)"

report ""
report "--- Deprecated Notice Usage ---"
NC=$(rg "from.*primitives/Notice" --type tsx -l 2>/dev/null | wc -l | tr -d ' ')
report "  Notice imports: $NC (target: 0)"
EN=$(rg "ErrorNotice" --type tsx -l 2>/dev/null | wc -l | tr -d ' ')
report "  ErrorNotice imports: $EN (target: 0)"

report ""
report "--- Inline SVG ---"
SVG=$(rg '<svg' --type tsx --glob '!**/__tests__/**' --glob '!**/node_modules/**' -l 2>/dev/null | wc -l | tr -d ' ')
report "  Files with inline SVG: $SVG (target: 0)"

report ""
report "--- Raw fetch() in Backend ---"
RF=$(rg 'fetch\(' --type tsx --glob '**/backend/**' --glob '!**/node_modules/**' -l 2>/dev/null | wc -l | tr -d ' ')
report "  Raw fetch files: $RF (target: 0)"

report ""
report "--- Empty State Coverage ---"
PAGES=$(find packages/core/src/modules/*/backend -name "page.tsx" 2>/dev/null | wc -l | tr -d ' ')
ES=$(rg 'EmptyState|TabEmptyState' --type tsx --glob '**/backend/**/page.tsx' -l 2>/dev/null | wc -l | tr -d ' ')
PCT=$(( ES * 100 / PAGES ))
report "  Pages with empty state: $ES / $PAGES ($PCT%)"

report ""
report "--- Loading State Coverage ---"
LS=$(rg 'LoadingMessage|isLoading|Spinner' --type tsx --glob '**/backend/**/page.tsx' -l 2>/dev/null | wc -l | tr -d ' ')
LPCT=$(( LS * 100 / PAGES ))
report "  Pages with loading state: $LS / $PAGES ($LPCT%)"

report ""
report "=== END REPORT ==="

# Porownanie z poprzednim raportem
PREV=$(ls -1 "$REPORT_DIR"/ds-health-*.txt 2>/dev/null | grep -v "$DATE" | sort | tail -1)
if [ -n "${PREV:-}" ] && [ -f "$PREV" ]; then
  echo ""
  echo "=== DELTA vs $(basename "$PREV") ==="
  diff --unified=0 "$PREV" "$REPORT_FILE" | grep '^[+-]  ' | head -20 || echo "  (no changes)"
else
  echo ""
  echo "=== First report — no previous data to compare ==="
fi

echo ""
echo "Report saved to: $REPORT_FILE"
```

**Tracking cadence:** Uruchamiac na poczatku kazdego sprintu. Raport zapisuje sie do `.ai/reports/ds-health-YYYY-MM-DD.txt`. Porownanie z poprzednim raportem automatyczne.

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
  /** Label variant. 'default' = text-sm font-medium (backend forms). 'overline' = text-overline font-semibold uppercase tracking-wider (portal/compact contexts). */
  labelVariant?: 'default' | 'overline'
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

### Decyzja: Label style

**Domyslny styl:** `text-sm font-medium text-foreground` — spojny z istniejacym `<Label>` primitive i CrudForm FieldControl. To jest styl uzywany w 95% backendu.

**Wariant `overline`:** `text-overline font-semibold uppercase tracking-wider text-muted-foreground` — uzywany w portal pages i kompaktowych kontekstach. Dostepny przez `labelVariant="overline"`, NIE jest domyslny.

**Implementacja label rendering:**

```typescript
const labelStyles = {
  default: 'text-sm font-medium text-foreground',
  overline: 'text-overline font-semibold uppercase tracking-wider text-muted-foreground',
}

// W renderze:
{label && (
  <Label htmlFor={fieldId} className={labelStyles[labelVariant ?? 'default']}>
    {label}
    {required && <span className="text-destructive ml-0.5">*</span>}
  </Label>
)}
```

**Error message style:** `text-xs text-destructive` z `role="alert"` — spojny z CrudForm.

**Description style:** `text-xs text-muted-foreground` — spojny z CrudForm (ale bez ikony Info — FormField jest prostszy).

**Portal forms:** Uzywaja `<FormField labelVariant="overline">`. Portal nie potrzebuje wlasnego komponentu — wystarczy wariant.

**Wspoldzielenie z CrudForm:** Docelowo (po hackathonie) CrudForm FieldControl powinien wyciagnac sub-komponenty `FieldLabel`, `FieldError`, `FieldDescription` do wspolnej lokalizacji (`packages/ui/src/primitives/form-field-parts.tsx`). FormField i CrudForm FieldControl oba je importuja. To zapewnia spojny styl bez duplikacji. **Nie robic tego na hackathonie** — za duze ryzyko regresji w CrudForm.

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

### Relacja Badge vs StatusBadge

```
StatusBadge (semantic: "co ten status ZNACZY")
  └── Badge (visual: "jak to WYGLĄDA")
       └── semantic color tokens (foundation: "JAKIM kolorem")
```

**Badge** = niskopoziomowy komponent wizualny. Warianty: `default`, `secondary`, `destructive`, `outline`, `muted`, + nowe: `success`, `warning`, `info`. Nie ma logiki mapowania statusów. Używasz go kiedy znasz wariant:
```tsx
<Badge variant="success">Active</Badge>
```

**StatusBadge** = semantyczny wrapper. Przyjmuje `variant: StatusBadgeVariant` i **wewnętrznie renderuje `<Badge>`** z odpowiednim wariantem + opcjonalny dot indicator. Moduły definiują `StatusMap` mapujący business status → variant:
```tsx
<StatusBadge variant={statusMap[person.status]} dot>{t(`status.${person.status}`)}</StatusBadge>
```

**To NIE jest duplikacja.** Badge to "jak rysować kolorowy pill". StatusBadge to "jaki kolor dla 'active'?". StatusBadge bez Badge nie ma sensu. Badge bez StatusBadge jest OK dla non-status contexów (np. count badge, label badge).

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

### Implementacja — StatusBadge renderuje Badge

```typescript
import { Badge } from './badge'

// Mapowanie StatusBadge variant → Badge variant (nowe warianty w Badge)
const variantToBadge: Record<StatusBadgeVariant, string> = {
  success: 'success',
  warning: 'warning',
  error:   'destructive',  // Badge uzywa "destructive" nie "error"
  info:    'info',
  neutral: 'muted',        // Badge uzywa "muted" nie "neutral"
}

export function StatusBadge({ variant, dot, children, className }: StatusBadgeProps) {
  return (
    <Badge variant={variantToBadge[variant]} className={className}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </Badge>
  )
}
```

**Badge CVA — nowe warianty status (dodac do badge.tsx):**

```typescript
// Istniejace:
default: 'border-transparent bg-primary text-primary-foreground shadow',
secondary: 'border-transparent bg-secondary text-secondary-foreground',
destructive: 'border-transparent bg-destructive text-destructive-foreground shadow',
outline: 'text-foreground',
muted: 'border-transparent bg-muted text-muted-foreground',

// Nowe:
success: 'border-status-success-border bg-status-success-bg text-status-success-text',
warning: 'border-status-warning-border bg-status-warning-bg text-status-warning-text',
info:    'border-status-info-border bg-status-info-bg text-status-info-text',
```

> `destructive` Badge juz istnieje i uzywa `--destructive` token. Po migracji kolorow w sekcji I, destructive Badge automatycznie bedzie uzywal semantic error colors. Nie trzeba dodawac oddzielnego `error` wariantu do Badge.

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
      destructive: 'border-status-error-border bg-status-error-bg text-status-error-text [&_svg]:text-status-error-icon',
      success:     'border-status-success-border bg-status-success-bg text-status-success-text [&_svg]:text-status-success-icon',
      warning:     'border-status-warning-border bg-status-warning-bg text-status-warning-text [&_svg]:text-status-warning-icon',
      info:        'border-status-info-border bg-status-info-bg text-status-info-text [&_svg]:text-status-info-icon',
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
| **Prawdopodobienstwo** | Niskie (po decyzji o flat tokens) — kazdy status ma dedykowane wartosci light/dark. Ryzyko dotyczy glownie dobrania poprawnych OKLCH lightness values. |
| **Impact** | Wysoki — nieczytelne alerty/badges w dark mode |
| **Mitigation** | 1. Flat tokens eliminuja glowne ryzyko (kazdy mode ma dedykowane wartosci). 2. Testowac KAZDY token w Chrome DevTools Color Contrast checker. 3. axe-core automated scan na Playwright. 4. Screenshot comparison light vs dark dla kazdego komponentu przed merge. |
| **Rollback** | Zmiana CSS custom properties — natychmiastowa, zero kodu do revertowania. |

**Rozwiazanie zastosowane:** Flat tokens z dedykowanymi wartosciami per mode (sekcja I). Opacity-based approach odrzucony na etapie projektowania — patrz sekcja 3.1 "Decyzja architekturalna".

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
| R2: Dark mode contrast | Niskie (flat tokens) | Wysoki | **Sredni** | Test every token |
| R3: Visual regression | Srednie | Sredni | **Sredni** | Per-module PR + screenshots |
| R4: Contributor confusion | Srednie | Sredni | **Sredni** | Communication plan |
| R5: CrudForm coupling | Niskie | Sredni | **Niski** | Shared sub-components |
| R6: Performance | Niskie | Niski | **Niski** | CSS-only changes |

**Top risk requiring immediate action:** R3 (visual regression przy migracji 372 kolorow) — per-module PRy ze screenshots before/after. R2 zmitigowany przez flat tokens, ale weryfikacja kontrastu w Chrome DevTools nadal obowiazkowa.

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
# Portable: macOS + Linux (uses perl -i -pe instead of sed -i)
# Uruchamiać per-moduł, potem review diff

set -euo pipefail
MODULE_PATH="$1"  # np. packages/core/src/modules/customers

if [ -z "$MODULE_PATH" ]; then
  echo "Usage: bash ds-migrate-typography.sh <module-path>"
  exit 1
fi

echo "=== Typography migration: $MODULE_PATH ==="

# Portable in-place replace using perl (works identically on macOS and Linux)
replace() {
  find "$MODULE_PATH" -name "*.tsx" -exec perl -i -pe "$1" {} +
}

replace 's/text-\[10px\]/text-xs/g'
echo "  text-[10px] → text-xs: done"

replace 's/text-\[11px\]/text-overline/g'
echo "  text-[11px] → text-overline: done"

replace 's/text-\[12px\]/text-xs/g'
echo "  text-[12px] → text-xs: done"

replace 's/text-\[13px\]/text-sm/g'
echo "  text-[13px] → text-sm: done"

replace 's/text-\[14px\]/text-sm/g'
echo "  text-[14px] → text-sm: done"

replace 's/tracking-widest/tracking-wider/g'
echo "  tracking-widest → tracking-wider: done"

replace 's/tracking-\[0\.15em\]/tracking-wider/g'
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
# Portable: macOS + Linux (uses perl -i -pe instead of sed -i)
# Uruchamiać per-moduł, potem review diff

set -euo pipefail
MODULE_PATH="$1"

if [ -z "$MODULE_PATH" ]; then
  echo "Usage: bash ds-migrate-colors.sh <module-path>"
  exit 1
fi

echo "=== Color migration: $MODULE_PATH ==="

# Portable in-place replace using perl
replace() {
  find "$MODULE_PATH" -name "*.tsx" -exec perl -i -pe "$1" {} +
}

# ═══ ERROR ═══
for shade in 600 700 800 900; do
  replace "s/text-red-$shade/text-status-error-text/g"
done
replace 's/text-red-500/text-status-error-icon/g'
for shade in 50 100; do
  replace "s/bg-red-$shade/bg-status-error-bg/g"
done
for shade in 200 300 500; do
  replace "s/border-red-$shade/border-status-error-border/g"
done

# ═══ SUCCESS (green) ═══
for shade in 500 600 700 800; do
  replace "s/text-green-$shade/text-status-success-text/g"
done
for shade in 50 100 200; do
  replace "s/bg-green-$shade/bg-status-success-bg/g"
done
for shade in 200 300 500; do
  replace "s/border-green-$shade/border-status-success-border/g"
done

# ═══ SUCCESS (emerald) ═══
for shade in 300 600 700 800 900; do
  replace "s/text-emerald-$shade/text-status-success-text/g"
done
for shade in 50 100; do
  replace "s/bg-emerald-$shade/bg-status-success-bg/g"
done
for shade in 200 300; do
  replace "s/border-emerald-$shade/border-status-success-border/g"
done

# ═══ WARNING (amber) ═══
for shade in 500 800 950; do
  replace "s/text-amber-$shade/text-status-warning-text/g"
done
replace "s/bg-amber-50/bg-status-warning-bg/g"
for shade in 200 500; do
  replace "s/border-amber-$shade/border-status-warning-border/g"
done

# ═══ INFO (blue) ═══
for shade in 600 700 800 900; do
  replace "s/text-blue-$shade/text-status-info-text/g"
done
replace 's/text-blue-500/text-status-info-icon/g'
for shade in 50 100; do
  replace "s/bg-blue-$shade/bg-status-info-bg/g"
done
for shade in 200 500; do
  replace "s/border-blue-$shade/border-status-info-border/g"
done

# ═══ INFO (sky — used in Alert component) ═══
replace 's/text-sky-900/text-status-info-text/g'
replace 's/border-sky-600\/30/border-status-info-border/g'
replace 's/bg-sky-500\/10/bg-status-info-bg/g'

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

**Timing:** PT 11.04.2026 9:00 – SO 12.04.2026 11:00 (~13h pracy + ~5h bufor)

Zsynchronizowany z sekcja B. Szczegolowy step-by-step:

```
PIĄTEK 9:00–12:00 (BLOK 1 — Foundations):
  1. Dodaj 20+20 CSS custom properties (flat tokens, light + dark) do globals.css
  2. Dodaj @theme inline mappings (--color-status-*-* → var(--status-*-*))
  3. Dodaj text-overline token (--font-size-overline: 0.6875rem)
  4. Zweryfikuj contrast w Chrome DevTools (light + dark) — 5 statusów × 2 tryby
  5. Udokumentuj typography scale + spacing guidelines
  6. yarn lint && yarn typecheck
  → Commit: "feat(ds): add semantic status tokens and text-overline"

PIĄTEK 13:00–17:00 (BLOK 2 — Migracja primitives):
  7. Zamień Alert CVA variants na flat semantic tokens (alert.tsx — 4 linie)
  8. Zamień Notice colors na flat tokens + dodaj deprecation (Notice.tsx)
  9. Zamień FlashMessages colors (FlashMessages.tsx)
  10. Zamień Notification severity colors
  11. Dodaj Badge status variants: success, warning, info (badge.tsx)
  12. Zmigruj CrudForm FieldControl colors (text-red-600 → text-destructive)
  13. yarn lint && yarn typecheck && yarn test
  → Commit: "refactor(ds): migrate all primitives to semantic status tokens"

PIĄTEK 18:00–20:00 (BLOK 3 — Nowe komponenty):
  14. Stwórz FormField (packages/ui/src/primitives/form-field.tsx) z labelVariant
  15. Stwórz StatusBadge (packages/ui/src/primitives/status-badge.tsx) — renderuje Badge
  16. Stretch: Section/SectionHeader (packages/ui/src/backend/Section.tsx)
  17. yarn lint && yarn typecheck
  → Commit: "feat(ds): add FormField, StatusBadge components"

PIĄTEK 20:00–21:00: PRZERWA / BUFOR

PIĄTEK 21:00–22:00 (BLOK 4 — Dokumentacja):
  18. Napisz Design Principles — skrócona wersja do README
  19. Napisz PR Review Checklist
  20. Zdefiniuj z-index scale + border-radius guidelines
  → Commit: "docs(ds): add principles, PR review checklist, guidelines"

SOBOTA 8:00–10:00 (BLOK 5 — Migracja customers):
  21. Uruchom ds-migrate-colors.sh na packages/core/src/modules/customers/
  22. Uruchom ds-migrate-typography.sh na tym samym module
  23. Manual review + fix edge cases + screenshots before/after
  24. yarn lint && yarn typecheck && yarn test
  → Commit: "refactor(ds): migrate customers module to DS tokens"

SOBOTA 10:00–11:00 (BLOK 6 — Wrap-up):
  25. Zaktualizuj AGENTS.md z DS rules
  26. Zaktualizuj PR template z DS compliance checkboxami
  27. Uruchom ds-health-check.sh — zapisz baseline do .ai/reports/
  28. Final yarn lint && yarn typecheck
  → Commit: "docs(ds): update AGENTS.md, PR template, baseline report"
```

**Bufor:** ~5h na edge case'y, Section component (jeśli nie zmieścił się w B3), dark mode fine-tuning.
**Cut lines:** Patrz sekcja B.1 — MUST HAVE to Bloki 1+2 (8h).

---

---

## K. Module Scaffold & Contributor Guardrails

### K.1 Page Templates

Trzy szablony pokrywają ~95% stron w systemie. Każdy używa wyłącznie komponentów z design systemu.

#### K.1.1 List Page Template

```tsx
// backend/<module>/page.tsx — szablon strony listy
'use client'

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, type ColumnDef } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'

export default function ListPage() {
  const t = useT()
  const { confirm } = useConfirmDialog()
  const [rows, setRows] = useState<YourEntity[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 0 })
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    apiCall(`/api/your-module?page=${pagination.page}&pageSize=${pagination.pageSize}&search=${search}`)
      .then((res) => {
        if (cancelled) return
        if (res.ok) {
          setRows(res.result.data)
          setPagination((prev) => ({ ...prev, total: res.result.total, totalPages: res.result.totalPages }))
        }
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [pagination.page, pagination.pageSize, search])

  const columns: ColumnDef<YourEntity>[] = [
    { accessorKey: 'name', header: t('module.name', 'Name') },
    {
      accessorKey: 'status',
      header: t('module.status', 'Status'),
      cell: ({ row }) => (
        <StatusBadge variant={mapStatusToVariant(row.original.status)}>
          {t(`module.status.${row.original.status}`, row.original.status)}
        </StatusBadge>
      ),
    },
  ]

  // ✅ WYMAGANE: EmptyState gdy brak danych (nie polegaj na pustej tabeli)
  if (!isLoading && rows.length === 0 && !search) {
    return (
      <Page>
        <PageBody>
          <EmptyState
            title={t('module.empty.title', 'No items yet')}
            description={t('module.empty.description', 'Create your first item to get started.')}
            action={{ label: t('module.create', 'Create item'), onClick: () => router.push('create') }}
          />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <DataTable
          columns={columns}
          data={rows}
          isLoading={isLoading}
          pagination={pagination}
          onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))}
          searchValue={search}
          onSearchChange={setSearch}
          headerActions={
            <Button size="sm" onClick={() => router.push('create')}>
              <Plus className="mr-2 h-4 w-4" />
              {t('module.create', 'Create')}
            </Button>
          }
        />
      </PageBody>
    </Page>
  )
}

// Metadata — wymagane dla RBAC i breadcrumbs
export const metadata = {
  title: 'module.list.title',
  requireAuth: true,
  requireFeatures: ['module.view'],
  breadcrumb: [{ labelKey: 'module.list.title', label: 'Items' }],
}
```

#### K.1.2 Create Page Template

```tsx
// backend/<module>/create/page.tsx — szablon strony tworzenia
'use client'

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { useRouter } from 'next/navigation'

export default function CreatePage() {
  const t = useT()
  const router = useRouter()

  const fields: CrudField[] = [
    { id: 'name', label: t('module.name', 'Name'), type: 'text', required: true },
    { id: 'status', label: t('module.status', 'Status'), type: 'select', options: STATUS_OPTIONS },
    { id: 'description', label: t('module.description', 'Description'), type: 'textarea' },
  ]

  const handleSubmit = async (values: Record<string, unknown>) => {
    const customFields = collectCustomFieldValues(values)
    const result = await createCrud('/api/your-module', { ...values, customFields })
    if (!result.ok) {
      throw createCrudFormError(
        t('module.create.error', 'Failed to create item'),
        result.errors,
      )
    }
    flash(t('module.create.success', 'Item created'), 'success')
    router.push(`/backend/your-module/${result.result.id}`)
  }

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('module.create.title', 'Create item')}
          fields={fields}
          entityIds={['your_entity']}  {/* ← custom fields */}
          onSubmit={handleSubmit}
          backHref="/backend/your-module"
          cancelHref="/backend/your-module"
          submitLabel={t('common.create', 'Create')}
        />
      </PageBody>
    </Page>
  )
}

export const metadata = {
  title: 'module.create.title',
  requireAuth: true,
  requireFeatures: ['module.create'],
  breadcrumb: [
    { labelKey: 'module.list.title', label: 'Items', href: '/backend/your-module' },
    { labelKey: 'module.create.title', label: 'Create' },
  ],
}
```

#### K.1.3 Detail Page Template

```tsx
// backend/<module>/[id]/page.tsx — szablon strony szczegółów
'use client'

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

export default function DetailPage({ params }: { params: { id: string } }) {
  const t = useT()
  const router = useRouter()
  const { confirm } = useConfirmDialog()
  const [data, setData] = useState<YourEntity | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiCall(`/api/your-module/${params.id}`)
      .then((res) => {
        if (cancelled) return
        if (res.ok) setData(res.result)
        else setError(t('module.detail.notFound', 'Item not found'))
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [params.id])

  // ✅ WYMAGANE: LoadingMessage zamiast surowego Spinner
  if (isLoading) return <LoadingMessage />
  // ✅ WYMAGANE: ErrorMessage zamiast surowego tekstu
  if (error || !data) return <ErrorMessage message={error ?? t('module.detail.notFound', 'Not found')} />

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: t('module.delete.confirm.title', 'Delete item?'),
      description: t('module.delete.confirm.description', 'This action cannot be undone.'),
      variant: 'destructive',
    })
    if (!confirmed) return
    const result = await deleteCrud(`/api/your-module/${params.id}`)
    if (result.ok) {
      flash(t('module.delete.success', 'Item deleted'), 'success')
      router.push('/backend/your-module')
    } else {
      flash(t('module.delete.error', 'Failed to delete'), 'error')
    }
  }

  return (
    <Page>
      <PageBody>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{data.name}</h2>
            <StatusBadge variant={mapStatusToVariant(data.status)}>
              {t(`module.status.${data.status}`, data.status)}
            </StatusBadge>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push(`edit`)}>
              {t('common.edit', 'Edit')}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t('common.delete', 'Delete')}
            </Button>
          </div>
        </div>
        {/* Sekcje szczegółów — tab layout jeśli >3 sekcji */}
      </PageBody>
    </Page>
  )
}

export const metadata = {
  title: 'module.detail.title',
  requireAuth: true,
  requireFeatures: ['module.view'],
}
```

### K.2 Reference Module Documentation

Moduł **customers** (`packages/core/src/modules/customers/`) to referencyjny wzorzec z ~300 plików. Poniżej kluczowe pliki do studiowania przy tworzeniu nowego modułu:

| Wzorzec | Plik referencyjny | Co studiować |
|---------|-------------------|--------------|
| Lista z DataTable | `backend/customers/companies/page.tsx` | Kolumny, paginacja, filtry, RowActions, bulk actions |
| Tworzenie z CrudForm | `backend/customers/companies/create/page.tsx` | Pola formularza, walidacja, custom fields, flash |
| Szczegóły z tabami | `backend/customers/companies/[id]/page.tsx` | Ładowanie, taby, sekcje, guarded mutations |
| CRUD API route | `api/companies/route.ts` | makeCrudRoute, openApi, query engine |
| Komendy (Command pattern) | `commands/companies.ts` | create/update/delete z undo, before/after snapshots |
| Walidatory Zod | `data/validators.ts` | Schema per entity, reużywalność |
| Encje ORM | `data/entities.ts` | PK, FK, organization_id, timestamps |
| ACL features | `acl.ts` | Konwencja `module.action`, granulacja |
| Setup tenanta | `setup.ts` | defaultRoleFeatures, seedDefaults |
| Eventy | `events.ts` | createModuleEvents, CRUD events |
| Search config | `search.ts` | Fulltext fields, facets, entity mapping |
| Custom entities | `ce.ts` | Deklaracje pól per encja |
| Tłumaczenia | `i18n/en.json` | Klucze, struktura, fallbacki |

**Zasada**: zanim napiszesz nowy moduł, przeczytaj **cały** `packages/core/src/modules/customers/AGENTS.md`.

### K.3 Scaffold Script

Skrypt generujący szkielet nowego modułu z page templates wbudowanymi:

```bash
#!/usr/bin/env bash
# ds-scaffold-module.sh — scaffold nowego modułu z DS-compliant templates
# Użycie: ./ds-scaffold-module.sh <module_name> <entity_name>
# Przykład: ./ds-scaffold-module.sh invoices invoice

set -euo pipefail

MODULE="$1"
ENTITY="$2"

if [[ -z "$MODULE" || -z "$ENTITY" ]]; then
  echo "Usage: $0 <module_name> <entity_name>"
  echo "  module_name: plural, snake_case (e.g., invoices)"
  echo "  entity_name: singular, snake_case (e.g., invoice)"
  exit 1
fi

# Walidacja konwencji nazewniczej
if [[ "$MODULE" =~ [A-Z] ]]; then
  echo "ERROR: module_name must be snake_case (got: $MODULE)"
  exit 1
fi

MODULE_DIR="packages/core/src/modules/${MODULE}"

if [[ -d "$MODULE_DIR" ]]; then
  echo "ERROR: Module directory already exists: $MODULE_DIR"
  exit 1
fi

ENTITY_CAMEL=$(echo "$ENTITY" | perl -pe 's/_(\w)/uc($1)/ge')
ENTITY_PASCAL=$(echo "$ENTITY_CAMEL" | perl -pe 's/^(\w)/uc($1)/e')
MODULE_CAMEL=$(echo "$MODULE" | perl -pe 's/_(\w)/uc($1)/ge')

echo "Scaffolding module: $MODULE (entity: $ENTITY)"

# Tworzenie struktury katalogów
mkdir -p "$MODULE_DIR"/{api/"$MODULE",backend/"$MODULE"/{create,"[id]"},commands,components,data,i18n,lib,widgets}

# index.ts
cat > "$MODULE_DIR/index.ts" << 'TMPL'
import type { ModuleMetadata } from '@open-mercato/shared/lib/module'

export const metadata: ModuleMetadata = {
  id: '__MODULE__',
  label: '__ENTITY_PASCAL__s',
}
TMPL
perl -i -pe "s/__MODULE__/$MODULE/g; s/__ENTITY_PASCAL__/$ENTITY_PASCAL/g" "$MODULE_DIR/index.ts"

# acl.ts
cat > "$MODULE_DIR/acl.ts" << 'TMPL'
import type { FeatureDefinition } from '@open-mercato/shared/lib/acl'

export const features: FeatureDefinition[] = [
  { id: '__MODULE__.view', label: 'View __MODULE__' },
  { id: '__MODULE__.create', label: 'Create __MODULE__' },
  { id: '__MODULE__.update', label: 'Update __MODULE__' },
  { id: '__MODULE__.delete', label: 'Delete __MODULE__' },
]
TMPL
perl -i -pe "s/__MODULE__/$MODULE/g" "$MODULE_DIR/acl.ts"

# data/validators.ts
cat > "$MODULE_DIR/data/validators.ts" << 'TMPL'
import { z } from 'zod'

export const __ENTITY_CAMEL__Schema = z.object({
  name: z.string().min(1),
})

export type __ENTITY_PASCAL__Input = z.infer<typeof __ENTITY_CAMEL__Schema>
TMPL
perl -i -pe "s/__ENTITY_CAMEL__/$ENTITY_CAMEL/g; s/__ENTITY_PASCAL__/$ENTITY_PASCAL/g" "$MODULE_DIR/data/validators.ts"

# i18n/en.json — klucze tłumaczeń
cat > "$MODULE_DIR/i18n/en.json" << TMPL
{
  "$MODULE": {
    "list": { "title": "${ENTITY_PASCAL}s" },
    "create": { "title": "Create $ENTITY_PASCAL", "success": "$ENTITY_PASCAL created", "error": "Failed to create" },
    "detail": { "title": "$ENTITY_PASCAL details", "notFound": "$ENTITY_PASCAL not found" },
    "delete": {
      "success": "$ENTITY_PASCAL deleted",
      "error": "Failed to delete",
      "confirm": { "title": "Delete $ENTITY_PASCAL?", "description": "This action cannot be undone." }
    },
    "empty": { "title": "No ${ENTITY_PASCAL}s yet", "description": "Create your first $ENTITY_PASCAL to get started." },
    "name": "Name",
    "status": "Status"
  }
}
TMPL

echo ""
echo "✓ Module scaffolded at: $MODULE_DIR"
echo ""
echo "Next steps:"
echo "  1. Add entities in data/entities.ts (copy pattern from customers)"
echo "  2. Add backend pages (templates already follow DS guidelines)"
echo "  3. Add API routes in api/$MODULE/route.ts"
echo "  4. Register in apps/mercato/src/modules.ts"
echo "  5. Run: yarn generate && yarn db:generate"
echo "  6. Run: yarn lint && yarn build:packages"
echo ""
echo "Reference: packages/core/src/modules/customers/"
```

**Kluczowe cechy scaffoldu:**
- Wymusza snake_case dla nazw modułów
- Generuje i18n klucze od razu (brak hardcoded strings)
- Tworzy strukturę katalogów zgodną z auto-discovery
- Nie generuje stron — contributor kopiuje z K.1 templates i dostosowuje

---

## L. Structural Lint Rules

Sześć reguł ESLint do egzekwowania design systemu. Projekt używa ESLint v9 flat config (`eslint.config.mjs`). Reguły zaimplementowane jako custom plugin `eslint-plugin-open-mercato-ds`.

### L.0 Strategia wdrożenia

```
eslint-plugin-open-mercato-ds/
├── index.ts                    — plugin entry, exportuje rules + recommended config
├── rules/
│   ├── require-empty-state.ts
│   ├── require-page-wrapper.ts
│   ├── no-raw-table.ts
│   ├── require-loading-state.ts
│   ├── require-status-badge.ts
│   └── no-hardcoded-status-colors.ts
└── utils/
    └── ast-helpers.ts          — wspólne selektory AST
```

Dodanie do `eslint.config.mjs`:

```js
import omDs from './eslint-plugin-open-mercato-ds/index.js'

export default [
  // ... existing config
  {
    plugins: { 'om-ds': omDs },
    files: ['packages/core/src/modules/**/backend/**/*.tsx'],
    rules: {
      'om-ds/require-empty-state': 'warn',      // warn → error po migracji
      'om-ds/require-page-wrapper': 'error',
      'om-ds/no-raw-table': 'error',
      'om-ds/require-loading-state': 'warn',
      'om-ds/require-status-badge': 'warn',
      'om-ds/no-hardcoded-status-colors': 'error',
    },
  },
]
```

**Rollout plan**: Wszystkie reguły startują jako `warn` na istniejącym kodzie. Nowe moduły (tworzone po hackathonie) mają `error`. Po migracji modułu → przełączamy na `error` globalnie.

### L.1 `om-ds/require-empty-state`

**Cel**: Każda strona z DataTable musi mieć EmptyState.

```ts
// rules/require-empty-state.ts — pseudo-implementacja
import type { Rule } from 'eslint'

export const requireEmptyState: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require EmptyState component in pages that use DataTable',
    },
    messages: {
      missingEmptyState:
        'Pages with DataTable must include an EmptyState component for the zero-data case. ' +
        'Import EmptyState from @open-mercato/ui/backend/EmptyState.',
    },
    schema: [],
  },
  create(context) {
    let hasDataTable = false
    let hasEmptyState = false

    return {
      // Szukamy importu DataTable
      ImportDeclaration(node) {
        const source = node.source.value
        if (typeof source === 'string' && source.includes('DataTable')) {
          for (const spec of node.specifiers) {
            if (spec.type === 'ImportSpecifier' && spec.imported.name === 'DataTable') {
              hasDataTable = true
            }
          }
        }
        if (typeof source === 'string' && source.includes('EmptyState')) {
          hasEmptyState = true
        }
      },
      // Szukamy użycia <EmptyState w JSX
      JSXIdentifier(node: any) {
        if (node.name === 'EmptyState') {
          hasEmptyState = true
        }
      },
      'Program:exit'(node) {
        if (hasDataTable && !hasEmptyState) {
          context.report({ node, messageId: 'missingEmptyState' })
        }
      },
    }
  },
}
```

### L.2 `om-ds/require-page-wrapper`

**Cel**: Backend pages muszą używać `<Page>` + `<PageBody>` jako wrapper.

```ts
// rules/require-page-wrapper.ts — pseudo-implementacja
export const requirePageWrapper: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require Page and PageBody wrappers in backend pages',
    },
    messages: {
      missingPage: 'Backend pages must wrap content in <Page><PageBody>...</PageBody></Page>. ' +
        'Import from @open-mercato/ui/backend/Page.',
      missingPageBody: 'Found <Page> without <PageBody> child.',
    },
    schema: [],
  },
  create(context) {
    let hasPageImport = false
    let hasPageBodyImport = false
    let hasPageJSX = false
    let hasPageBodyJSX = false

    return {
      ImportDeclaration(node) {
        const source = node.source.value
        if (typeof source === 'string' && source.includes('/Page')) {
          for (const spec of node.specifiers) {
            if (spec.type === 'ImportSpecifier') {
              if (spec.imported.name === 'Page') hasPageImport = true
              if (spec.imported.name === 'PageBody') hasPageBodyImport = true
            }
          }
        }
      },
      JSXIdentifier(node: any) {
        if (node.name === 'Page') hasPageJSX = true
        if (node.name === 'PageBody') hasPageBodyJSX = true
      },
      'Program:exit'(node) {
        // Tylko pliki w backend/ z default export (page components)
        const filename = context.filename ?? context.getFilename()
        if (!filename.includes('/backend/')) return

        const hasDefaultExport = node.body.some(
          (n: any) => n.type === 'ExportDefaultDeclaration' ||
            (n.type === 'ExportNamedDeclaration' && n.declaration?.declarations?.[0]?.id?.name === 'default'),
        )
        if (!hasDefaultExport) return

        if (!hasPageJSX) {
          context.report({ node, messageId: 'missingPage' })
        } else if (!hasPageBodyJSX) {
          context.report({ node, messageId: 'missingPageBody' })
        }
      },
    }
  },
}
```

### L.3 `om-ds/no-raw-table`

**Cel**: Zakaz użycia `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<td>`, `<th>` bezpośrednio w backend pages. Wymuszenie DataTable lub primitives/table.

```ts
// rules/no-raw-table.ts — pseudo-implementacja
const RAW_TABLE_ELEMENTS = ['table', 'thead', 'tbody', 'tr', 'td', 'th']

export const noRawTable: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow raw HTML table elements in backend pages',
    },
    messages: {
      noRawTable:
        'Do not use raw <{{element}}> in backend pages. ' +
        'Use DataTable from @open-mercato/ui/backend/DataTable or ' +
        'Table primitives from @open-mercato/ui/primitives/table.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node: any) {
        const filename = context.filename ?? context.getFilename()
        if (!filename.includes('/backend/')) return

        if (node.name.type === 'JSXIdentifier' && RAW_TABLE_ELEMENTS.includes(node.name.name)) {
          context.report({
            node,
            messageId: 'noRawTable',
            data: { element: node.name.name },
          })
        }
      },
    }
  },
}
```

### L.4 `om-ds/require-loading-state`

**Cel**: Strony z asynchronicznym pobieraniem danych muszą mieć LoadingMessage lub przekazywać `isLoading` do DataTable.

```ts
// rules/require-loading-state.ts — pseudo-implementacja
export const requireLoadingState: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require explicit loading state handling in pages with async data',
    },
    messages: {
      missingLoadingState:
        'Pages using apiCall() must handle loading state. ' +
        'Use LoadingMessage from @open-mercato/ui/backend/detail ' +
        'or pass isLoading prop to DataTable.',
    },
    schema: [],
  },
  create(context) {
    let hasApiCall = false
    let hasLoadingMessage = false
    let hasIsLoadingProp = false
    let hasSpinner = false

    return {
      CallExpression(node: any) {
        if (node.callee.name === 'apiCall' || node.callee.name === 'apiCallOrThrow') {
          hasApiCall = true
        }
      },
      JSXIdentifier(node: any) {
        if (node.name === 'LoadingMessage') hasLoadingMessage = true
        if (node.name === 'Spinner') hasSpinner = true
      },
      JSXAttribute(node: any) {
        if (node.name?.name === 'isLoading') hasIsLoadingProp = true
      },
      'Program:exit'(node) {
        if (hasApiCall && !hasLoadingMessage && !hasIsLoadingProp && !hasSpinner) {
          context.report({ node, messageId: 'missingLoadingState' })
        }
      },
    }
  },
}
```

### L.5 `om-ds/require-status-badge`

**Cel**: Statusy (active/inactive, draft/published, itp.) muszą używać StatusBadge, nie surowego tekstu ani custom `<span>`.

```ts
// rules/require-status-badge.ts — pseudo-implementacja
// Heurystyka: szukamy kolumn DataTable z accessorKey zawierającym 'status'
// które nie renderują StatusBadge w cell renderer

export const requireStatusBadge: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require StatusBadge for status-like columns in DataTable',
    },
    messages: {
      useStatusBadge:
        'Status columns should use <StatusBadge> for consistent visual treatment. ' +
        'Import from @open-mercato/ui/primitives/status-badge.',
    },
    schema: [],
  },
  create(context) {
    // Heurystyka: Zbieramy definicje kolumn z accessorKey zawierającym 'status'
    // i sprawdzamy czy cell renderer zawiera JSX z StatusBadge lub Badge

    let hasStatusBadgeImport = false
    let hasBadgeImport = false

    return {
      ImportDeclaration(node) {
        const source = String(node.source.value)
        for (const spec of node.specifiers) {
          if (spec.type === 'ImportSpecifier') {
            if (spec.imported.name === 'StatusBadge') hasStatusBadgeImport = true
            if (spec.imported.name === 'Badge') hasBadgeImport = true
          }
        }
      },
      // Szukamy obiektów z accessorKey: '...status...' i brak StatusBadge w cell
      Property(node: any) {
        if (
          node.key?.name === 'accessorKey' &&
          node.value?.type === 'Literal' &&
          typeof node.value.value === 'string' &&
          node.value.value.toLowerCase().includes('status')
        ) {
          // Jeśli moduł nie importuje StatusBadge ani Badge — raportuj
          if (!hasStatusBadgeImport && !hasBadgeImport) {
            context.report({ node, messageId: 'useStatusBadge' })
          }
        }
      },
    }
  },
}
```

### L.6 `om-ds/no-hardcoded-status-colors`

**Cel**: Zakaz hardcoded kolorów statusów. Wymuszenie semantic tokens.

```ts
// rules/no-hardcoded-status-colors.ts — pseudo-implementacja
// Rozszerzenie istniejącej logiki z sekcji E

const FORBIDDEN_PATTERNS = [
  // Tailwind hardcoded status colors
  /\b(?:text|bg|border)-(?:red|green|yellow|orange|blue|emerald|amber|rose|lime)-\d{2,3}\b/,
  // Inline style colors for statuses
  /color:\s*(?:#(?:ef4444|f59e0b|10b981|3b82f6|dc2626|eab308))/i,
  // oklch hardcoded (powinny być tokeny)
  /oklch\(\s*0\.(?:577|704)\s+0\.(?:245|191)\s+(?:27|22)\b/,
]

const ALLOWED_REPLACEMENTS: Record<string, string> = {
  'text-red-600': 'text-destructive',
  'text-red-500': 'text-destructive',
  'bg-red-50': 'bg-status-error-bg',
  'bg-red-100': 'bg-status-error-bg',
  'border-red-200': 'border-status-error-border',
  'text-green-600': 'text-status-success-text',
  'text-green-500': 'text-status-success-text',
  'bg-green-50': 'bg-status-success-bg',
  'bg-green-100': 'bg-status-success-bg',
  'text-yellow-600': 'text-status-warning-text',
  'text-amber-600': 'text-status-warning-text',
  'bg-yellow-50': 'bg-status-warning-bg',
  'bg-amber-50': 'bg-status-warning-bg',
  'text-blue-600': 'text-status-info-text',
  'bg-blue-50': 'bg-status-info-bg',
}

export const noHardcodedStatusColors: Rule.RuleModule = {
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: {
      description: 'Disallow hardcoded status colors — use semantic DS tokens',
    },
    messages: {
      hardcodedColor:
        'Hardcoded status color "{{found}}" detected. ' +
        'Use semantic token instead: {{replacement}}. ' +
        'See globals.css for --status-* tokens.',
    },
    schema: [],
  },
  create(context) {
    return {
      // Sprawdzamy atrybuty className w JSX
      JSXAttribute(node: any) {
        if (node.name?.name !== 'className') return

        const value = node.value
        if (!value) return

        // String literal
        if (value.type === 'Literal' && typeof value.value === 'string') {
          checkClassString(context, node, value.value)
        }

        // Template literal
        if (value.type === 'JSXExpressionContainer' && value.expression?.type === 'TemplateLiteral') {
          for (const quasi of value.expression.quasis) {
            checkClassString(context, node, quasi.value.raw)
          }
        }
      },
    }

    function checkClassString(ctx: Rule.RuleContext, node: any, classStr: string) {
      const classes = classStr.split(/\s+/)
      for (const cls of classes) {
        const replacement = ALLOWED_REPLACEMENTS[cls]
        if (replacement) {
          ctx.report({
            node,
            messageId: 'hardcodedColor',
            data: { found: cls, replacement },
          })
        }
      }
    }
  },
}
```

### L.7 Podsumowanie reguł

| Reguła | Severity (nowy kod) | Severity (legacy) | Auto-fix |
|--------|---------------------|--------------------|----------|
| `om-ds/require-empty-state` | error | warn | ✗ |
| `om-ds/require-page-wrapper` | error | error | ✗ |
| `om-ds/no-raw-table` | error | error | ✗ |
| `om-ds/require-loading-state` | error | warn | ✗ |
| `om-ds/require-status-badge` | error | warn | ✗ |
| `om-ds/no-hardcoded-status-colors` | error | error | ✓ (sugestia) |

**Metryka sukcesu**: 0 warnings na nowych modułach, legacy warnings ↓30% per sprint.

---

## M. Contributor Onboarding — "Your First Module" Guide

### M.1 Before-You-Start Checklist

Zanim napiszesz pierwszą linijkę kodu nowego modułu, sprawdź:

- [ ] **Przeczytałem AGENTS.md** — Task Router wskazuje na właściwe guide'y
- [ ] **Przeczytałem `packages/core/AGENTS.md`** — auto-discovery, module files, konwencje
- [ ] **Przeczytałem `packages/core/src/modules/customers/AGENTS.md`** — referencyjny moduł CRUD
- [ ] **Przeczytałem `packages/ui/AGENTS.md`** — komponenty UI, DataTable, CrudForm
- [ ] **Sprawdziłem `.ai/specs/`** — czy istnieje spec dla mojego modułu
- [ ] **Mam zainstalowane narzędzia**: `yarn`, Node ≥20, Docker (dla DB)
- [ ] **Zbudowałem projekt**: `yarn initialize` przeszło bez błędów
- [ ] **Uruchomiłem dev**: `yarn dev` działa, widzę dashboard w przeglądarce

### M.2 Step-by-Step: Tworzenie modułu

**Krok 1 — Scaffold**
```bash
# Opcja A: scaffold script (z sekcji K.3)
./ds-scaffold-module.sh invoices invoice

# Opcja B: ręcznie — skopiuj strukturę z customers i wyczyść
```

**Krok 2 — Zdefiniuj encję**
```
data/entities.ts → MikroORM entity z id, organization_id, timestamps
data/validators.ts → Zod schema per endpoint
```
Wzór: `packages/core/src/modules/customers/data/entities.ts`

**Krok 3 — Dodaj CRUD API**
```
api/<module>/route.ts → makeCrudRoute + openApi export
```
Wzór: `packages/core/src/modules/customers/api/companies/route.ts`

**Krok 4 — Stwórz strony backend**
```
backend/<module>/page.tsx       → List (template K.1.1)
backend/<module>/create/page.tsx → Create (template K.1.2)
backend/<module>/[id]/page.tsx   → Detail (template K.1.3)
```
**WAŻNE**: Każdy template wymaga — `Page`+`PageBody`, `useT()`, `EmptyState`, `LoadingMessage`/`isLoading`, `StatusBadge` dla statusów.

**Krok 5 — ACL + Setup**
```
acl.ts   → features: view, create, update, delete
setup.ts → defaultRoleFeatures (admin = all, user = view)
```

**Krok 6 — i18n**
```
i18n/en.json → wszystkie user-facing strings
i18n/pl.json → tłumaczenia (jeśli dotyczy)
```

**Krok 7 — Rejestracja**
```
apps/mercato/src/modules.ts → dodaj moduł
yarn generate && yarn db:generate && yarn db:migrate
```

**Krok 8 — Weryfikacja**
```bash
yarn lint                 # 0 errors, 0 warnings
yarn build:packages       # builds clean
yarn test                 # existing tests pass
yarn dev                  # nowy moduł widoczny w sidebar
```

### M.3 Self-Check: 10 pytań przed PR

Odpowiedz TAK na każde pytanie zanim otworzysz Pull Request:

| # | Pytanie | Dotyczy |
|---|---------|---------|
| 1 | Czy **każda** strona listy ma `<EmptyState>` z akcją tworzenia? | UX |
| 2 | Czy strony detail/edit mają `<LoadingMessage>` i `<ErrorMessage>`? | UX |
| 3 | Czy **wszystkie** user-facing strings używają `useT()` / `resolveTranslations()`? | i18n |
| 4 | Czy statusy renderowane są przez `<StatusBadge>` (nie surowy tekst/span)? | Design System |
| 5 | Czy kolory statusów używają semantic tokens (`text-destructive`, `bg-status-*-bg`)? | Design System |
| 6 | Czy formularze używają `<CrudForm>` (nie ręczne `<form>`)? | Spójność |
| 7 | Czy API routes mają `openApi` export? | Dokumentacja |
| 8 | Czy strony mają `metadata` z `requireAuth` i `requireFeatures`? | Bezpieczeństwo |
| 9 | Czy `setup.ts` deklaruje `defaultRoleFeatures` dla features z `acl.ts`? | RBAC |
| 10 | Czy `yarn lint && yarn build:packages` przechodzi bez błędów? | CI |

### M.4 Top 5 Anti-Patterns

| # | Anti-pattern | Dlaczego źle | Co zamiast |
|---|-------------|--------------|------------|
| 1 | **Hardcoded strings** `<h1>My Module</h1>` | Łamie i18n, blokuje tłumaczenia | `<h1>{t('module.title', 'My Module')}</h1>` |
| 2 | **Pusta tabela zamiast EmptyState** — DataTable z 0 rows bez żadnego CTA | Użytkownik nie wie co robić, bounce rate ↑ | Warunkowy `<EmptyState>` z akcją tworzenia gdy `rows.length === 0 && !search` |
| 3 | **Raw `fetch()`** zamiast `apiCall()` | Brak obsługi auth, cache, error handling | `apiCall('/api/...')` z `@open-mercato/ui/backend/utils/apiCall` |
| 4 | **Tailwind color classes** `text-red-600`, `bg-green-100` dla statusów | Niespójne z dark mode, brak central governance | Semantic tokens: `text-destructive`, `bg-status-success-bg` |
| 5 | **Brak `metadata` z RBAC** — strona bez `requireAuth` / `requireFeatures` | Każdy zalogowany widzi stronę, nawet bez uprawnień | Dodaj `metadata.requireFeatures: ['module.view']` |

---

---

## N. Stakeholder Buy-in Strategy

### N.1 Elevator Pitch (30 sekund)

#### Wariant 1 — Dla maintainera modułu

> Open Mercato ma 372 hardcoded kolory i 4 różne komponenty feedbacku robiące to samo — to znaczy, że każdy PR z UI zmianami wymaga 2-3 rund review żeby wyłapać niespójności, a dark mode psuje się za każdym razem gdy ktoś doda `text-red-600`. Design system daje ci 20 semantic tokenów i 5 komponentów, które eliminują tę klasę bugów kompletnie. Migracja twojego modułu to 1-2h z codemod scriptem. W zamian: mniej review friction, zero dark mode regresji, nowy contributor do twojego modułu jest produktywny w godzinę zamiast w dwa dni.

#### Wariant 2 — Dla nowego contributora

> Chcesz dodać nowy ekran do Open Mercato? Bez design systemu musisz przejrzeć 5 różnych modułów żeby zgadnąć jakich kolorów, spacingów i komponentów użyć — i i tak reviewer odeśle twój PR bo użyłeś `text-green-600` zamiast semantic tokena. Z DS dostajesz 3 gotowe page templates (list, create, detail), 5 komponentów które pokrywają 95% przypadków, i lint rules które mówią ci co poprawić ZANIM wyślesz PR. Pierwszy ekran w 30 minut, nie w 3 godziny.

#### Wariant 3 — Dla project leada / osoby nietechnicznej

> Open Mercato ma 34 moduły i każdy wygląda trochę inaczej — 79% stron nie obsługuje pustego stanu, kolory statusów różnią się między modułami, dark mode jest popsute w wielu miejscach. Dla użytkownika to wygląda jak 34 różnych aplikacji sklejonych razem. Design system to zestaw wspólnych reguł i komponentów, który sprawia że cały produkt wygląda i działa spójnie. Inwestycja: 1 hackathon (26h) na fundament + 2h na moduł do migracji. Zwrot: spójny produkt, szybszy onboarding contributorów, accessibility compliance bez dodatkowej pracy.

### N.2 Before/After Demo Strategy

**Kiedy pokazać: PO hackathonie** (piątkowy wieczór lub sobotni poranek).

Uzasadnienie: demo PRZED hackathon buduje oczekiwania, ale nie ma czego pokazać — to jest pitch, nie demo. Demo PO daje konkretny artefakt: ten sam ekran w dwóch wersjach. Ludzie wierzą oczom, nie slide'om.

**Co pokazać — 4 screenshoty:**

1. **Before (light mode):** Customers list page z hardcoded `text-red-600` / `bg-green-100` status badges, brak empty state, różne odcienie czerwonego w różnych sekcjach. Wyraźnie widać: ten sam status "active" w jednym module jest zielony `bg-green-100`, w innym `bg-emerald-50`.

2. **After (light mode):** Ten sam ekran z `StatusBadge variant="success"`, `EmptyState` na pustej liście, spójne kolory z semantic tokenów. Wizualnie: wszystko "oddycha" tak samo, kolory pasują do siebie.

3. **Before (dark mode) — KILLER DEMO:** Customers page w dark mode. Hardcoded `text-red-600` na ciemnym tle — tekst ledwo widoczny. `bg-green-100` tworzy jaskrawą plamę. `border-red-200` jest prawie niewidoczny. Notice z `bg-red-50` wygląda jak biały prostokąt.

4. **After (dark mode):** Ten sam ekran z flat semantic tokens. `--status-error-bg: oklch(0.220 0.025 25)` daje kontrolowany ciemny czerwony. `--status-success-text: oklch(0.750 0.150 163)` jest czytelny. Kontrast sprawdzony, nie zgadywany.

**Gdzie pokazać:** GitHub Discussion z kategorią "Show & Tell". Post z 4 screenshotami side-by-side. Link do tego posta w README projektu na 2 tygodnie ("See what's changing"). Discussion pozwala na async komentarze — nie wymaga synchronicznego call'a, co jest realistyczne w OSS.

**Dark mode killer demo scenario script:**

> "Pokażę wam coś. To jest strona listy w customers — dark mode. Widzicie ten badge 'Active'? `bg-green-100` na czarnym tle. Wygląda jak bug. Bo to jest bug — 372 razy w kodzie. Teraz ta sama strona po migracji. Ten sam badge, ale kolor pochodzi z tokena, który ma oddzielną wartość dla dark mode. Zero zmian w logice, zero zmian w layoucie — jedyna różnica to skąd pochodzi kolor. A teraz pomnóżcie to razy 34 moduły. To jest design system — nie nowe komponenty, nie redesign. To naprawienie 372 kolorów żeby dark mode po prostu działał."

### N.3 "What's In It For You" — per persona

#### 1. Maintainer modułu (np. Sales)

- **Mniej review rounds:** Zamiast 2-3 rund komentarzy "zmień text-red-600 na text-destructive", lint rule łapie to przed PR. Oszczędzasz 20-30 min per review.
- **Dark mode działa od razu:** Semantic tokens automatycznie przełączają się w dark mode. Zero manual testowania, zero bugów typu "biały tekst na białym tle".
- **Nowy contributor do twojego modułu jest produktywny szybciej:** Zamiast tłumaczyć "jak budujemy strony w Sales", wskazujesz na template list page z sekcji K.1 i mówisz "skopiuj, dostosuj". Onboarding z 2 dni do 2 godzin.

#### 2. Nowy contributor (pierwszy PR)

- **Zero zgadywania:** 3 page templates pokrywają 95% przypadków. Kopiujesz, zamieniasz nazwę encji, dodajesz pola. Gotowe.
- **Lint mówi ci co źle ZANIM reviewer:** `om-ds/require-empty-state` podkreśla problem w edytorze. Nie dowiadujesz się o nim w review po 2 dniach czekania.
- **Mniej decyzji:** Nie musisz wybierać między `text-red-500`, `text-red-600`, `text-red-700`, `text-destructive`. Jest jedna odpowiedź: semantic token. Zawsze.

#### 3. Power contributor (10+ PR-ów, ma "swoje" sposoby)

- **Twoje patterns stają się oficjalne:** Jeśli twój moduł ma dobrze zrobione status badges — pokaż jak. DS formalizuje najlepsze patterns z codebase, nie wymyśla nowe.
- **Mniejszy diff w PR-ach:** Spójne base components oznaczają mniejsze pliki page — mniej kodu do napisania, mniej do review, mniejsze difffy.
- **Wpływ na API komponentów:** Champions program (sekcja P) daje ci głos w kształtowaniu API. Lepiej wpływać na standard niż potem do niego migrować.

#### 4. End user (klient Open Mercato)

- **Produkt wygląda profesjonalnie:** Spójne kolory, typografia i zachowania między modułami = zaufanie do produktu.
- **Dark mode naprawdę działa:** 372 poprawione kolory oznaczają, że dark mode jest użyteczny, nie dekoracyjny.
- **Puste stany nie są ślepymi zaułkami:** 79% stron bez empty state → 0%. Zawsze wiesz co robić gdy nie ma danych.

#### 5. Project lead

- **Mierzalny postęp:** `ds-health-check.sh` daje baseline i trend. Wiesz ile pracy zostało, ile zrobiono.
- **Accessibility bez dedykowanego audytu:** Semantic tokens + enforced aria-labels + contrast-checked paleta = compliance z WCAG 2.1 AA "za darmo".
- **Redukcja maintenance cost:** 4 komponenty feedbacku → 1. 372 hardcoded kolorów → 20 tokenów. Mniej kodu = mniej bugów = mniej pracy.

---

## O. Contributor Experience (CX) Design

### O.1 Contributor Journey Map

#### Krok 1: Discovery — "Jakie komponenty istnieją?"

| | Obecny stan (bez DS) | Docelowy stan (z DS) |
|---|---|---|
| **Co robi** | Przegląda `packages/ui/src/primitives/`, grepuje "import.*from.*ui", otwiera customers module i czyta code | Otwiera `packages/ui/DS.md`, skanuje spis komponentów |
| **Czego szuka** | "Czy jest komponent do statusu?" "Co to jest Notice vs Alert?" | Spis komponentów z jednolinijkowym opisem i linkiem |
| **Co może pójść źle** | Znajduje Notice I Alert, nie wie którego użyć. Buduje własny. | Widzi jasno: "Alert (unified) — użyj tego. Notice jest deprecated." |
| **Jak DS pomaga** | — | Single entry point z listą komponentów, searchable, z "when to use" |

#### Krok 2: Decision — "Którego komponentu użyć?"

| | Obecny stan | Docelowy stan |
|---|---|---|
| **Co robi** | Porównuje 3-4 moduły, patrzy jak inni rozwiązali problem. Kopiuje z tego który wygląda najnowiej. | Patrzy na decision tree w DS docs: "Wyświetlasz status? → StatusBadge. Listę danych? → DataTable. Formularz? → CrudForm." |
| **Co może pójść źle** | Kopiuje z modułu który ma legacy patterns (hardcoded colors). Teraz legacy rozpropagatowało się do nowego modułu. | Decision tree wskazuje prawidłowy komponent. Template z K.1 daje gotowy kod. |
| **Jak DS pomaga** | — | Decision tree + "Use This Not That" tabela (Notice❌ → Alert✅, raw table❌ → DataTable✅) |

#### Krok 3: Implementation — "Jak tego użyć?"

| | Obecny stan | Docelowy stan |
|---|---|---|
| **Co robi** | Otwiera customers module, kopiuje page.tsx, modyfikuje. Nie wie o EmptyState, nie wie o StatusBadge. | Kopiuje template z K.1, zamienia nazwy. TypeScript podpowiada props. |
| **Co może pójść źle** | Zapomina o empty state (79% stron). Używa hardcoded kolorów (bo skopiował ze starego modułu). | Template zawiera EmptyState. Lint rule łapie hardcoded colors. |
| **Jak DS pomaga** | — | Templates z wbudowanymi best practices + lint rules jako safety net |

#### Krok 4: Self-check — "Czy zrobiłem dobrze?"

| | Obecny stan | Docelowy stan |
|---|---|---|
| **Co robi** | `yarn lint` (łapie tylko TypeScript/ESLint basic). Wizualnie sprawdza w przeglądarce. | `yarn lint` łapie DS violations. 10-pytaniowy self-check z M.3. |
| **Co może pójść źle** | Lint nie łapie brakującego EmptyState. Contributor nie wie, że powinien sprawdzić dark mode. | 6 DS lint rules dają konkretny feedback. Self-check przypomina o dark mode. |
| **Jak DS pomaga** | — | Lint rules + self-check checklist + ds-health-check.sh na swoim module |

#### Krok 5: PR review — "Co reviewer sprawdza?"

| | Obecny stan | Docelowy stan |
|---|---|---|
| **Co robi** | Czeka na review 1-3 dni. Reviewer komentuje: "zmień kolor", "dodaj empty state", "użyj apiCall". 2-3 rundy. | Lint wyłapał 80% issues przed PR. Reviewer sprawdza logikę i UX, nie kolory. 1 runda. |
| **Co może pójść źle** | Reviewer nie zna DS guidelines — przepuszcza hardcoded colors. Albo: reviewer jest zbyt surowy — contributor się zniechęca. | PR template z DS checklistą (z sekcji E). Reviewer ma jasne kryteria — nie "moja opinia" ale "DS standard". |
| **Jak DS pomaga** | — | PR template + reviewer checklist + lint pre-screening |

#### Krok 6: Post-merge — "Jak się uczę na przyszłość?"

| | Obecny stan | Docelowy stan |
|---|---|---|
| **Co robi** | Nic. Review feedback ginie w zamkniętym PR. Następnym razem powtarza te same błędy. | DS entry point ma "Common Mistakes" sekcję (M.4). Monthly digest podkreśla recurring issues. |
| **Co może pójść źle** | Tribal knowledge — contributor #2 nie widzi feedbacku z PR contributora #1. | Feedback z review jest uogólniony w DS docs. Anti-patterns (M.4) to żywy dokument. |
| **Jak DS pomaga** | — | Anti-patterns doc + monthly digest + feedback channel |

### O.2 Single Entry Point

**Decyzja: `packages/ui/DS.md`** — w root pakietu UI.

Uzasadnienie:
- **Nie AGENTS.md** — bo ten jest dla AI agentów, nie dla ludzi. Contributor nie będzie szukał DS guidelines w AGENTS.md.
- **Nie docs/** — bo docs/ to osobna apka dokumentacyjna. DS guidelines muszą być blisko kodu, nie w osobnym deploy.
- **Nie Storybook** — bo nie mamy Storybook i setup to osobny projekt na 2+ dni. Pragmatyzm > idealizm.
- **Dlaczego packages/ui/** — bo contributor budujący UI i tak otwiera ten pakiet. Minimalna odległość między "szukam" a "znalazłem".

**Content outline:**

```markdown
# Open Mercato Design System

> Consistency > Perfection. See Section T.4 for our philosophy.

## Quick Start (30 seconds)
Building a new page? Copy a template from `templates/` and customize.

## Component Reference
One-line description + import path for each DS component.
| Component | When to Use | Import |
|-----------|-------------|--------|

## Decision Tree
"What component do I need?" — flowchart from task → component.

## Tokens
Status colors, typography scale, spacing — link to globals.css with commentary.

## Use This, Not That
| Instead of... | Use... | Why |
Notice | Alert | Notice is deprecated, Alert has all variants
text-red-600 | text-destructive | Semantic token, works in dark mode
raw <table> | DataTable | Sorting, filtering, pagination built-in

## Templates
Links to K.1 templates: list page, create page, detail page.

## Self-Check Before PR
Link to M.3 — 10 questions.

## Anti-Patterns
Link to M.4 — top 5 mistakes.

## Feedback & Questions
GitHub Discussion category "Design System Feedback".
```

**Constraint: 60 sekund do znalezienia odpowiedzi.** Dlatego tabele, nie paragrafy. Linki, nie powtórzony content. Component Reference to max 15 wierszy — tyle mamy DS komponentów.

### O.3 Lint Error UX

#### 1. `om-ds/no-hardcoded-status-colors`

```
[om-ds/no-hardcoded-status-colors]
❌ Hardcoded color "text-red-600" in className. Status colors must use semantic tokens.
✅ Replace with: "text-destructive" (for text) or "text-status-error-text" (for status context)
📖 See: packages/ui/DS.md#tokens → Status Colors
```

#### 2. `om-ds/no-arbitrary-text-sizes`

```
[om-ds/no-arbitrary-text-sizes]
❌ Arbitrary text size "text-[11px]" detected. Use Tailwind scale or DS tokens.
✅ Replace with: "text-overline" (for 11px uppercase labels) or "text-xs" (for 12px small text)
📖 See: packages/ui/DS.md#tokens → Typography Scale
```

#### 3. `om-ds/require-empty-state`

```
[om-ds/require-empty-state]
❌ Page uses <DataTable> but has no <EmptyState> component.
   79% of existing pages miss this — don't add to the count.
✅ Add conditional EmptyState before DataTable:
   if (!isLoading && rows.length === 0 && !search) return <EmptyState title="..." action={{...}} />
📖 See: packages/ui/DS.md#templates → List Page Template
```

#### 4. `om-ds/require-page-wrapper`

```
[om-ds/require-page-wrapper]
❌ Backend page missing <Page> and <PageBody> wrappers.
   These provide consistent spacing (space-y-6, space-y-4) and page structure.
✅ Wrap your page content:
   <Page><PageBody>{/* your content */}</PageBody></Page>
📖 See: packages/ui/DS.md#templates → any template
```

#### 5. `om-ds/no-raw-table`

```
[om-ds/no-raw-table]
❌ Raw HTML <table> element in backend page. Use DS table components.
✅ For data lists: <DataTable> (sorting, filtering, pagination built-in)
   For simple key-value: <Table> from @open-mercato/ui/primitives/table
📖 See: packages/ui/DS.md#decision-tree → "Displaying data?"
```

#### 6. `om-ds/require-loading-state`

```
[om-ds/require-loading-state]
❌ Page uses apiCall() but has no loading state handler.
   41% of existing pages miss this — users see blank screens during data fetch.
✅ For detail pages: if (isLoading) return <LoadingMessage />
   For list pages: pass isLoading={isLoading} to <DataTable>
📖 See: packages/ui/DS.md#templates → Detail Page Template
```

---

## P. Champions Strategy

### P.1 Champion Profile

**Idealny champion DS w kontekście OSS:**

**Cechy techniczne:**
- Aktywny w module z dużym UI surface (Sales, Catalog, Customers — nie CLI/Queue)
- Ma co najmniej 5 merged PR-ów z komponentami backend pages
- Rozumie Tailwind i React na poziomie pozwalającym na refaktoring kolorów bez pomocy

**Cechy miękkie:**
- Odpowiada na issues / code review komentarze (nie ghost contributor)
- Wyrażał frustrację niespójnością UI lub dark mode bugami (to jest motywacja naturalna)
- Ma "ownership feeling" wobec swojego modułu — chce żeby wyglądał dobrze

**Jak go znaleźć w Open Mercato:**

```bash
# Top 10 contributorów w plikach backend pages (ostatnie 6 miesięcy)
git log --since="2025-10-01" --format="%aN" \
  -- "packages/core/src/modules/*/backend/**/*.tsx" \
  | sort | uniq -c | sort -rn | head -10

# Contributorzy którzy naprawiali kolory/dark mode (sygnał motywacji)
git log --since="2025-10-01" --all --oneline --grep="dark\|color\|theme" \
  -- "packages/core/src/modules/*/backend/**" | head -20

# Moduły z największym DS debt (cele migracji)
for module in packages/core/src/modules/*/; do
  count=$(grep -r "text-red-\|bg-green-\|bg-blue-\|text-green-\|bg-red-" "$module" 2>/dev/null | wc -l)
  echo "$count $(basename $module)"
done | sort -rn | head -10
```

**Co go motywuje:**
- **Recognition:** Bycie wymienianym jako DS champion w changelog i README
- **Clean code ownership:** Jego moduł jest wzorcowy, nie legacy
- **Influence:** Kształtuje API komponentów zamiast je konsumować
- **Learning:** Zdobywa doświadczenie z design systems w prawdziwym projekcie

### P.2 Champion Program — konkretny plan

#### 1. Identyfikacja (przed hackathon)

**Kryteria:** ≥5 PR z UI changes + aktywność w ostatnich 3 miesiącach + moduł z >10 hardcoded status colors.

Uruchom komendy z P.1. Wybierz 3-5 osób: idealnie po jednej z modułów Sales, Catalog, HR/Workflows, Integrations.

#### 2. Rekrutacja (dzień hackathonu)

**Wiadomość (GitHub Discussion mention lub DM):**

> Hej @{username}, widzę że maintainujesz moduł {module} — masz tam świetnie zrobione {konkretna rzecz, np. "detail page z tabami"}. Pracujemy nad design system foundations dla Open Mercato i szukamy 3-5 osób, które zmigrują swój moduł jako pierwsze (po customers). Co to daje: twój moduł staje się referencyjnym wzorcem, masz wpływ na API nowych komponentów (StatusBadge, FormField), i dostajesz early access do tokenów + codemod scriptów które robią 80% pracy automatycznie. Zainteresowany? Cały effort to ~2h z codemod + 1h manual review. Hmu jeśli chcesz pogadać na callu albo async.

#### 3. Onboarding championów (tydzień 1)

Co dostają:
- **Early access:** Branch `docs/design-system-audit-2026-04-10` z tokenami i komponentami, zanim trafi na main
- **15-min async walkthrough:** Nagranie Loom (nie synchroniczny call — uszanuj timezone) pokazujące: (a) before/after demo z N.2, (b) jak użyć codemod scriptu, (c) jak zweryfikować wynik
- **Ich moduł jako target:** Codemod script przygotowany do uruchomienia na ich module — champion uruchamia, reviewuje, commituje

#### 4. Activation (tydzień 2-3)

Co robią:
- **Migrują swój moduł** — uruchamiają codemod, przeglądają diff, naprawiają edge case'y, tworzą PR
- **Review DS PR-ów:** Dodani jako reviewerzy na PR-ach innych modułów z labelem `design-system` — sprawdzają token usage i component patterns
- **Feedback loop:** Raportują problemy z API komponentów, niejasne token names, brakujące warianty. Format: GitHub Discussion post "DS Feedback: {temat}" z konkretnym przykładem

#### 5. Recognition (ongoing)

- **Changelog mention:** "Module {name} migrated to DS tokens by @{champion}" w RELEASE_NOTES.md
- **CONTRIBUTORS.md:** Sekcja "Design System Champions" z listą osób i modułów
- **GitHub label:** `ds-champion` na ich profilu contributora (jeśli projekt ma takie mechanizmy) — w praktyce wystarczy mention w Discussion i changelog

### P.3 First Follower Strategy

**Kogo przekonujesz PIERWSZEGO: maintainera modułu Sales.**

Dlaczego Sales:
- **Największy UI surface po customers** — orders, quotes, invoices, shipments, payments. Dużo status badges (draft → confirmed → shipped → paid → cancelled).
- **Najwięcej hardcoded status colors** — każdy dokument ma inną paletę kolorów (quote = blue, order = green, invoice = amber). To jest najbardziej widoczny DS debt.
- **Sukces w Sales jest spektakularny** — zmiana kolorów statusów w 5 typach dokumentów jednocześnie daje wow effect. Before/after demo z Sales module jest 3x bardziej przekonujące niż z prostego modułu.
- **Sales maintainer jest zmotywowany** — dark mode w Sales jest szczególnie popsute (hardcoded colors na ciemnym tle w tabelach dokumentów).

**Jaki moduł migruje PIERWSZY po customers: Sales.**

Z tego samego powodu. Customers to proof of concept (maintainerzy DS robią to sami). Sales to proof of adoption (ktoś inny robi to z DS tools). To jest przejście od "my to zrobiliśmy" do "inni to potrafią".

**Jak sukces pierwszego followera przekonuje kolejnych:**

1. Sales champion tworzy PR migracyjny — widoczny w activity feed
2. PR ma before/after screenshoty (dark mode fix = impressive)
3. Discussion post: "Migrated Sales to DS tokens — 47 hardcoded colors → 0. Took 2 hours with codemod."
4. Kolejni maintainerzy (Catalog, Workflows, Integrations) widzą: to nie jest teoria, to jest 2 godziny pracy z konkretnym rezultatem
5. FOMO effect: "Mój moduł wygląda gorzej niż Sales w dark mode. Powinienem zmigrować."

Kolejność migracji po Sales: **Catalog** (produkty, warianty, ceny — dużo statusów), potem **Workflows** (wizualny edytor, status badges na stepach), potem pozostałe moduły organicznie.

---

## Q. Guerrilla Research Plan

### Q.1 "5 Questions, 3 People, 15 Minutes"

**Kogo pytać:**
1. Aktywny maintainer modułu (≥10 PR-ów, zna codebase)
2. Okazjonalny contributor (2-5 PR-ów, zna fragmenty)
3. Potencjalny contributor (śledzi repo, może otworzył 1 issue, jeszcze nie commitował)

**Jak przeprowadzić: Async survey via GitHub Discussion.**

Uzasadnienie: Synchroniczny call wymaga koordynacji timezone i zniechęca introwertycznych contributorów. Discussion post z pytaniami pozwala odpowiedzieć gdy ktoś ma 10 minut. Dodatkowo: odpowiedzi są publiczne, co buduje precedens otwartej komunikacji o DS.

**5 pytań:**

1. **"Gdy ostatnio budowałeś nowy ekran (lub modyfikowałeś istniejący) — skąd wiedziałeś jakich komponentów użyć? Co otworzyłeś najpierw?"**
   Cel: Odkryć discovery path. Czy grepują? Kopiują z innego modułu? Pytają kogoś?

2. **"Czy zdarzyło ci się, że reviewer poprosił o zmianę koloru, spacingu lub komponentu w twoim PR? Jeśli tak — czy wiedziałeś dlaczego ta zmiana była potrzebna?"**
   Cel: Zmierzyć review friction i zrozumieć czy contributor rozumie reguły czy wykonuje polecenia.

3. **"Gdybyś jutro miał zbudować stronę listy z tabelą, statusami i pustym stanem — od czego byś zaczął? Który moduł otworzyłbyś jako wzorzec?"**
   Cel: Odkryć który moduł jest de facto referencyjny (może nie customers!) i jakie jest mentalne model contributora.

4. **"Co jest najbardziej irytujące w budowaniu UI w Open Mercato? Jedna konkretna rzecz."**
   Cel: Odkryć friction point którego nie widać w code audit. Może to jest brak hot reload, może wolny build, może niejasna nawigacja w kodzie.

5. **"Gdybyś mógł zmienić jedną rzecz w tym jak wygląda lub działa Open Mercato UI — co by to było?"**
   Cel: Walidacja priorytetów. Jeśli 3/3 osób mówi "dark mode jest popsute" — wiemy że semantic tokens to prawidłowy priorytet. Jeśli mówią "brak mobile view" — wiemy że nasze priorytety mogą wymagać korekty.

**Template na summary wyników (1 strona):**

```markdown
## DS Research Summary — [data]

### Participants
- [persona 1]: [moduł/rola], [ile PR-ów]
- [persona 2]: ...
- [persona 3]: ...

### Key Findings
1. **Discovery path:** [jak szukają komponentów — np. "2/3 kopiuje z customers"]
2. **Review friction:** [ile rund, czy rozumieją reguły — np. "nikt nie wiedział o semantic tokens"]
3. **Reference module:** [który moduł uważają za wzorcowy]
4. **Top friction point:** [co ich najbardziej irytuje]
5. **Top wish:** [co by zmienili]

### Impact on DS Plan
- [Co potwierdzamy — np. "semantic tokens to prawidłowy priorytet #1"]
- [Co zmieniamy — np. "dodajemy hot reload do hackathon scope bo 2/3 osób narzeka"]
- [Co dodajemy — np. "trzeba udokumentować dlaczego customers a nie sales jest referencyjny"]
```

### Q.2 Hallway Testing — komponentów API

**Task dla contributora (dosłowny tekst):**

> Mam TypeScript interface nowego komponentu FormField. Bez patrzenia na dokumentację — napisz mi JSX który wyświetla formularz z 3 polami: Name (text, required), Email (text, z opisem "We'll never share your email"), Status (select, z errorem "Status is required"). Możesz użyć dowolnych komponentów wewnątrz FormField. Masz 3 minuty.

```typescript
// To dajesz contributorowi:
interface FormFieldProps {
  label?: string
  id?: string
  required?: boolean
  labelVariant?: 'default' | 'overline'
  description?: string
  error?: string
  orientation?: 'vertical' | 'horizontal'
  disabled?: boolean
  children: React.ReactNode
}
```

**Co obserwujesz (rubric):**

| Aspekt | Sukces (5 pkt) | Problemy (3 pkt) | Porażka (1 pkt) |
|--------|----------------|-------------------|-----------------|
| **Zrozumienie children pattern** | Od razu wstawia `<Input>` jako children | Pyta "czy to slot?" ale rozumie po chwili | Próbuje przekazać input jako prop |
| **Required indicator** | Używa `required={true}` i oczekuje że label się zmieni | Dodaje ręczny asterisk w label | Nie wie jak oznaczyć pole jako required |
| **Error handling** | Przekazuje `error="..."` i nie dodaje ręcznego error display | Pyta "czy error wyświetla się automatycznie?" | Dodaje ręczny `<span className="text-red-600">` pod polem |
| **Naming intuition** | Nie pyta o żaden prop name | Pyta o 1 prop name | Pyta o ≥3 prop names |
| **Czas** | <2 min | 2-3 min | >3 min lub nie kończy |

**Jeśli contributor ≤3 na "children pattern":** Rozważamy zmianę API na `input` prop zamiast `children`. Jeśli ≥4 na wszystkich: API jest intuicyjne.

### Q.3 Observation Protocol — "Watch One, Do One"

**Kiedy: PO hackathonie** (tydzień 2). Uzasadnienie: Chcemy walidować czy DS artefakty (templates, tokens, lint rules) działają w praktyce, nie w teorii.

**Setup:**

> "Wyobraź sobie, że Sales module potrzebuje nowej strony: lista warranties (gwarancji) z tabelą, statusami (active/expired/pending), pustym stanem i możliwością tworzenia nowej gwarancji. Zbuduj stronę listy. Masz 30 minut. Możesz używać dowolnych plików w repo. Powiedz mi na głos co robisz — np. 'otwieram customers żeby zobaczyć wzorzec'. Nie pytaj mnie o pomoc — rób jak byś robił sam."

**Obserwacja — co notujesz:**

| Czas | Notujesz |
|------|----------|
| 0:00-2:00 | **Gdzie szuka:** Otwiera DS.md? Customers module? Grepuje? Googluje? |
| 2:00-5:00 | **Co kopiuje:** Który template/moduł? Czy używa K.1? |
| 5:00-15:00 | **Gdzie utyka:** Import paths? Token names? StatusBadge API? EmptyState props? |
| 15:00-25:00 | **Co omija:** Czy dodaje EmptyState? Loading state? useT()? metadata? |
| 25:00-30:00 | **Czy lint pomógł:** Czy uruchamia lint? Czy lint wyłapał problemy? |

**Zasada obserwacji:** Nie pomagasz, nie komentujesz, nie kiwasz głową aprobująco. Notujesz. Jedyny wyjątek: jeśli contributor jest zablokowany >3 min na tym samym miejscu, możesz powiedzieć "kontynuuj dalej, wrócimy do tego".

**Debrief (3 pytania):**

1. "Co było najłatwiejsze w budowaniu tej strony?"
2. "Gdzie się zatrzymałeś najdłużej — i dlaczego?"
3. "Gdybyś mógł zmienić jedno narzędzie/plik/komponent żeby to było szybsze — co by to było?"

---

## R. Decision Log

### R.1 Format Decision Record

```markdown
### DR-NNN: [Tytuł decyzji]
**Data:** YYYY-MM-DD
**Status:** Accepted | Proposed | Deprecated
**Kontekst:** [1-2 zdania — jaki problem rozwiązujemy]
**Decyzja:** [1-2 zdania — co zdecydowaliśmy]
**Uzasadnienie:** [2-3 zdania — dlaczego tak, a nie inaczej]
**Alternatywy rozważane:** [lista odrzuconych opcji z 1-zdaniowym powodem]
**Konsekwencje:** [co to oznacza w praktyce]
```

**Gdzie przechowywać: `packages/ui/decisions/` jako pliki DR-NNN.md.**

Uzasadnienie: Obok kodu, wersjonowane w git, reviewowane w PR-ach. Nie GitHub Discussions — bo te toną w feedzie i nie są wersjonowane. Nie w głównym dokumencie DS — bo rośnie za szybko. Osobne pliki = łatwy link z komentarzy PR ("see DR-001 for why we don't use opacity tokens").

### R.2 Kluczowe decyzje

#### DR-001: Flat tokens zamiast opacity-based
**Data:** 2026-04-10
**Status:** Accepted
**Kontekst:** Potrzebujemy tokenów kolorów statusowych (error/success/warning/info) z oddzielnymi wartościami dla bg, text, border, icon. Do wyboru: jeden bazowy token + opacity modifiers w Tailwind (`bg-status-error/5`) vs oddzielne flat tokens per rola.
**Decyzja:** Flat tokens — oddzielna CSS custom property per rola z pełną wartością koloru, oddzielną dla light i dark mode.
**Uzasadnienie:** Opacity-based tokens nie kontrolują kontrastu w dark mode. `oklch(0.577 0.245 27) / 5%` na białym tle daje subtlny róż, ale na czarnym tle jest niewidoczny. Flat tokens dają pełną kontrolę kontrastu w obu trybach. 20 dodatkowych custom properties to akceptowalny koszt wobec gwarancji accessibility.
**Alternatywy rozważane:** Opacity-based (mniej tokenów, ale broken dark mode), hybrid (complex, two mental models).
**Konsekwencje:** 20+20 CSS custom properties (light+dark). Naming: `--status-{status}-{role}`. Tailwind mapping via `@theme inline`.

#### DR-002: Geist Sans jako primary font
**Data:** 2026-04-10
**Status:** Accepted
**Kontekst:** Projekt używa Geist Sans od początku. Alternatywy to Inter (popularny w SaaS) lub System UI stack (zero web font loading).
**Decyzja:** Zachowujemy Geist Sans. Zero zmian.
**Uzasadnienie:** Geist jest już wdrożone z font optimization w Next.js. Zmiana fontu to zmiana visual identity — wykracza poza scope DS foundation. Geist ma świetny rendering w małych rozmiarach co jest kluczowe dla dense data UI jak ERP.
**Alternatywy rozważane:** Inter (requires migration, minimal visual difference), System UI (inconsistent across OS).
**Konsekwencje:** Brak dodatkowej pracy. Font załadowany via `next/font/local`.

#### DR-003: lucide-react jako jedyna icon library
**Data:** 2026-04-10
**Status:** Accepted
**Kontekst:** Codebase używa lucide-react plus 14 plików z inline SVG (portal, auth, workflows). Dostępne alternatywy: Phosphor, Heroicons, mix.
**Decyzja:** lucide-react jako jedyne źródło ikon. Inline SVG do zmigrowania.
**Uzasadnienie:** lucide-react jest już dominującą biblioteką w projekcie. Ma 1400+ ikon, spójne stroke width (2px default), tree-shakeable. Dodanie drugiej biblioteki ikon to gwarantowana niespójność (różne stroke widths, sizing conventions). 14 inline SVG to jednorazowa migracja.
**Alternatywy rozważane:** Phosphor (6 weight variants — overkill), Heroicons (smaller set, different style), mix (inconsistent).
**Konsekwencje:** Nowe ikony tylko z lucide-react. Inline SVG zmigrowane w ramach module migration.

#### DR-004: Alert jako unified feedback component
**Data:** 2026-04-10
**Status:** Accepted
**Kontekst:** Dwa komponenty inline feedback — Notice (3 warianty, 7 importów) i Alert (5 wariantów, 18 importów). Różne API, różne kolory.
**Decyzja:** Alert jako primary. Notice deprecated z bridge period ≥1 minor version.
**Uzasadnienie:** Alert ma więcej wariantów (5 vs 3), więcej importów (18 vs 7), i używa CVA (łatwe do rozszerzenia). Notice dodaje jedynie `compact` prop — łatwy do dodania w Alert. Ujednolicenie 4 różnych palet kolorów (sekcja 1.5) dla tego samego celu semantycznego wymaga jednego źródła prawdy.
**Alternatywy rozważane:** Notice jako primary (fewer variants, less adoption), nowy komponent (unnecessary churn), utrzymanie obu (perpetuates inconsistency).
**Konsekwencje:** Alert rozszerzony o `compact?`, `dismissible?`, `onDismiss?`. Notice ← `@deprecated` JSDoc + runtime console.warn. 7 importów Notice do zmigrowania.

#### DR-005: FormField jako oddzielny komponent od CrudForm
**Data:** 2026-04-10
**Status:** Accepted
**Kontekst:** CrudForm (1800 linii) ma wbudowany FieldControl z label + input + error. Portal i auth pages budują formularze ręcznie z niespójnym styling. Potrzebny reusable form field wrapper.
**Decyzja:** Nowy `FormField` primitive w `packages/ui/src/primitives/form-field.tsx`, niezależny od CrudForm.
**Uzasadnienie:** Refaktoryzacja CrudForm żeby wyeksponować FieldControl jako public API wymaga zmian w 1800-liniowym pliku używanym na ~20 stronach — ryzyko regresji jest zbyt duże na hackathon. Oddzielny FormField jest prosty, testowalny, i natychmiast użyteczny w portal/auth pages. CrudForm może go adoptować wewnętrznie w przyszłej iteracji.
**Alternatywy rozważane:** Refactoring CrudForm (high risk, high reward but wrong timing), extract from CrudForm (tight coupling to CrudForm internals).
**Konsekwencje:** FormField: `label?`, `required?`, `labelVariant?`, `description?`, `error?`, `children`. CrudForm nadal używa wewnętrznego FieldControl. Unifikacja w przyszłej iteracji.

#### DR-006: OKLCH color space
**Data:** 2026-04-10
**Status:** Accepted
**Kontekst:** Projekt już używa OKLCH w CSS custom properties (globals.css). Alternatywy: HSL (szerzej rozumiane), hex (tradycyjne).
**Decyzja:** Zachowujemy OKLCH.
**Uzasadnienie:** OKLCH jest perceptually uniform — zmiana lightness o tę samą wartość daje postrzeganą zmianę jasności. To kluczowe dla generowania spójnych palet statusowych (error, success, warning, info) z kontrolowanym kontrastem. HSL nie jest perceptually uniform — `hsl(0, 70%, 50%)` i `hsl(120, 70%, 50%)` mają różną perceived brightness. OKLCH jest zaimplementowane — zmiana to koszt bez korzyści.
**Alternatywy rozważane:** HSL (wider support, not perceptually uniform), hex (no manipulation possible).
**Konsekwencje:** Wszystkie nowe tokeny w OKLCH. Sprawdzanie kontrastu wymaga narzędzi OKLCH-aware (Chrome DevTools 120+).

#### DR-007: Tailwind scale + text-overline zamiast custom type scale
**Data:** 2026-04-10
**Status:** Accepted
**Kontekst:** 61 arbitralnych rozmiarów tekstu (text-[11px], text-[13px], etc.). Opcje: pełna custom typography scale (heading-1 through caption) vs leverage Tailwind + single custom token.
**Decyzja:** Tailwind scale jako primary + jeden custom token `text-overline` (11px, uppercase, tracking-wider) dla label pattern.
**Uzasadnienie:** Pełna custom scale duplikuje to co Tailwind już oferuje (text-xs, text-sm, text-base, text-lg, text-xl, text-2xl). Jedyny brakujący rozmiar to 11px uppercase label (33 wystąpienia text-[11px]) — dostaje dedykowany token. Reszta arbitralnych rozmiarów (text-[13px], text-[10px]) mapuje na najbliższy Tailwind size.
**Alternatywy rozważane:** Full custom scale (maintenance burden, duplicates Tailwind), no custom tokens (loses 11px pattern).
**Konsekwencje:** `--font-size-overline: 0.6875rem`. Codemod mapuje: `text-[11px]` → `text-overline`, `text-[13px]` → `text-sm`, `text-[10px]` → `text-xs`.

#### DR-008: Per-module migration zamiast big-bang
**Data:** 2026-04-10
**Status:** Accepted
**Kontekst:** 372 hardcoded kolorów w 34 modułach. Opcje: migracja wszystkiego naraz (big-bang) vs moduł po module.
**Decyzja:** Per-module migration. Customers → Sales → Catalog → reszta organicznie.
**Uzasadnienie:** Big-bang tworzy massive PR (100+ plików) który jest niemożliwy do review, łatwy do złamania, i blokuje wszystkie inne PR-y na czas merge. Per-module: każdy PR to 5-15 plików, reviewowalny w 30 minut, merge nie blokuje innych. Codemod script (sekcja J) automatyzuje 80% pracy. Pozwala też na validację — jeśli migracja customers ujawni problem z tokenami, naprawiamy ZANIM migrujemy 33 kolejne moduły.
**Alternatywy rozważane:** Big-bang (fast but high risk, unreviewable), file-by-file (too granular, PR spam).
**Konsekwencje:** ~34 PR-y migracyjne, 1-2h każdy. Lint rules `warn` na legacy, `error` na nowym kodzie. Dashboard (`ds-health-check.sh`) trackuje postęp.

#### DR-009: warn-then-error lint strategy
**Data:** 2026-04-10
**Status:** Accepted
**Kontekst:** 6 nowych lint rules DS. Opcje: od razu error (blokuje CI), warn (informuje bez blokowania), warn→error po migracji.
**Decyzja:** warn na legacy, error na nowych modułach. Po migracji modułu → error globalnie.
**Uzasadnienie:** Natychmiastowy error na 372 violations = zablokowany CI dla całego projektu. Nikt nie zmerguje niczego dopóki ktoś nie naprawi legacy. To paraliżuje development. warn pozwala kontynuować pracę, jednocześnie edukując (contributor widzi warning, uczy się). error na nowych plikach zapobiega nowej legacy. Gradual ramp-up.
**Alternatywy rozważane:** Immediate error (blocks CI), warn forever (no enforcement), eslint-disable (defeats purpose).
**Konsekwencje:** ESLint config z dwoma blokami — strict dla nowych plików, lenient dla legacy. Po migracji modułu: przenosimy pliki do strict.

#### DR-010: StatusBadge + StatusMap pattern
**Data:** 2026-04-10
**Status:** Accepted
**Kontekst:** Każdy moduł definiuje własne kolory statusów (hardcoded). Opcje: rozszerzenie Badge o status variants vs oddzielny StatusBadge.
**Decyzja:** Oddzielny StatusBadge (semantic wrapper) który renderuje Badge wewnętrznie. Badge dostaje nowe CVA variants (success, warning, info).
**Uzasadnienie:** StatusBadge i Badge mają różne API kontrakty. Badge to generic visual component (`variant: 'default'|'secondary'|'destructive'|...`). StatusBadge to semantic component (`variant: 'success'|'warning'|'error'|'info'|'neutral'`) — contributor myśli "jaki status?" nie "jaki styl?". Oddzielny komponent umożliwia dodanie `dot` indicator, animacji, i mapowania status→variant bez zaśmiecania Badge. Wewnętrznie: `StatusBadge variant="success"` → `Badge variant="success"`.
**Alternatywy rozważane:** Extend Badge only (mixes semantic and visual concerns), StatusBadge without Badge (duplication).
**Konsekwencje:** `StatusBadge` w `packages/ui/src/primitives/status-badge.tsx`. Badge w `badge.tsx` ← 3 nowe CVA variants. Zero breaking changes w istniejącym Badge API.

---

## S. Success Metrics Beyond Code

### S.1 Contributor Experience Metrics

#### 1. Time to First DS-Compliant PR

| | |
|---|---|
| **Jak mierzyć** | Timestamp pierwszego UI-related commita → timestamp merge. Filter: PR-y od nowych contributorów (≤3 prior PRs) modyfikujące pliki `backend/**/*.tsx`. |
| **Baseline** | Unknown — zmierzyć retrospektywnie z git log (5 ostatnich nowych contributor PRs). Estymata: 3-5 dni (w tym review rounds). |
| **Target** | ≤2 dni (w tym review). |
| **Cadence** | Per PR (automatic via git log), summarized monthly. |
| **Komenda** | `git log --format="%H %aI" --diff-filter=A -- "packages/core/src/modules/*/backend/**/*.tsx" \| head -20` |

#### 2. Review Rounds per UI PR

| | |
|---|---|
| **Jak mierzyć** | Count "changes requested" reviews na PR-ach modyfikujących `backend/**/*.tsx`. Użyj GitHub API: `gh pr list --search "review:changes-requested" --json number,reviews`. |
| **Baseline** | Estymata: 2-3 rounds (na podstawie audit findings — 372 hardcoded colors = dużo review comments). |
| **Target** | ≤1 round (lint rules łapią mechanical issues, reviewer sprawdza logikę). |
| **Cadence** | Monthly aggregate. |

#### 3. DS Component Adoption Rate

| | |
|---|---|
| **Jak mierzyć** | % nowych plików `page.tsx` (dodanych w ostatnich 30 dni) importujących ≥3 DS components z listy: Page, PageBody, DataTable, CrudForm, EmptyState, StatusBadge, LoadingMessage, FormField. |
| **Baseline** | ~20% (estymata z audytu — większość stron nie używa EmptyState, StatusBadge). |
| **Target** | 80% po 3 miesiącach, 95% po 6 miesiącach. |
| **Cadence** | Monthly. |
| **Komenda** | `git log --since="30 days ago" --diff-filter=A --name-only -- "**/backend/**/page.tsx" \| xargs grep -l "EmptyState\|StatusBadge\|LoadingMessage" \| wc -l` |

#### 4. DS Bypass Rate

| | |
|---|---|
| **Jak mierzyć** | Count lint warnings `om-ds/*` na nowych plikach w CI. Nowe pliki = dodane w tym PR (nie legacy). |
| **Baseline** | N/A (lint rules jeszcze nie istnieją). Pierwszy pomiar po hackathonie. |
| **Target** | <5% nowych plików z DS warnings po 1 miesiącu. 0% po 3 miesiącach. |
| **Cadence** | Per CI run (automated), summarized weekly. |

#### 5. Contributor Satisfaction (qualitative)

| | |
|---|---|
| **Jak mierzyć** | Quarterly GitHub Discussion survey (3 pytania — sekcja S.2). |
| **Baseline** | First survey = baseline. |
| **Target** | Score ≥7/10 na pytaniu ilościowym. |
| **Cadence** | Quarterly. |

### S.2 Quarterly Contributor Survey

**Format:** GitHub Discussion, category "Design System Feedback", pinned na 2 tygodnie.

**3 pytania:**

1. **(Quantitative)** "Na skali 1-10, jak łatwo jest zbudować nowy ekran UI w Open Mercato przy użyciu obecnych komponentów i dokumentacji?"

2. **(Qualitative)** "Opisz w 1-2 zdaniach ostatnią sytuację gdy budując UI nie wiedziałeś jakiego komponentu lub tokena użyć."

3. **(Actionable)** "Gdybyśmy mogli zmienić jedną rzecz w design system — co by ci najbardziej pomogło?"

**Template na summary:**

```markdown
## DS Survey Q[N] 2026 — Summary

**Responses:** [N]
**Avg score (Q1):** [X]/10 (prev: [Y]/10, delta: [+/-Z])

### Top themes (Q2 — friction points):
1. [theme] — mentioned by [N] respondents
2. [theme] — mentioned by [N] respondents

### Top requests (Q3 — what to change):
1. [request] — mentioned by [N] respondents
2. [request] — mentioned by [N] respondents

### Actions taken:
- [concrete action based on feedback]
- [concrete action based on feedback]

### Deferred (and why):
- [request] — deferred because [reason]
```

### S.3 Leading vs Lagging Indicators

| Metryka | Typ | Dlaczego | Jak reagować |
|---------|-----|----------|--------------|
| **DS Bypass Rate** (S.1.4) | Leading | Wzrost = contributorzy aktywnie omijają system. Problem TERAZ, zanim pojawią się hardcoded colors w codebase. | Natychmiast: zbadaj dlaczego omijają (brak komponentu? złe API? nie znają?). |
| **Review Rounds** (S.1.2) | Leading | Wzrost = DS nie eliminuje mechanical issues. Reviewerzy nadal łapią kolory/spacing ręcznie. | W ciągu tygodnia: sprawdź lint rules coverage, dodaj brakujące reguły. |
| **Hardcoded colors count** (F) | Lagging | To jest pomiar stanu — spada tylko gdy ktoś aktywnie migruje. Nie sygnalizuje nowych problemów, potwierdza stare. | Trend miesięczny. Jeśli nie spada — brak migration activity. |
| **Arbitrary text sizes** (F) | Lagging | Jak wyżej. | Trend miesięczny. |
| **Empty state coverage** (F) | Lagging | Miara pokrycia — rośnie powoli z nowymi stronami i migracjami. | Trend miesięczny. |
| **DS Adoption Rate** (S.1.3) | Leading | Niski = nowe strony budowane bez DS. Problem rośnie z każdym nowym modułem. | Natychmiast: czy templates są łatwe do znalezienia? Czy lint rules działają? |
| **Time to First PR** (S.1.1) | Leading | Wzrost = DS nie przyspiesza onboardingu. | W ciągu 2 tygodni: obserwuj nowego contributora (Q.3), zidentyfikuj friction. |
| **Contributor Satisfaction** (S.1.5) | Lagging | Kwartalna retrospekcja stanu. Nie sygnalizuje problemów w real-time. | Trend kwartalny. Jeśli spada — deep dive w qualitative answers. |

**Zasada:** Na leading indicators reaguj w ciągu tygodnia. Na lagging indicators patrz w trendzie miesięcznym/kwartalnym.

---

## T. Iteration & Feedback Mechanism

### T.1 DS Retrospective — 2 tygodnie po hackathonie

**Data docelowa:** ~25 kwietnia 2026 (piątek)
**Czas:** 30 minut
**Uczestnicy:** DS lead + 2-3 championów (sekcja P) + 1-2 contributorów którzy budowali UI w ostatnich 2 tygodniach

**Agenda:**

| Min | Blok | Co robimy |
|-----|------|-----------|
| 0-5 | **Data review** | Wynik `ds-health-check.sh` vs baseline z hackathonu. Ile hardcoded colors ubyło? Ile modułów zmigrowano? Adoption rate nowych komponentów. |
| 5-10 | **What worked** | Każdy uczestnik: 1 rzecz która się sprawdziła. Np. "codemod script zaoszczędził mi godzinę", "lint warning uratował mnie przed hardcoded color". |
| 10-20 | **What didn't** | 3 pytania poniżej. To jest najważniejsza część — 10 minut, nie 5. |
| 20-25 | **Token/component feedback** | Konkretne problemy z API: "StatusBadge nie ma wariantu X", "token name Y jest mylący", "FormField orientation nie działa z Z". |
| 25-30 | **Next iteration** | 3 actionable items na następne 2 tygodnie. Zapisane w GitHub Discussion post. |

**3 pytania na "what didn't" (zaprojektowane żeby wyciągać prawdę):**

1. **"Czy w ciągu ostatnich 2 tygodni zdarzyło ci się ominąć DS guideline — np. użyć hardcoded koloru albo pominąć EmptyState? Jeśli tak — dlaczego?"**
   Cel: Odkryć *dlaczego* ludzie obchodzą system. Powody: nie wiedzieli? Za trudne? Brak wariantu? Pośpiech? Każda odpowiedź prowadzi do innej akcji.

2. **"Czy jest komponent lub token którego szukałeś i nie znalazłeś — i musiałeś zrobić workaround?"**
   Cel: Odkryć luki w DS. Może brakuje wariantu StatusBadge. Może brakuje tokena dla border w kontekście nieobjętym status colors. To jest lista TODO na iterację 2.

3. **"Gdybyś mógł cofnąć jedną decyzję DS — co by to było?"**
   Cel: Wyłapać decyzje które wyglądały dobrze na papierze ale nie działają w praktyce. Jeśli 2/3 osób mówi "flat tokens mają za dużo nazw" — rozważamy uproszczenie. Jeśli mówią "lint rules są zbyt agresywne" — rozważamy przesunięcie na warn.

### T.2 Feedback Channels — ongoing

#### 1. GitHub Label: `design-system`

| | |
|---|---|
| **Co tagujemy** | Każdy issue, PR lub discussion dotyczący DS: migracje, nowe komponenty, token changes, lint rules |
| **Kto monitoruje** | DS lead (ty). Weekly scan: `gh issue list --label design-system` + `gh pr list --label design-system` |
| **Cadence** | Continuous. Weekly review. |
| **Co robimy z feedbackiem** | Triage: bug (fix w bieżącym sprincie), feature request (do backlogu DS), question (odpowiedź + update docs jeśli pytanie się powtarza) |

#### 2. GitHub Discussion: "Design System Feedback"

| | |
|---|---|
| **Co tu trafia** | Pytania ("czy powinienem użyć Alert czy Notice?"), propozycje ("potrzebuję wariantu X"), frustracje ("token naming jest mylący") |
| **Kto monitoruje** | DS lead + championowie. Champions odpowiadają na proste pytania, eskalują nietrywialne. |
| **Cadence** | Odpowiedź w ≤48h (standard OSS). |
| **Co robimy z feedbackiem** | FAQ: jeśli pytanie się powtarza (≥3 razy) — dodajemy do DS.md. Propozycja: if popular — DR + implementation. Frustracja: investigate, acknowledge, fix or explain. |

#### 3. PR Review Comments: tag `[DS]`

| | |
|---|---|
| **Co to jest** | Reviewer dodaje `[DS]` prefix do komentarzy dotyczących design system: `[DS] Use text-destructive instead of text-red-600` |
| **Kto monitoruje** | DS lead. Monthly grep: `gh api search/issues -f q="[DS] repo:open-mercato/open-mercato"` |
| **Co robimy** | Recurring `[DS]` comments na ten sam temat → nowa lint rule lub update docs. Np. jeśli 5 PR-ów ma komentarz "[DS] missing EmptyState" i `require-empty-state` jest `warn` — rozważamy `error`. |

#### 4. Monthly DS Digest

| | |
|---|---|
| **Format** | GitHub Discussion post, 5 bulletów max |
| **Struktura** | 1. Migrated modules (this month). 2. New tokens/components. 3. Top lint violations (trending). 4. Decisions made (link to DR). 5. Next month priorities. |
| **Kto pisze** | DS lead |
| **Cadence** | First week of month |
| **Dlaczego** | Daje contributorowi context bez zmuszania do śledzenia każdego PR. 2-minutowy read raz w miesiącu. |

### T.3 Version Strategy

**Semver for DS: NIE.** DS jest częścią monorepo — wersjonowany razem z `@open-mercato/ui`. Osobna wersja DS to overhead bez korzyści w monorepo. Zmiany w tokenach/komponentach trafiają do standardowego `RELEASE_NOTES.md` z tagiem `[DS]`.

**Deprecation policy:** ≥1 minor version między deprecated a removed. Spójne z `BACKWARD_COMPATIBILITY.md`. Konkretnie:
- Deprecated component (np. Notice): dodaj `@deprecated` JSDoc + runtime `console.warn` w dev mode
- Bridge: re-export z nowej lokalizacji lub wrapper
- Po 1 minor version: usuń z codebase, zaktualizuj migration guide

Ta sama policy co Notice → Alert (sekcja 1.14 audytu): deprecation announced → bridge period → removal.

**Changelog:** Każda zmiana DS trafia do `RELEASE_NOTES.md` z prefixem `[DS]`:
```
## [DS] Semantic status tokens added
- 20 new CSS custom properties (--status-{error|success|warning|info|neutral}-{bg|text|border|icon})
- Light and dark mode values with WCAG AA contrast
- Migration: see packages/ui/decisions/DR-001.md
```

**Migration guides:** Każdy breaking change dostaje migration guide w formacie sekcji J (mapping table + codemod script). Kto pisze: osoba wprowadzająca breaking change (enforced w PR template checkbox). Wzór: sekcja J niniejszego dokumentu.

### T.4 "Good Enough" Permission

> **Nasz design system nie musi być perfekcyjny. Musi istnieć.**
>
> 30% adopcji w pierwszym miesiącu to sukces — oznacza, że nowe moduły są budowane spójnie, nawet jeśli legacy jeszcze nie zmigrowane. Tokeny mogą się zmienić — po to są tokenami, a nie hardcoded wartościami. Jeśli API komponentu okazuje się złe po 2 tygodniach użytkowania, zmieniamy je — mamy deprecation policy i codemod scripty właśnie na takie sytuacje. Spójność jest ważniejsza od perfekcji: lepiej 34 moduły używające "dobrego enough" tokena niż 3 moduły z idealną paletą i 31 z hardcoded kolorami. Ten design system jest produktem — a produkty się iterują.
>
> Buduj, mierz, poprawiaj. W tej kolejności.

---

---

## U. Uzupełnienie Foundations — Motion, Type Hierarchy, Icons

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

## V. Component Specs

### V.1 Component Quick Reference Table

Pokrywa wszystkie primitives z `packages/ui/src/primitives/` i kluczowe backend components. Dane z audytu codebase.

| # | Komponent | Import | Kiedy używać | Kiedy NIE używać | Warianty | Default size | A11y | Mobile |
|---|-----------|--------|-------------|-----------------|----------|-------------|------|--------|
| 1 | **Button** | `@open-mercato/ui/primitives/button` | Akcja użytkownika: save, create, cancel, delete | Nawigacja (→ `Link`), toggle stanu (→ `Switch`) | `default`, `destructive`, `outline`, `secondary`, `ghost`, `muted`, `link` | h-9, text-sm | Focus ring auto. Disabled = `opacity-50 pointer-events-none`. | Bez zmian — touch target h-9 (36px) OK |
| 2 | **IconButton** | `@open-mercato/ui/primitives/icon-button` | Kompaktowa akcja icon-only: edit, delete, close, collapse | Gdy akcja jest niejasna bez tekstu (→ `Button` z icon+text) | `outline`, `ghost` | size-8 (32px) | `aria-label` WYMAGANY | Touch target size-8 = 32px — na mobile rozważ size `lg` (36px) |
| 3 | **Input** | `@open-mercato/ui/primitives/input` | Jednoliniowe pole tekstowe: name, email, search | Wieloliniowy tekst (→ `Textarea`), wybór z listy (→ `ComboboxInput`) | Brak CVA | h-9 | Via `<Label htmlFor>` + `aria-invalid` | Bez zmian |
| 4 | **Textarea** | `@open-mercato/ui/primitives/textarea` | Wieloliniowy tekst: description, notes, comments | Jednoliniowy (→ `Input`), rich text (→ `SwitchableMarkdownInput`) | Brak CVA | min-h-[80px] | Via `<Label htmlFor>` | Bez zmian |
| 5 | **Checkbox** | `@open-mercato/ui/primitives/checkbox` | Wybór wielokrotny, boolean z opóźnionym zapisem (formularz) | Natychmiastowy toggle (→ `Switch`), single choice (→ radio) | Brak CVA | size-4 (16px) | Radix — wbudowane role/state | Touch: size-4 mały — opakowaj w clickable area |
| 6 | **Switch** | `@open-mercato/ui/primitives/switch` | Toggle natychmiastowy: enable/disable, on/off | Boolean w formularzu z submit (→ `Checkbox`) | Brak CVA | h-6 w-11 | `role="switch"`, keyboard Space/Enter | h-6 (24px) — akceptowalne |
| 7 | **Label** | `@open-mercato/ui/primitives/label` | Label dla pola formularza | Standalone tekst (→ `<span>`) | Brak CVA | text-sm font-medium | Radix — auto `htmlFor` linkage | Bez zmian |
| 8 | **Card** | `@open-mercato/ui/primitives/card` | Grupowanie powiązanego contentu: settings, stats, feature | Wrapping całej strony (→ `Page`), sekcja w detail (→ `Section`) | `CardHeader`, `CardContent`, `CardFooter`, `CardAction` | bg-card, gap-6 | Semantyczny `<div>` z border | Bez zmian — padding responsive via sub-components |
| 9 | **Badge** | `@open-mercato/ui/primitives/badge` | Metadane: count, category, tag | Status entity (→ `StatusBadge`), akcja (→ `Button size="sm"`) | `default`, `secondary`, `destructive`, `outline`, `muted` + (nowe) `success`, `warning`, `info` | text-xs h-5 | Dekoracyjny — brak interakcji | Bez zmian |
| 10 | **Alert** | `@open-mercato/ui/primitives/alert` | Inline komunikat: error, success, warning, info na stronie | Transient feedback (→ `flash()`), system notification (→ `NotificationBell`) | `default`, `destructive`, `success`, `warning`, `info` | p-4 text-sm | `role="alert"` auto na destructive | Bez zmian |
| 11 | **Dialog** | `@open-mercato/ui/primitives/dialog` | Formularz/content wymagający focus: create, edit, confirm | >10 pól (→ oddzielna strona), read-only content (→ `Popover`) | `DialogContent` z sub-components | Mobile: bottom sheet. Desktop: max-w-lg centered | Radix: focus trap, ESC close, aria-* | Bottom sheet z rounded-t-2xl, min-h-[50vh] |
| 12 | **Tooltip** | `@open-mercato/ui/primitives/tooltip` | Krótki tekst pomocniczy na hover/focus: icon explanation, truncated text | Interaktywny content (→ `Popover`), ważna info (→ pokaż inline) | Brak CVA | text-xs, max-w-[280px] | Delay 300ms, ESC dismiss | Touch: brak hover — rozważ inline text |
| 13 | **Popover** | `@open-mercato/ui/primitives/popover` | Interaktywny panel na klik: filter, color picker, mini-form | Pełny formularz (→ `Dialog`), read-only hint (→ `Tooltip`) | Brak CVA | min-w-[280px] | Radix: focus trap, ESC close | Bez zmian — pozycjonowanie auto |
| 14 | **Tabs** | `@open-mercato/ui/primitives/tabs` | Przełączanie widoków w jednym kontekście: detail sections, settings | Nawigacja między stronami (→ sidebar/routing), 2 opcje (→ `Switch`) | `TabsList`, `TabsTrigger`, `TabsContent` | h-9 trigger | `role="tablist"`, `aria-selected` | Horizontal scroll na TabsList jeśli >4 tabs |
| 15 | **Table** | `@open-mercato/ui/primitives/table` | Prosta tabela semantyczna: key-value, comparison, static data | Lista z sort/filter/pagination (→ `DataTable`) | `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` | text-sm, px-4 py-2 | Semantic HTML `<table>` | Horizontal scroll w overflow container |
| 16 | **Separator** | `@open-mercato/ui/primitives/separator` | Wizualny podział sekcji | Spacing (→ `space-y-*` / `gap-*`), grupowanie (→ `Card` / `Section`) | `horizontal` (default), `vertical` | 1px, bg-border | `role="separator"` | Bez zmian |
| 17 | **Progress** | `@open-mercato/ui/primitives/progress` | Postęp operacji: upload, sync, wizard step | Nieokreślony czas (→ `Spinner`) | Brak CVA | h-2 | `role="progressbar"`, `aria-valuenow` | Bez zmian |
| 18 | **Spinner** | `@open-mercato/ui/primitives/spinner` | Loading indicator: data fetch, form submit, async operation | Znany layout (→ Skeleton — przyszłość) | Brak CVA | Odziedziczony z parent | `aria-label` lub otaczający `LoadingMessage` | Bez zmian |
| 19 | **EmptyState** | `@open-mercato/ui/backend/EmptyState` | Zero danych w liście/sekcji — z CTA do tworzenia | Błąd (→ `ErrorMessage`), loading (→ `LoadingMessage`) | — | Centered, dashed border | Semantic: `title` + `description` czytelne dla SR | Bez zmian — centered layout responsywny |
| 20 | **LoadingMessage** | `@open-mercato/ui/backend/detail` | Loading state w sekcjach, tab content, detail pages | Full-page loading (→ `PageLoader`), inline w tabeli (→ `DataTable isLoading`) | — | Spinner h-4 + text | `aria-busy` via kontekst | Bez zmian |
| 21 | **ErrorMessage** | `@open-mercato/ui/backend/detail` | Błąd ładowania danych, not found, server error | Walidacja formularza (→ `Alert` inline + field errors) | — | `role="alert"`, `text-destructive` | Auto `role="alert"` | Bez zmian |

### V.2 Deep Specs — komponenty z problemami

#### V.2.1 Button — Decision Framework [HACKATHON]

Audit (1.10): 7 wariantów. Brak guidelines kiedy który.

| Scenariusz | Wariant | Rozmiar | Uzasadnienie |
|-----------|---------|---------|-------------|
| **Główna akcja** na stronie (Save, Create, Submit) | `default` | `default` (h-9) | Primary CTA — niebieskie tło, białe text. Max 1 per sekcja strony. |
| **Akcja wspierająca** (Cancel, Back, Export) | `outline` | `default` | Widoczna ale nie konkuruje z primary. Border bez fill. |
| **Akcja destrukcyjna** (Delete, Remove, Revoke) | `destructive` | `default` | Czerwona. ZAWSZE z `useConfirmDialog()` — nigdy immediate. |
| **Akcja niskopriorytowa** (Reset filters, Clear, Collapse) | `ghost` | `sm` (h-8) | Minimalna wizualna waga. Tylko na hover widoczna. |
| **Akcja wewnątrz tekstu** (inline link-style) | `link` | `sm` | Wygląda jak link. Dla akcji, nie nawigacji (nawigacja = `<Link>`). |
| **Akcja w wyciszonym kontekście** (toolbar, compact list) | `muted` | `sm` | Muted bg, low contrast. Nie przyciąga uwagi. |
| **Akcja w grupie peer** (2 równoważne opcje) | `secondary` + `secondary` | `default` | Obie szare. Żadna nie dominuje. Dodaj ikonę dla rozróżnienia. |

**Zasada 1-1-N:** Max 1 `default` (primary), max 1 `destructive`, dowolna ilość `outline`/`ghost`/`muted` per widoczna sekcja.

**Konflikty (2 równoważne akcje):** Użyj `secondary` dla obu + rozróżnij ikoną. Nie twórz drugiego `default`.

#### V.2.2 Card — Unification Plan [POST-HACKATHON]

Audit (1.8): Card (primitive), PortalCard, PortalFeatureCard, PortalStatRow, card-grid w settings.

**Taksonomia — 3 warianty:**

| Wariant | Komponent | Użycie | Padding | Radius |
|---------|-----------|--------|---------|--------|
| `default` | `Card` (primitive) | Backend: settings, grouped content, data sections | px-6 py-6 (via sub-components) | `rounded-xl` (border) |
| `interactive` | `Card` + `onClick`/`asChild` | Settings navigation tiles, clickable cards | px-6 py-6 + hover state | `rounded-xl` + `hover:bg-accent/50` |
| `stat` | `Card` + custom content | Dashboard widgets, KPI tiles, metric cards | p-5 sm:p-6 | `rounded-xl` |

**PortalCard: merge z Card.** PortalCard to `Card` z `p-5 sm:p-6 rounded-xl border bg-card` — identyczne z primitive. Zastąpić importem Card. PortalFeatureCard to composition: `Card` + icon grid — nie potrzebuje oddzielnego komponentu.

**Kiedy Card vs Section vs inny container:**

| Content | Użyj | Dlaczego |
|---------|------|---------|
| Zamknięty blok danych (address, payment info, stats) | `Card` | Ma wyraźne granice — border + bg-card |
| Sekcja w detail page (Activities, Notes, Tasks) | `Section` / `SectionHeader` | Nie ma obramowania — jest częścią flow strony |
| Cała strona | `Page` + `PageBody` | Wrapper, nie container |
| Formularz | `CrudForm` (sam zarządza layoutem) | CrudForm ma swój padding i spacing |

#### V.2.3 Dialog — Decision Matrix [HACKATHON]

Audit (1.10): Dialog (Radix), ConfirmDialog (natywny `<dialog>`). Brak sizing guidelines.

| Scenariusz | Użyj | Sizing | Dlaczego |
|-----------|------|--------|---------|
| Potwierdzenie destrukcyjnej akcji | `useConfirmDialog()` | auto (sm) | 2 opcje: confirm/cancel. Minimalne UI. |
| Quick create (2-5 pól: tag, note, quick task) | `Dialog` | `max-w-md` (448px) | Nie opuszcza kontekstu. Fast turnaround. |
| Standard form (5-7 pól: create entity) | `Dialog` | `max-w-lg` (512px) — default | Skupia uwagę. Cmd+Enter submit. |
| Complex form (8-12 pól z grupami) | `Dialog` | `max-w-xl` (576px) | Na granicy — rozważ oddzielną stronę. |
| >12 pól lub multi-step | Oddzielna strona (`create/page.tsx`) | full page | Dialog za mały. User traci kontekst scrollując modal. |
| Read-only detail preview | `Dialog` lub `Popover` | zależy od ilości contentu | Popover: 1-2 sekcje. Dialog: więcej. |
| Bulk action confirmation | `useConfirmDialog()` z custom description | auto (sm) | "Delete 5 customers?" + konsekwencje. |

**Mobile behavior:** Wszystkie Dialog → bottom sheet (min-h-[50vh], max-h-[70vh], rounded-t-2xl). Swipe-down to dismiss nie jest zaimplementowany — ESC/tap outside.

**Sizing reference (z dialog.tsx):**

| Token | Tailwind | Pixel | Desktop | Mobile |
|-------|---------|-------|---------|--------|
| sm | `max-w-sm` | 384px | Confirmation, simple choice | Bottom sheet |
| md | `max-w-md` | 448px | Quick create, 2-5 pól | Bottom sheet |
| lg (default) | `max-w-lg` | 512px | Standard form, 5-7 pól | Bottom sheet |
| xl | `max-w-xl` | 576px | Complex form, 8-12 pól | Bottom sheet |

**Zasada:** Jeśli formularz wymaga scrollowania w Dialog — przenieś na oddzielną stronę.

#### V.2.4 Tooltip vs Popover [HACKATHON]

| | Tooltip | Popover |
|---|---------|---------|
| **Trigger** | Hover + focus (300ms delay) | Click |
| **Content** | Tekst only. Max 1-2 zdania. | Dowolne — buttons, links, forms, images |
| **Interactywność** | ❌ Brak. User nie może kliknąć w tooltip content. | ✅ Pełna. Focus trap, keyboard nav. |
| **Dismiss** | Auto (mouse leave / blur) + ESC | Click outside / ESC / explicit close |
| **Mobile** | ⚠️ Brak hover — tooltip nie działa. Użyj inline text. | ✅ Działa — tap to open, tap outside to close. |
| **Sizing** | Auto (max-w-[280px]) | min-w-[280px], no max |
| **Użyj gdy** | Icon explanation, truncated text, field hint | Filter panel, color picker, mini-form, user card |
| **NIE używaj gdy** | Info jest krytyczna (user MUSI ją zobaczyć) | Pełny formularz >3 pól (→ Dialog) |

**Zasada:** Jeśli informacja jest ważna na tyle, że user musi ją zobaczyć — nie chowaj w tooltip. Pokaż inline (caption text, description w FormField, helper text).

---

## W. Content Guidelines + Page Patterns

### W.1 Voice & Tone Guidelines [POST-HACKATHON]

#### Voice — kim jesteśmy (stałe)

Open Mercato komunikuje się jako: **profesjonalny, jasny, pomocny, konkretny.**

| Jesteśmy | NIE jesteśmy |
|----------|-------------|
| Profesjonalni — szanujemy czas użytkownika | Korporacyjni — bez żargonu, bez buzzwordów |
| Jasni — jedno zdanie, jedno znaczenie | Akademiccy — bez "furthermore", "utilize", "leverage" |
| Pomocni — mówimy co zrobić, nie tylko co poszło źle | Marketingowi — bez "amazing", "powerful", "game-changing" |
| Konkretni — "3 customers deleted" nie "operation completed" | Casualowi — bez emoji w UI, bez "oops!", bez humoru w errorach |

#### Tone — jak się zmieniamy (kontekstowe)

| Kontekst | Ton | Dobrze ✅ | Źle ❌ |
|---------|-----|----------|--------|
| Success message | Zwięzły, potwierdzający | "Customer saved" | "Your customer has been successfully saved!" |
| Error (server) | Spokojny, actionable | "Could not save. Try again or check your connection." | "Error 500: Internal Server Error" |
| Error (validation) | Precyzyjny, per-field | "Name is required" | "Please fill in all required fields" |
| Empty state | Zachęcający, z CTA | "No invoices yet. Create your first invoice." | "No data found" / "Nothing here!" |
| Destructive confirm | Konkretny, poważny | "Delete 3 customers? This cannot be undone." | "Are you sure?" |
| Tooltip / helper | Zwięzły, informacyjny | "Used for tax calculations" | "This field is used to store the information about..." |
| Loading | Neutralny, prosty | "Loading customers..." | "Please wait while we fetch your data..." |

#### Content Formulas

**Error message:** `[Co się stało]. [Co zrobić].`
```
✅ "Could not save changes. Check required fields."
✅ "Connection lost. Changes will sync when you're back online."
❌ "Error 422: Unprocessable Entity"
❌ "Oops! Something went wrong :("
❌ "An unexpected error occurred. Please contact support."
```

**Empty state:** `[Title: brak czego]. [Description: co zrobić]. [CTA: verb + object]`
```
✅ Title: "No customers yet"
   Description: "Create your first customer to get started."
   CTA: [Add customer]

❌ Title: "No data found"        (zbyt generyczne)
❌ Title: "Nothing here!"        (zbyt casual)
❌ Title: "0 results"            (technickie, nie ludzkie)
```

**Button label:** `[Verb]` lub `[Verb + object]`
```
✅ "Save", "Create invoice", "Delete", "Export CSV"
❌ "Submit", "OK", "Yes", "Click here", "Go"

Confirmation dialog: action = co się stanie, cancel = "Cancel"
✅ [Delete 3 customers] [Cancel]
❌ [Yes] [No]
❌ [OK] [Cancel]
```

**Confirmation dialog:** `[Title: Co się stanie?] / [Description: konsekwencje] / [Action] [Cancel]`
```
✅ Title: "Delete this customer?"
   Description: "This will permanently remove Anna Smith and all related deals, activities, and notes."
   Action: [Delete customer]  Cancel: [Cancel]

❌ Title: "Are you sure?"
   Description: ""
   Action: [OK]  Cancel: [Cancel]
```

#### Reguły formatowania

| Reguła | Standard | Przykład |
|--------|----------|---------|
| Capitalization | Sentence case everywhere | "Create new invoice" nie "Create New Invoice" |
| Wyjątek | ALL CAPS tylko dla overline labels | "CUSTOMER DETAILS" w overline |
| Tytuły | Bez kropki na końcu | "No customers yet" |
| Opisy | Z kropką na końcu | "Create your first customer to get started." |
| Button labels | Bez kropki | "Save customer" |
| Listy | Bez kropek na elementach | "• Edit customer" nie "• Edit customer." |
| Liczby | Numerycznie, nie słownie | "3 customers" nie "three customers" |
| Skróty | Pełne słowa w UI | "information" nie "info", "application" nie "app" |
| i18n | OBOWIĄZKOWE | Każdy user-facing string via `t()` / `useT()` |

### W.2 Error Placement Guidelines [HACKATHON]

Audit (1.9): 4 systemy feedbacku bez guidelines kiedy który.

| Scenariusz | Komponent | Placement | Czas życia | Trigger |
|-----------|-----------|-----------|-----------|---------|
| Zapis udany | `flash('...', 'success')` | Top-right (desktop) / bottom (mobile) | 3s auto-dismiss | Po `createCrud`/`updateCrud` |
| Zapis nieudany (server) | `flash('...', 'error')` | Top-right / bottom | 5s auto-dismiss | Po failed `createCrud`/`updateCrud` |
| Walidacja formularza (ogólna) | `Alert variant="destructive"` | Inline nad formularzem | Persistent do naprawy | Form submit z błędami |
| Walidacja pola | `FormField error="..."` | Pod polem | Persistent do naprawy | Form submit / on blur |
| Brak danych | `EmptyState` | Zamiast tabeli/contentu | Persistent | Gdy `rows.length === 0` |
| Brak uprawnień | `Alert variant="warning"` | Zamiast contentu strony | Persistent | Server response 403 |
| Rekord nie znaleziony | `ErrorMessage` | Zamiast contentu | Persistent | Server response 404 |
| Destructive action | `useConfirmDialog()` | Modal overlay | Do decyzji usera | Przed delete/revoke |
| Async event | `NotificationBell` + panel | Dropdown, persistent | SSE-driven | Server event |
| Long operation progress | `ProgressTopBar` | Top bar strony | Trwa do zakończenia | Background job start |

**Zasada:** Nigdy 2 systemy jednocześnie dla tego samego wydarzenia. Jeśli `flash()` informuje o błędzie zapisu, nie pokazuj jednocześnie `Alert` na stronie.

**Priorytet feedbacku:** Field error > Form alert > Flash message > Notification. Najbliższy kontekstowi = najwyższy priorytet.

### W.3 Dashboard Layout Pattern [LATER]

#### Grid Layout

```tsx
// Dashboard widget grid pattern
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
  {widgets.map((widget) => (
    <Card key={widget.id} className={cn(
      widget.size === '2x1' && 'sm:col-span-2',
      widget.size === 'full' && 'sm:col-span-2 xl:col-span-3 2xl:col-span-4',
    )}>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{widget.title}</CardTitle>
        {widget.action && <CardAction>{widget.action}</CardAction>}
      </CardHeader>
      <CardContent>
        {widget.content}
      </CardContent>
    </Card>
  ))}
</div>
```

#### Widget Sizing

| Rozmiar | Tailwind | Kiedy |
|---------|---------|-------|
| `1x1` | default (1 column) | KPI number, mini chart, todo list, notifications |
| `2x1` | `sm:col-span-2` | Line chart, wider table, activity feed |
| `full` | full row span | Summary table, timeline, calendar |

#### Widget Anatomy (z patterns w customers/widgets/dashboard/)

```
┌─ CardHeader ───────────────────────┐
│ [Title: text-sm font-medium]  [⟳] │
├─ CardContent ──────────────────────┤
│                                    │
│  Widget content:                   │
│  - KPI: value (text-2xl) + trend   │
│  - List: ul.space-y-3 > li.p-3    │
│  - Chart: recharts component       │
│                                    │
├─ States ───────────────────────────┤
│  Loading: Spinner h-6 centered     │
│  Error: text-sm text-destructive   │
│  Empty: text-sm text-muted-fg      │
│  Settings: form inputs             │
└────────────────────────────────────┘
```

#### Empty Widget

Gdy widget nie ma danych: `<p className="text-sm text-muted-foreground">No data for selected period.</p>` — centered w CardContent. NIE używaj EmptyState (za duży na widget). NIE chowaj widgeta (user pomyśli że zniknął).

### W.4 Wizard / Stepper Pattern [LATER]

#### Kiedy Wizard vs Inline Form

| Pytanie | Wizard | Inline form |
|---------|--------|------------|
| Ile kroków? | ≥3 | 1-2 |
| Kroki wymagają oddzielnego kontekstu? | Tak (np. krok 1: dane firmy, krok 2: adres, krok 3: ustawienia) | Nie — wszystko powiązane |
| User może wrócić do poprzedniego kroku? | Tak | N/A |
| Dane z kroku N wpływają na opcje w kroku N+1? | Tak (np. wybrany kraj → formularz adresu) | Nie |

#### Anatomy

```
┌─ Step Indicator ──────────────────────┐
│  (1)───(2)───(3)───(4)               │
│   ●     ●     ○     ○                │
│ Done  Current Next  Next              │
├─ Step Content ────────────────────────┤
│                                       │
│  [Formularz bieżącego kroku]          │
│                                       │
├─ Navigation ──────────────────────────┤
│  [← Back]              [Next step →]  │
│                    or  [Complete ✓]    │
└───────────────────────────────────────┘
```

**Step indicator:** Numerowany (1/2/3), nie labeled — tekst label w step content title. Na mobile: numerki + progress bar (np. "Step 2 of 4").

**Navigation rules:**

| Kontrolka | Dostępność | Zachowanie |
|-----------|-----------|-----------|
| Back | Zawsze (oprócz kroku 1) | Wraca z zachowaniem danych. Nie resetuje formularza. |
| Next | Po walidacji bieżącego kroku | Walidacja on-click, nie on-change. Error inline. |
| Skip | Tylko jeśli krok opcjonalny — explicit label "Skip this step" | Nie domyślny. Nigdy ghost button — zawsze jawny tekst. |
| Cancel | Zawsze | Jeśli user wpisał dane → `useConfirmDialog("Discard changes?")`. Jeśli nie → natychmiast. |
| Complete (ostatni krok) | Po walidacji | Button `default` variant. Label = konkretna akcja ("Create organization", nie "Finish"). |

**Nie buduj komponentu Stepper na hackathon.** To jest guideline na przyszłą implementację. Obecne onboarding w `packages/onboarding` może go adoptować iteracyjnie.

---

## X. Visual Testing + Designer Workflow

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
