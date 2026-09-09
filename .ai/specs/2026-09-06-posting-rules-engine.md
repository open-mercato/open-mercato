# Posting Rules Engine — silnik dekretacji, konto 490

**Related:** [General Ledger core engine](2026-08-18-general-ledger-core-engine.md)
(silnik księguje do niego), [Journal Entry Line Dimension](2026-09-06-journal-entry-line-dimension.md)
(prerequisite — tabela wymiarów MPK, budowana jako osobny, wcześniejszy
dokument, nie część tego spec-a), [Accounts Payable](2026-09-06-accounts-payable.md)
(pierwsze realne źródło kosztów w zespole 4)

## TLDR

Automatyczne przeksięgowanie kosztów z zespołu 4 (koszty rodzajowe)
do zespołu 5 (koszty funkcjonalne/kalkulacyjne wg MPK) przez konto
techniczne 490 — wymagane regułą "Spójność P&L" ze ściany (oba
warianty 4xx/5xx muszą zwracać ten sam wynik netto). Rozstrzygnięte
2026-09-06: własny spec, prerequisite dla *produkcyjnej* gotowości
Accounts Payable, nie blocker jego budowania — sekwencjonowany
bezpośrednio po AP.

## Design Decisions (2026-09-07 — resolved)

**Reguły 4→5: domyślny szablon w Fazie 1, konfigurowalność w Fazie
2.** Gotowy szablon polskiego planu kont jest i tak potrzebny (HS-03)
— UI do customizacji reguł to rozszerzenie po sprawdzeniu, co realnie
wymaga dostosowania.

**Wykrywanie "zespół 4" rozwiązane przez `LedgerAccountType.
accountGroupId`.** Zamiast parsowania `slug`-a (nie generalizuje się
poza Polskę — niemiecki SKR03, francuski PCG i US GAAP mają inne
schematy), silnik sprawdza relacyjnie: `account.type.accountGroupId`
wskazuje na `LedgerAccountGroup` z `jurisdiction: 'PL'`, `code: '4'`
(patrz `.ai/specs/2026-08-18-general-ledger-core-engine.md` → Design
decisions, Architecture → Entities). `LedgerAccountGroup` to
seedowany per jurysdykcja słownik referencyjny, nie tenant-editable —
Faza 1 seeduje tylko `PL` (zespoły 0–8), inne jurysdykcje (USA i
kolejne, per plan platformy: pluginy krajowe) to później czyste dane,
zero zmiany schematu. `accountGroupId` jest niezmienny po pierwszym
zaksięgowanym wpisie na koncie danego typu, tak samo jak
`normalBalance`.

