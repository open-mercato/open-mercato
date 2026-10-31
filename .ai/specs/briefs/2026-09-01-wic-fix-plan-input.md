# WIC: model rozliczenia i plan zmian

Kod: gałąź `feat/wic-evaluator-skill`, commit `6d28c125c` w repo `~/Documents/OM`. Praca na worktree.

## Model rozliczenia (ustalony)

**Jednostką rozliczenia jest PR zmergowany do gałęzi długowiecznej** publicznego,
niezarchiwizowanego repozytorium w organizacji `open-mercato`. Merge jest jedynym momentem
zaksięgowania, bo tylko on jest nieodwracalny: data i diff już się nie zmienią.

**Zasięg: 12 repozytoriów** (publiczne, nie zarchiwizowane): `open-mercato`, `official-modules`,
`skills`, `cezar`, `cezar-legacy`, `ready-apps`, `ready-app-oss-prm`, `open-mercato-evals`,
`n8n-nodes`, `open-mercato-infra`, `api-client-example`, `aida-ux`.
Kryterium mechaniczne to „publiczne i nie zarchiwizowane", a nie obecność pliku licencji: pięć
z nich (`cezar`, `ready-apps`, `ready-app-oss-prm`, `open-mercato-infra`, `aida-ux`) nie ma
`LICENSE`, co wygląda na przeoczenie do naprawienia osobno, a nie na powód odcięcia wypłat.

