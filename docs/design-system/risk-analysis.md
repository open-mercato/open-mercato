# H. Migration Risk Analysis

> 6 ryzyk migracji z mitygacjami + macierz prawdopodobieństwo × impact.

---

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

---

## See also

- [Enforcement](./enforcement.md) — plan migracji z mitygacjami
- [Executive Summary](./executive-summary.md) — podsumowanie ryzyk
- [Migration Tables](./migration-tables.md) — szczegóły migracji kolorów i typografii
