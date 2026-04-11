# R. Decision Log

> Rejestr decyzji architektonicznych DS (DR-001 – DR-010) z kontekstem, alternatywami i datami.

---


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

## See also

- [Foundations](./foundations.md) — implementacja decyzji DR-001–DR-005
- [Components](./components.md) — implementacja decyzji DR-006–DR-010
- [Principles](./principles.md) — zasady z których wynikają decyzje