**Tabela wymiarów (`journal_entry_line_dimension`) to osobny,
wcześniejszy dokument, nie część tego spec-a.** Pierwotnie planowana
jako "Faza 1 tego spec-a" — wydzielona po review. **Korekta
(2026-09-08)**: wcześniejsze uzasadnienie ("#5663 już traktuje to jako
osobną zmianę") było błędnym cytowaniem — realny tekst #5663 mówi, że
tabela wymiarów i ten silnik "ship together... in a future spec"
(jeden, wspólny dokument). Prawdziwe uzasadnienie wydzielenia: tabela
ma więcej niż jednego niezależnego konsumenta — ten silnik teraz, i
niezależnie od niego `2026-09-06-fixed-assets.md` Faza 2
(`transferAsset`) później — więc żyje jako osobny, "pusty" moduł
schematu zamiast wewnątrz `posting_rules`, żeby Fixed Assets nie
musiał brać twardej zależności na cały ten silnik tylko po to, by
zapisać jeden tag wymiaru (pełne uzasadnienie:
`2026-09-06-journal-entry-line-dimension.md` → Skąd wzięła się
potrzeba tego dokumentu). Ten spec **konsumuje** gotową tabelę
(przez jej własne komendy, patrz ten dokument, Cross-module
integration — nie przez bezpośredni odczyt jej encji), nie buduje jej.

**Real-time, nie batch — przez zdarzenie, nie przez wspólną
transakcję.** Niezmiennik ZSiO ze ściany wymaga spójności „w dowolnym
momencie czasu" — batch na koniec miesiąca zostawiałby okno, w którym
warianty 4xx/5xx się nie zgadzają. Pierwotna wersja tej decyzji
zakładała "tę samą transakcję" co `postJournalEntry` źródła kosztu —
to nieosiągalne w tym systemie: `packages/events/AGENTS.md` zabrania
bezpośrednich wywołań między modułami, a jedyny dozwolony mechanizm
(zdarzenia + subskrybenci) jest z założenia fire-and-forget ("Inline
delivery logs each handler error and continues" — błąd subskrybenta
nie blokuje ani nie cofa emitującej komendy). Rozwiązanie:
`postJournalEntry` w #5663 emituje `ledger.journal_entry.posted`
(ephemeral — natychmiastowe, in-process, bez retry — patrz
`.ai/specs/2026-08-18-general-ledger-core-engine.md` → Architecture →
Events); `PostingRulesEngineSubscriber` odbiera je, sprawdza
`account.type.accountGroupId` → `jurisdiction: 'PL'`, `code: '4'` i od
razu księguje przeksięgowanie 490→5xx własnym wywołaniem
`postJournalEntry` (`referenceType: 'JournalEntry'`, `referenceId`
oryginalnego wpisu). To nie jest atomowe ze źródłowym zapisem — jest
mikroskopijne okno między oboma commitami, i brak automatycznego retry
jeśli reklasyfikacja się nie uda. Stąd dwa dodatkowe mechanizmy
poniżej.

**Mechanizm naprawczy: `ReconcileCostRingCommand` (sweeper).**
Cykliczna / wywoływana z CLI komenda, która znajduje "osierocone"
wpisy zespołu 4 bez odpowiadającego przeksięgowania na koncie 490
(np. po restarcie serwera w trakcie obsługi zdarzenia) i generuje dla
nich brakujące dekrety. Domyka ryzyko braku retry przy ephemeral
subskrybencie powyżej.

**Guard zamknięcia okresu: dedykowane wejście w `posting_rules`, nie
weto przez subskrybenta.** Subskrybent nie może zablokować
`lockFiscalPeriod` z #5663 — błędy subskrybenta są tylko logowane, nie
propagowane do emitującej komendy (patrz decyzja o komunikacji
zdarzeniowej powyżej). Zamiast tego `posting_rules` (konsument, zależny
od `ledger`) dostaje własną, wyższopoziomową komendę do zamykania
okresu, która najpierw sprawdza `findUnreclassifiedEntries() === 0`
dla danego okresu, a dopiero potem woła istniejące
`ledger.lockFiscalPeriod` — zwykłe wywołanie w dół (konsument →
zależność), tak samo jak silnik już woła `postJournalEntry`.
`ledger.lockFiscalPeriod` samo w sobie nic nie wie o zespołach ani
koncie 490 i działa samodzielnie, gdy `posting_rules` nie jest
zainstalowany (np. inna jurysdykcja) — bez gwarancji tego guardu w
takiej instalacji.

**Faza 1: tylko AP jako źródło kosztów.** Fixed Assets dochodzi
naturalnie, gdy jego własna Faza 2 (transferAsset/MPK) będzie gotowa.

**Zablokowany `FiscalPeriod` zatrzymuje cały łańcuch przeksięgowania
4→5, nie tylko źródłowy zapis.** Skoro reklasyfikacja to własne,
osobne wywołanie `postJournalEntry` (patrz decyzja o komunikacji
zdarzeniowej powyżej — nie ta sama transakcja co źródłowy zapis),
zablokowany okres odrzuca niezależnie: zapis źródłowy (AP/Fixed
Assets) *i* — osobnym wywołaniem — przeksięgowanie konto-490 tego
silnika, jeśli źródłowy `postJournalEntry` zdążył się zacommitować
tuż przed zablokowaniem okresu. To dwa niezależne wywołania tej samej
reguły w #5663 (`.ai/specs/2026-08-18-general-ledger-core-engine.md`
→ Design decisions), nie jeden wspólny punkt awarii. Do
zaprojektowania przy pełnej Architekturze: czy odrzucenie propaguje
się do źródłowego wywołania z czytelnym komunikatem, czy ten silnik
potrzebuje własnej, dodatkowej obsługi błędu — złagodzone w praktyce
przez Guard zamknięcia okresu powyżej, który ma zapobiegać zamknięciu
okresu z nieprzeksięgowanymi wpisami, zanim to w ogóle stanie się
problemem.

**Wymiar MPK: hybryda z priorytetem — Explicit Line Dimension →
`DefaultAccountPostingRule` → konto zawieszeń.** Skąd bierze się MPK
dla linii kosztu, skoro AP dziś nie ma jeszcze pola do jego ręcznego
wskazania: silnik sprawdza po kolei — (1) czy linia ma już zapisany
wymiar MPK w `journal_entry_line_dimension` (wpisany ręcznie w AP, gdy
to pole powstanie); (2) jeśli nie, czy istnieje `DefaultAccountPostingRule`
dla tego konta (nowa encja referencyjna, np. mapowanie "konto 401 →
MPK Administracja"); (3) jeśli nie, księguje na techniczne konto
zawieszeń 500-99 ("Koszty nierozliczone") i oznacza wpis do ręcznej
weryfikacji. Pozwala silnikowi działać od dnia zero na samych regułach
domyślnych, bez czekania na pole MPK w UI faktury AP — to pole, gdy
powstanie, po prostu zaczyna wypełniać ścieżkę (1) bez żadnej zmiany w
silniku.

**Generowanie P&L w obu wariantach należy do task #4/ZSiO, nie do
tego spec-a.** Ten spec dba tylko o to, żeby dane źródłowe (poprawnie
przeksięgowane, otagowane wpisy) istniały — sam raport to warstwa
reportingowa, inny właściciel.
