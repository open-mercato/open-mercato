# Fixed Assets — środki trwałe, amortyzacja, OT, RMK

**Related:** [General Ledger core engine](2026-08-18-general-ledger-core-engine.md)
(posting engine ten spec księguje do; `LedgerAccount.parentAccountId`
już istnieje dla hierarchii planu kont), [Accounts Payable](2026-09-06-accounts-payable.md)
(zwykłe źródło wejścia aktywa — zakup od dostawcy)

## TLDR

Rejestr środków trwałych, tabela amortyzacyjna, dokument OT
(przyjęcie środka trwałego) i naliczanie miesięcznej amortyzacji +
RMK (rozliczenia międzyokresowe kosztów), księgujące się do GL.
Zidentyfikowany jako nowy zakres z event stormingu (HS-05), poza
dotychczasową kategoryzacją Month 1-3 dla #5663.

## Design Decisions (2026-09-07 — resolved)

**Wejście aktywa: zarówno przez AP (link), jak i ręcznie.** Bilans
otwarcia, aport i migracja istniejących środków trwałych wymagają
ścieżki niezależnej od AP — Fixed Assets nie ma twardej zależności od
zbudowania AP najpierw.

**Metoda amortyzacji: liniowa w Fazie 1, pluggable pod degresywną
później.** Liniowa to zdecydowana większość realnych przypadków;
`DepreciationCalculator` jako podmienialna strategia (SPEC-024)
zostawia miejsce na rozszerzenie bez przepisywania.

**Tabela amortyzacyjna jako materializowana encja, nie kalkulacja
on-the-fly.** Spójne z filozofią GL (JournalEntry append-only/
immutable) — historyczne wpisy amortyzacyjne nie mogą się cofnąć, gdy
ktoś zmieni parametry aktywa później; wymóg audytowy.

**Naliczanie amortyzacji: manualny trigger w Fazie 1.** Automatyczny
scheduler to Faza 2 — zmniejsza ryzyko operacyjne, zgodne z tym, jak
#5663 samo odłożyło automatyczne zamknięcie roku.

**Odrzucenie przez zablokowany `FiscalPeriod` przy manualnym
naliczaniu — obsługa jeszcze niezaprojektowana.** Skoro naliczanie
jest manualnym triggerem, ktoś może je odpalić dla okresu, który
właśnie został zamknięty — `postJournalEntry` w #5663 odrzuci zapis
(patrz `.ai/specs/2026-08-18-general-ledger-core-engine.md` → Design
decisions). Do zaprojektowania: sprawdzenie stanu blokady *przed*
próbą księgowania, nie tylko łapanie surowego błędu komendy po fakcie
— żeby błąd był czytelny dla osoby odpalającej naliczenie.

**RMK dzieli mechanizm z przyszłym Revenue Recognition — zostaje w
Fixed Assets na razie, jako świadomy dług architektoniczny.**
Strukturalna symetria: obie funkcjonalności to "kwota rozpoznawana
stopniowo wg harmonogramu" — to jest najsilniejszy sygnał do
wydzielenia generycznego mechanizmu spośród wszystkich rozważanych w
tej rundzie review. Mimo to, zostaje tutaj w Fazie 1: Revenue
Recognition to na razie tylko nazwa przyszłego modułu, bez własnego
szkieletu — wydzielanie wspólnego mechanizmu harmonogramowania teraz,
bez drugiego, realnego konsumenta przed oczami, ryzykuje zaprojektowanie
złej abstrakcji (zgadywanie kształtu API na podstawie jednego
przypadku użycia). Świadomie akceptujemy ryzyko przepisania RMK, gdy
Revenue Recognition faktycznie powstanie i ujawni, czy wspólny
mechanizm rzeczywiście pasuje do obu przypadków — bezpieczniejsze niż
projektować generyczną abstrakcję na ślepo.

**Własny rejestr aktywów, nie tylko `parentAccountId`.** Środek trwały
potrzebuje dużo więcej danych niż pozycja w hierarchii kont (data
nabycia, wartość, stawka, umorzenie) — `parentAccountId` to tylko
opcjonalny link raportowy do analitycznego konta w GL.

**Amortyzacja podatkowa: świadomie poza Fazą 1, ale zaprojektowana pod
rozszerzenie.** Bilansowa i podatkowa mogą się różnić wg polskiego
prawa (CIT/PIT vs UoR) — Faza 1 obsługuje tylko bilansową, z jawnie
oflagowaną luką i architekturą gotową na drugi harmonogram.

**`revalueAsset` i `transferAsset` — oba Faza 2.** Przeszacowanie to
rzadkie, roczne zdarzenie (Wycena majątku); transfer do MPK i tak
czeka na tabelę wymiarów (`2026-09-06-journal-entry-line-dimension.md`),
która sama jest budowana jako osobny, wcześniejszy krok przed Fixed
Assets Fazą 2.