**Gałęzie długowieczne:** `develop` tam, gdzie istnieje (`open-mercato`, `official-modules`,
`cezar`, `ready-app-oss-prm`) oraz gałąź domyślna każdego repo. Obie księgują, bo w repo
z `develop` gałąź `main` też dostaje zwykłą pracę (#4957, #4917 w `open-mercato`).

**Wykluczenie rollupów:** PR, którego gałąź źródłowa sama jest gałęzią długowieczną, nie księguje
się wcale. Inaczej autor PR-a wydaniowego (#3594 `release: v0.6.6`, +156 065 linii) księguje cały
kwartał pracy zespołu.

**Deduplikacja:** ta sama gałąź źródłowa zmergowana do dwóch gałęzi długowiecznych tego samego repo
(wzorzec hotfiksa) księguje się raz. Klucz: (repo, `headRefName`).

**Miesiąc:** miesiąc merge'a. Podział na miesiące jest projekcją raportu na końcu, nie zapytaniem
na wejściu.

**Wejście:** znacznik startowy plus rejestr zaksięgowanych PR-ów kluczowany po (repo, numer PR).
Przebieg dopisuje, nigdy nie przepisuje. Repozytorium, które dopiero staje się publiczne, zaczyna
księgować od znacznika, więc historia się nie otwiera.

**Zgłoszenie błędu** księguje się autorowi zgłoszenia w momencie merge'a PR-a, który je zamyka
(`closingIssuesReferences`). Zgłoszenie bez naprawy jest warte zero.

**Specyfikacja** dodana pod `.ai/` księguje się jak każdy inny zmergowany PR; rozpoznawana
mechanicznie po ścieżkach plików.

## Co ten model kasuje z wcześniejszych wersji planu

Cutoff `--as-of`, sygnały akceptacji wyciągane z komentarzy, samocertyfikacja, wyjątek dla
niezmergowanych PR-ów z recenzją APPROVED, spór o przypisanie miesiąca, hash payloadu jako kotwica
audytowa. Wszystkie te problemy brały się stąd, że rozliczaliśmy zmienny stan zamiast zdarzenia
nieodwracalnego. Rejestr zaksięgowanych PR-ów zastępuje hash.

## Rozliczenie per PR (przesądzone)

Płacimy za każdy zmergowany PR osobno. Grupowania PR-ów w jedną funkcjonalność nie robimy:
rozbicie pracy na mniejsze PR-y jest pożądane i ma się opłacać, bo taki jest nasz proces
(`om-auto-create-pr-loop`).

Konsekwencja przyjęta świadomie: ta sama funkcjonalność dowieziona w dziesięciu małych PR-ach
kosztuje więcej niż dowieziona w jednym dużym, a dwóch partnerów robiących tę samą pracę może
dostać różne kwoty w zależności od tego, jak pocięli dostawę.

## Zmiany w fetcherze

### F1. Zapytanie po organizacji zamiast po jednym repo

Dziś `repo:open-mercato/open-mercato` na sztywno. Nowe: lista repo z
`gh repo list open-mercato --json name,isPrivate,isArchived`, filtr publiczne i nie zarchiwizowane,
potem `is:pr is:merged author:<login> merged:>=<watermark>` per repo, z pobraniem `baseRefName`,
`headRefName`, `mergedAt`, `closingIssuesReferences`.

### F2. Twarde błędy zamiast cichych zer

`ghJson()` łapie wszystko i zwraca `null` (`:12-16`), a wywołujący robi `|| []` (`:163-172`), więc
limit lub 422 daje artefakt bez danych przy kodzie wyjścia 0. Zmiana: `ghJson` rzuca; błędy do
`payload.errors[]`; niepusta lista to niezerowy kod wyjścia. Trzy ponowienia z backoffem na 403/429
przed twardym błędem, bo limit wyszukiwania to 30 zapytań na minutę, a teraz przechodzimy przez
12 repozytoriów. Zapis do pliku tymczasowego i `mv` na końcu.

### F3. Paginacja i sufit wyszukiwarki

`--paginate` bez `--slurp` na `search/issues` rozsypuje JSON przy ponad stu wynikach (odtworzone na
gh 2.72: `gh` kończy się kodem 0, emitując nieparsowalne wyjście). Osobno `search/issues` ma sufit
1000 wyników i zwraca 422. Zmiana: `--slurp`, scalenie `.items`, asercja
`items.length === total_count`, niezgodność to twardy błąd.

### F4. Higiena determinizmu

`generatedAt` do pliku sidecar. Sortowanie komentarzy po `id`, nie po treści (`:41-44`), bo edycja
komentarza przestawia dziś cały artefakt. `localeCompare` (`:46`, `:53`, `:57`, `:196`) na
porównanie po punktach kodowych.

### F5. Jeden format

Wrapper wymusza `FORMAT="markdown"`, a renderer markdown gubi daty artefaktu (`:285` wypisuje tylko
`merged=true, closed=true`). Zmiana: `FORMAT="json"` i usunięcie gałęzi markdown. Spec dostaje wpis
w changelogu, bo definiuje fixture jako markdown.

## Zmiany w rubryce

### R1. Tylko zmergowane PR-y

Znika cała ścieżka „niezmergowany PR z akceptacją Core Team" i cała ścieżka miękkiej akceptacji
z komentarzy. Pozycja albo jest zaksięgowana merge'em, albo nie istnieje.

### R2. Dwie komórki w tabeli poziomów

PoC z L2 na L4, Complex Bug / Deep Refactor z L1 na L3. Poziom staje się funkcją punktów bazowych
(1.0 = L4, 0.5 = L3, 0.25 = L1), L2 wycofane. Do sprawdzenia po stronie PRM, czy zniknięcie L2 nie
psuje mapowania na tier. Dziś refaktor na 63 plikach wychodzi jako L1, a specyfikacja jako L3.

### R3. Impact bonus liczony, nie oceniany

+0.25 gdy PR dotyka co najmniej trzech pakietów lub modułów (prefiksy ścieżek z `filesSummary`),
+0.25 gdy dotyka ścieżek testowych. Progi jako literalne stałe w rubryce. Bounty tylko przy jawnym
numerze w treści PR; ścieżka bounty jest obecnie nieaktywna, bo repo nie ma etykiety `bounty`,
i rubryka ma to odnotować.

### R4. Sufit na drobiazgi

Suma pozycji drobnych ograniczona do 1.0 miesięcznie, nadwyżka wykazana w kolumnie wykluczeń,
żeby partner widział, że praca została zauważona, tylko nie zapłacona ponad sufit.

Zakres działania sufitu, zapisany wprost, żeby nikt nie liczył na więcej: domyka rozbicie
w obrębie jednego miesiąca (dziesięć drobnych PR-ów daje 1.0, tyle samo co jeden duży), nie domyka
rozłożenia tych samych PR-ów na trzy miesiące (do 2.5) ani miksu jeden duży plus dziewięć drobnych
(2.0), bo sufitowane są tylko pozycje drobne. Globalnego sufitu miesięcznego nie wprowadzamy,
bo karałby miesiące z realnie dużą dostawą.

Zmienia wypłaty, wchodzi po akceptacji właściciela programu.

## Narzędzia i wersja

### C1. Komparator

`parseReport` czyta wyłącznie `lines[headerIndex + 2]` i po cichu ignoruje dalsze wiersze, a
`Why bonus` (wolna proza) bramkuje kod wyjścia. Zmiana: wszystkie wiersze, klucz (profil, zakres
`from..to`), brakujący wiersz to różnica, `Why bonus` poza polami bramkującymi. Bez flagi
`--strict`, jest jeden wywołujący.

### C2. Wersja i status raportów historycznych

Wersja na `2.0-agent`, wpis w changelogu speca, oraz zdanie wprost: raporty z marca i kwietnia 2026
powstały w innym modelu rozliczenia, nie są porównywalne z nowymi i nie służą do ustalania tieru.
Ich PR-y wchodzą do rejestru jako zaksięgowane, żeby nie policzyły się drugi raz.

## Kolejność

1. F2, F3 (bez nich żaden dump nie jest wiarygodny)
2. F1, F4, F5 (zasięg i kształt danych)
3. Rejestr, watermark, wykluczenie rollupów, deduplikacja
4. R1, R2, C1, C2 (nie wymagają decyzji biznesowej)
5. R3, R4 i reguła grupowania (zmieniają wypłaty, po akceptacji)
