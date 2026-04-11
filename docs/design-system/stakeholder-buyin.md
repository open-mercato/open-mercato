# N. Stakeholder Buy-in Strategy

> Strategia przekonywania stakeholderów: persony, argumenty, obiekcje, plan komunikacji.

---

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

## See also

- [Executive Summary](./executive-summary.md) — materiał do prezentacji stakeholderom
- [Success Metrics Beyond Code](./success-metrics-cx.md) — metryki które przekonują biznes
- [Champions](./champions.md) — strategia ambasadorów DS
