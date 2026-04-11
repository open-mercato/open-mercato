# T. Iteration & Feedback Mechanism

> Cykl życia DS: sprinty, feedback channels, RFC process, wersjonowanie, deprecation.

---


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

## See also

- [Metrics](./metrics.md) — KPI mierzone co sprint
- [Success Metrics Beyond Code](./success-metrics-cx.md) — metryki ludzkie
- [Decision Log](./decision-log.md) — rejestr decyzji z iteracji
- [Research Plan](./research-plan.md) — badania informujące iterację
