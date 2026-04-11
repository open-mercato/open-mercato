# V. Component Specs

> Quick reference 21 komponentów + deep specs: Button, Card, Dialog, Tooltip vs Popover.

---

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

## See also

- [Component APIs](./component-apis.md) — propozycje API (Alert, StatusBadge, FormField, etc.)
- [Components](./components.md) — lista MVP z priorytetami
- [Foundations Gaps](./foundations-gaps.md) — motion i typography używane w komponentach
