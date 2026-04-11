# Część 4 — MVP Komponentów

> Lista komponentów do standaryzacji z priorytetami i statusami. Metodologia + analiza 22 komponentów.

---

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

---

## See also

- [Component API Proposals](./component-apis.md) — szczegółowe API (props, variants, examples)
- [Component Specs](./component-specs.md) — specyfikacje Button, Card, Dialog, Tooltip + quick reference
- [Audit](./audit.md) — dane audytu z których wynika priorytetyzacja
- [Foundations](./foundations.md) — tokeny używane przez komponenty
