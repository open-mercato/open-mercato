# Część 1 — Audit istniejącego UI

> Kompleksowy audyt 160 stron backend, portalu i shared UI library. Scoring rubric na końcu.

---

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

## See also

- [Design Principles](./principles.md) — zasady projektowe wynikające z tego audytu
- [Foundations](./foundations.md) — tokeny i skale adresujące znalezione problemy
- [Components](./components.md) — MVP komponentów do standaryzacji
- [Executive Summary](./executive-summary.md) — podsumowanie najważniejszych wniosków
- [Priority Table](./priority-table.md) — priorytety naprawy
