# WIC: korpus testowy stary vs nowy

Stary = commit `6d28c125c`. Nowy = gałąź po zmianach z `wic-fix-plan.md`.
Mock `gh` na `PATH` odtwarza nagrane odpowiedzi kluczowane po `argv`: zero sieci, identyczne
wejście dla obu wersji.

## Warstwa skryptów (deterministyczna, do CI)

| # | Przypadek | Stary | Nowy |
|---|---|---|---|
| S1 | 403 na komentarzach jednego artefaktu | artefakt bez danych, kod wyjścia 0 | ponowienia, potem `errors[]`, kod != 0, brak pliku |
| S2 | dwie strony `search/issues` sklejone w jeden strumień | `JSON.parse` rzuca, profil ma zero kontrybucji, kod 0 | `--slurp`, komplet artefaktów |
| S3 | `total_count` 1500 przy 1000 pozycji | liczy na obciętym zbiorze, bez śladu | asercja nie przechodzi, twardy błąd |
| S4 | edytowany komentarz, `id` bez zmian | sortowanie po treści przestawia cały artefakt | różni się wyłącznie edytowane pole |
| S5 | awaria w trakcie zapisu | częściowo zapisany plik, kod 0 | brak pliku (temp + `mv`) |
| S6 | raport dwuwierszowy, drugi wiersz 9.9 vs 2.0 | `scoringMatchAll: true`, kod 0 | różnica wykryta, kod != 0 |
| S7 | brakujący wiersz w kopii B | przechodzi | brak wiersza to różnica |

## Warstwa modelu rozliczenia (nowe, nie miały odpowiednika)

| # | Przypadek | Oczekiwane |
|---|---|---|
| M1 | PR wydaniowy `release: v0.6.6`, head `develop`, base `main`, +156k linii | nie księguje się wcale |
| M2 | zwykła poprawka zmergowana prosto do `main` w repo, które ma `develop` | księguje się |
| M3 | ta sama gałąź źródłowa zmergowana do `develop` i do `main` | jedno zaksięgowanie |
| M4 | PR w `skills` (brak `develop`, tylko `main`) | księguje się z `main` |
| M5 | PR w repo prywatnym | poza zasięgiem, zero |
| M6 | PR już obecny w rejestrze, przebieg z wcześniejszym znacznikiem | nie księguje się ponownie |
| M7 | repo staje się publiczne, ma stare PR-y sprzed znacznika | stare PR-y nie wpadają do rozliczenia |
| M8 | issue zgłoszone przez partnera, zamknięte przez cudzy zmergowany PR | kredyt dla zgłaszającego w miesiącu merge'a |
| M9 | issue zgłoszone, nigdy nienaprawione | zero |
| M10 | PR dodający pliki pod `.ai/specs/` | księguje się jak każdy inny |

## Warstwa rubryki (ocena modelem: nowy musi trafić w oczekiwaną liczbę w trzech przebiegach)

| # | Przypadek | Stary | Nowy |
|---|---|---|---|
| R1 | refaktor na 63 plikach, 4 pakiety, ścieżki testowe | 0.75, Level **L1** | 1.00, Level **L3** |
| R2 | sam Major PoC | 1.00, Level **L2** | 1.00, Level **L4** |
| R3 | PR w 4 pakietach z testami vs PR w 2 pakietach bez testów | wartość zależna od przebiegu | dokładnie +0.50 vs +0.00 |
| R4 | miesiąc: 9 drobnych zmergowanych PR-ów + jeden duży refaktor | 2.25 + 0.75 = 3.00, L1 | sufit 1.00 + 1.00 = 2.00, L3 |
| R5 | spec pod `.ai/specs/X.md` w kwietniu, implementacja tego samego speca w maju | 0.5 + 1.0 = 1.50 | 0.5, potem dopłata 0.5, razem 1.00 |

## Dane realne

Przeliczyć marzec i kwiecień 2026 w nowym modelu i opublikować tabelę delty per pozycja.
Służy jako materiał do decyzji o R4 i o regule grupowania oraz jako dowód, że stare raporty nie
są porównywalne z nowymi.

Uwaga: stare dumpy z `.ai/runs/wic/` nie nadają się na korpus, bo powstały zapytaniem po jednym
repo, bez `baseRefName`, `headRefName` i `closingIssuesReferences`.
