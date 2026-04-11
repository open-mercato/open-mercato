# S. Success Metrics Beyond Code

> Metryki ludzkie: adopcja, czas onboardingu, satysfakcja, PR review, community health.

---


### S.1 Contributor Experience Metrics

#### 1. Time to First DS-Compliant PR

| | |
|---|---|
| **Jak mierzyć** | Timestamp pierwszego UI-related commita → timestamp merge. Filter: PR-y od nowych contributorów (≤3 prior PRs) modyfikujące pliki `backend/**/*.tsx`. |
| **Baseline** | Unknown — zmierzyć retrospektywnie z git log (5 ostatnich nowych contributor PRs). Estymata: 3-5 dni (w tym review rounds). |
| **Target** | ≤2 dni (w tym review). |
| **Cadence** | Per PR (automatic via git log), summarized monthly. |
| **Komenda** | `git log --format="%H %aI" --diff-filter=A -- "packages/core/src/modules/*/backend/**/*.tsx" \| head -20` |

#### 2. Review Rounds per UI PR

| | |
|---|---|
| **Jak mierzyć** | Count "changes requested" reviews na PR-ach modyfikujących `backend/**/*.tsx`. Użyj GitHub API: `gh pr list --search "review:changes-requested" --json number,reviews`. |
| **Baseline** | Estymata: 2-3 rounds (na podstawie audit findings — 372 hardcoded colors = dużo review comments). |
| **Target** | ≤1 round (lint rules łapią mechanical issues, reviewer sprawdza logikę). |
| **Cadence** | Monthly aggregate. |

#### 3. DS Component Adoption Rate

| | |
|---|---|
| **Jak mierzyć** | % nowych plików `page.tsx` (dodanych w ostatnich 30 dni) importujących ≥3 DS components z listy: Page, PageBody, DataTable, CrudForm, EmptyState, StatusBadge, LoadingMessage, FormField. |
| **Baseline** | ~20% (estymata z audytu — większość stron nie używa EmptyState, StatusBadge). |
| **Target** | 80% po 3 miesiącach, 95% po 6 miesiącach. |
| **Cadence** | Monthly. |
| **Komenda** | `git log --since="30 days ago" --diff-filter=A --name-only -- "**/backend/**/page.tsx" \| xargs grep -l "EmptyState\|StatusBadge\|LoadingMessage" \| wc -l` |

#### 4. DS Bypass Rate

| | |
|---|---|
| **Jak mierzyć** | Count lint warnings `om-ds/*` na nowych plikach w CI. Nowe pliki = dodane w tym PR (nie legacy). |
| **Baseline** | N/A (lint rules jeszcze nie istnieją). Pierwszy pomiar po hackathonie. |
| **Target** | <5% nowych plików z DS warnings po 1 miesiącu. 0% po 3 miesiącach. |
| **Cadence** | Per CI run (automated), summarized weekly. |

#### 5. Contributor Satisfaction (qualitative)

| | |
|---|---|
| **Jak mierzyć** | Quarterly GitHub Discussion survey (3 pytania — sekcja S.2). |
| **Baseline** | First survey = baseline. |
| **Target** | Score ≥7/10 na pytaniu ilościowym. |
| **Cadence** | Quarterly. |

### S.2 Quarterly Contributor Survey

**Format:** GitHub Discussion, category "Design System Feedback", pinned na 2 tygodnie.

**3 pytania:**

1. **(Quantitative)** "Na skali 1-10, jak łatwo jest zbudować nowy ekran UI w Open Mercato przy użyciu obecnych komponentów i dokumentacji?"

2. **(Qualitative)** "Opisz w 1-2 zdaniach ostatnią sytuację gdy budując UI nie wiedziałeś jakiego komponentu lub tokena użyć."

3. **(Actionable)** "Gdybyśmy mogli zmienić jedną rzecz w design system — co by ci najbardziej pomogło?"

**Template na summary:**

```markdown
## DS Survey Q[N] 2026 — Summary

**Responses:** [N]
**Avg score (Q1):** [X]/10 (prev: [Y]/10, delta: [+/-Z])

### Top themes (Q2 — friction points):
1. [theme] — mentioned by [N] respondents
2. [theme] — mentioned by [N] respondents

### Top requests (Q3 — what to change):
1. [request] — mentioned by [N] respondents
2. [request] — mentioned by [N] respondents

### Actions taken:
- [concrete action based on feedback]
- [concrete action based on feedback]

### Deferred (and why):
- [request] — deferred because [reason]
```

### S.3 Leading vs Lagging Indicators

| Metryka | Typ | Dlaczego | Jak reagować |
|---------|-----|----------|--------------|
| **DS Bypass Rate** (S.1.4) | Leading | Wzrost = contributorzy aktywnie omijają system. Problem TERAZ, zanim pojawią się hardcoded colors w codebase. | Natychmiast: zbadaj dlaczego omijają (brak komponentu? złe API? nie znają?). |
| **Review Rounds** (S.1.2) | Leading | Wzrost = DS nie eliminuje mechanical issues. Reviewerzy nadal łapią kolory/spacing ręcznie. | W ciągu tygodnia: sprawdź lint rules coverage, dodaj brakujące reguły. |
| **Hardcoded colors count** (F) | Lagging | To jest pomiar stanu — spada tylko gdy ktoś aktywnie migruje. Nie sygnalizuje nowych problemów, potwierdza stare. | Trend miesięczny. Jeśli nie spada — brak migration activity. |
| **Arbitrary text sizes** (F) | Lagging | Jak wyżej. | Trend miesięczny. |
| **Empty state coverage** (F) | Lagging | Miara pokrycia — rośnie powoli z nowymi stronami i migracjami. | Trend miesięczny. |
| **DS Adoption Rate** (S.1.3) | Leading | Niski = nowe strony budowane bez DS. Problem rośnie z każdym nowym modułem. | Natychmiast: czy templates są łatwe do znalezienia? Czy lint rules działają? |
| **Time to First PR** (S.1.1) | Leading | Wzrost = DS nie przyspiesza onboardingu. | W ciągu 2 tygodni: obserwuj nowego contributora (Q.3), zidentyfikuj friction. |
| **Contributor Satisfaction** (S.1.5) | Lagging | Kwartalna retrospekcja stanu. Nie sygnalizuje problemów w real-time. | Trend kwartalny. Jeśli spada — deep dive w qualitative answers. |

**Zasada:** Na leading indicators reaguj w ciągu tygodnia. Na lagging indicators patrz w trendzie miesięcznym/kwartalnym.


---

## See also

- [Metrics](./metrics.md) — metryki techniczne (health check)
- [Research Plan](./research-plan.md) — metody zbierania danych
- [Iteration](./iteration.md) — jak metryki wpływają na roadmapę
