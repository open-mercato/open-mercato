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

# B. PLAN NA HACKATHON (2-3 DNI)

## Dzien 1: Foundations + Semantic Tokens

**Rano (4h):**
- [ ] Zdefiniowac semantic color tokens w `globals.css`:
  - `--status-error-bg`, `--status-error-text`, `--status-error-border`
  - `--status-success-bg`, `--status-success-text`, `--status-success-border`
  - `--status-warning-bg`, `--status-warning-text`, `--status-warning-border`
  - `--status-info-bg`, `--status-info-text`, `--status-info-border`
  - `--status-neutral-bg`, `--status-neutral-text`, `--status-neutral-border`
- [ ] Zmapowac na Tailwind utilities w `@theme`
- [ ] Udokumentowac typography scale (tabela rozmiarow z kiedy uzywac)
- [ ] Udokumentowac spacing guidelines

**Popoludnie (4h):**
- [ ] Zunifikowac Alert + Notice → jeden komponent `Alert` z 5 wariantami opartymi na semantic tokens
- [ ] Dodac deprecation notice na Notice
- [ ] Zaktualizowac FlashMessages na semantic tokens

## Dzien 2: Komponenty + Badge System

**Rano (4h):**
- [ ] Stworzyc `FormField` wrapper (label + input slot + description + error)
- [ ] Stworzyc `StatusBadge` komponent (success, warning, error, info, neutral)
- [ ] Dodac status warianty do Badge (success, warning, info)

**Popoludnie (4h):**
- [ ] Stworzyc `SectionHeader` komponent (title + action + optional collapse)
- [ ] Udokumentowac Empty State usage guidelines
- [ ] Udokumentowac border-radius usage guidelines
- [ ] Zdefiniowac z-index scale

## Dzien 3: Documentation + Reference Screen

**Rano (4h):**
- [ ] Napisac Design Principles document
- [ ] Napisac PR Review Checklist
- [ ] Udokumentowac wszystkie foundations w jednym dokumencie
- [ ] Zaktualizowac AGENTS.md z design system guidelines

**Popoludnie (4h):**
- [ ] Zbudowac 1 ekran referencyjny (np. customers list) uzywajac wylacznie DS komponentow
- [ ] Porownac before/after
- [ ] Przygotowac prezentacje wynikow hackathonu

---

# C. DELIVERABLES

Po hackathonie powinny byc gotowe:

1. **Audit checklist** — ten dokument (Czesc 1)
2. **Design Principles** — 8 principles z checklist do PR review (Czesc 2)
3. **Foundations v0** — semantic color tokens, typography scale, spacing guidelines, z-index scale, border-radius guidelines (Czesc 3)
4. **Lista komponentow MVP** — z priorytetami i statusem (Czesc 4)
5. **Nowe/zaktualizowane komponenty**:
   - Alert (unified)
   - FormField wrapper
   - StatusBadge
   - SectionHeader
   - Badge (status variants)
   - FlashMessages (semantic tokens)
6. **Documentation**:
   - Design Principles document
   - PR Review Checklist
   - Foundations reference
   - Component usage guidelines
7. **1 ekran referencyjny** — before/after porownanie

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

*Koniec dokumentu. Wersja robocza do review przez zespol produktowy i projektowy.*
