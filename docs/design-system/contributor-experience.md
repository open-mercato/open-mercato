# O. Contributor Experience (CX) Design

> Mapy podróży contributora, pain points, cheat sheet, error messages, feedback loops.

---


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

## See also

- [Onboarding Guide](./onboarding-guide.md) — "Your First Module" step-by-step
- [Contributor Guardrails](./contributor-guardrails.md) — szablony i scaffold
- [Champions](./champions.md) — sieć wsparcia dla contributorów
- [Iteration](./iteration.md) — jak zbieramy feedback od contributorów
