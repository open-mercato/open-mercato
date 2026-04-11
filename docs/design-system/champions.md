# P. Champions Strategy

> Program ambasadorów DS: identyfikacja, rekrutacja, aktywacja, retencja, metryki.

---


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

## See also

- [Stakeholder Buy-in](./stakeholder-buyin.md) — strategia na poziomie organizacji
- [Contributor Experience](./contributor-experience.md) — CX który champions promują
- [Research Plan](./research-plan.md) — badania prowadzone z pomocą champions
