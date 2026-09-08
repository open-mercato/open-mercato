# Accounts Payable — dostawcy, obieg faktur zakupowych

**Related:** [General Ledger core engine](2026-08-18-general-ledger-core-engine.md)
(posting engine ten spec księguje do), the future [sales-invoice-gl-posting](2026-08-18-sales-invoice-gl-posting.md)
(planned, nie napisany jeszcze — analogiczny subscriber-wzorzec po stronie AR;
ta sama korekta cytatu co w `Contractor Registry`'s Related header),
[Contractor Registry](2026-09-06-contractor-registry.md)
(rejestr dostawcy — ten spec go konsumuje, nie duplikuje), [Journal Entry Line
Dimension](2026-09-06-journal-entry-line-dimension.md) (przyszły konsument
kosztów AP — silnik 490, ten spec go nie buduje), [Accounts Payable —
płatności](2026-09-06-accounts-payable-payments.md) (siostrzany dokument —
paczki płatnicze, wykonanie przelewu, weryfikacja Białej Listy; wydzielony
z tego dokumentu 2026-09-08, patrz Changelog)

## TLDR

Moduł obsługujący cykl życia zobowiązania od strony faktury: przyjęcie i
akceptację faktury zakupowej (w tym stan roboczy/bufor przed ostatecznym
zaksięgowaniem). Kończy się wywołaniem `postJournalEntry` w GL — ten
spec nie zmienia silnika księgowań, tylko go używa. Rejestracja i
weryfikacja kontrahenta (dostawcy) żyje w osobnym module — patrz
`Contractor Registry`. Grupowanie zatwierdzonych faktur w paczki
płatnicze i wykonanie przelewu żyje w osobnym, siostrzanym module —
patrz `Accounts Payable — płatności` — ten podział jest wynikiem
niezależnego review, nie pierwotnego projektu (patrz Changelog,
2026-09-08).

## Overview

Na ścianie proces AP to cztery równoległe ścieżki: (A) rejestracja i
weryfikacja kontrahenta (GUS/VIES/Biała Lista — wyciągnięte do
`Contractor Registry`), (B) zakup materiałów (PZ → faktura →
zaksięgowano), (C) zakup środka trwałego (OT, tabela amortyzacyjna —
wyciągnięte do osobnego spec-a Fixed Assets, patrz
`.ai/specs/2026-09-06-fixed-assets.md`), (D) płatności wychodzące
(limity budżetowe, paczki płatnicze — wyciągnięte do
`2026-09-06-accounts-payable-payments.md`, patrz niżej). Ten dokument
obejmuje wyłącznie B — A, C i D są świadomie wyciągnięte (własne,
niezależne funkcjonalności).

> **Market Reference**: SPEC-024 (przedwarsztatowy brief, sekcja "Accounts
> Payable Module") zakładał pełny three-way matching (`matchToOrder`
> wymagające `PurchaseOrder` i `GoodsReceipt`) i osobny typ
> `PaymentProposal`/`PaymentError`. Ściana (zweryfikowane źródło,
> patrz Design decisions) pokazała prostszy, dwuetapowy przepływ
> (PZ→faktura, bez formalnego PO) i nie potwierdziła żadnego z tych
> typów w kodzie — żaden z nich nie istnieje nigdzie w repo. Przyjęto
> to, co potwierdzone na warsztacie, a SPEC-024 potraktowano jako
> punkt odniesienia do tego, co świadomie odrzucono (three-way
> matching) i dlaczego (Faza 2, brak wsparcia w kodzie).

## Problem Statement

Dziś nie ma żadnego modułu odpowiadającego za stronę zakupową — GL
(#5663) księguje tylko finalne, zbalansowane zapisy, ale nic nie
zarządza obiegiem faktury przed zaksięgowaniem. To "biała karta w
kodzie" (brak istniejącej implementacji do rozszerzenia) —
potwierdzone bezpośrednio w repo: nie istnieje żaden moduł
`accounts_payable`, żadna encja `PurchaseOrder`/`GoodsReceipt`
finansowa, a moduł WMS (`packages/core/src/modules/wms`) ma przyjęcie
towaru jako realną, ilościową encję (`InventoryMovement`, `type:
'receipt'`) ale bez jakiegokolwiek pola finansowego ani ścieżki
księgowania — patrz Design decisions. Zakres i granice z sąsiednimi
modułami (Contractor Registry, płatności, Fixed Assets, Posting Rules
Engine) trzeba było ustalić explicite przed projektowaniem encji — co
ten dokument teraz robi.

**Ten dokument pierwotnie obejmował też płatności** (`PaymentBatch`/
`PaymentBatchLine`) w jednym module `accounts_payable`. Dwa
niezależne, świeży-kontekst review (compliance/checklist +
architektoniczny) doszły niezależnie do werdyktu SPLIT: osobne grupy
ACL, osobne wywołania `postJournalEntry` do GL, sprzężenie tylko przez
FK (jak do w pełni osobnego modułu), osobna domena ryzyka prawnego
(Biała Lista/MPP dotyczy tylko płatności). Zespół potwierdził podział
2026-09-08 — patrz Changelog i `2026-09-06-accounts-payable-payments.md`.

## Proposed Solution

Niezależny moduł `accounts_payable` z jedną grupą encji: **faktury
zakupowe** (`VendorInvoice`/`VendorInvoiceLine`, stan roboczy →
akceptacja → zaksięgowano). Obieg akceptacji faktury korzysta z
silnika `workflows` (patrz Design decisions poniżej — to nie było
jeszcze rozstrzygnięte w szkielecie i wymagało weryfikacji w kodzie).
Moduł nie księguje bezpośrednio do bazy — przejście w stan `posted`
wywołuje `postJournalEntry` z GL przez generyczny `commandBus`, tak
samo jak robi to każdy inny moduł wywołujący cudzą komendę (patrz
Architecture → Cross-module integration). Grupowanie zatwierdzonych
faktur w paczki płatnicze i wykonanie przelewu żyje w siostrzanym
module `accounts_payable_payments`, który odczytuje `VendorInvoice`
przez FK-id i ma na ten moduł twardy, zadeklarowany dependency
(patrz ten dokument's Module Dependency, i sibling doc's własny
`index.ts`).

### Design decisions (2026-09-07 — resolved na warsztacie)

**Kontrahent jest współdzieloną encją, nie duplikowaną w AP i AR.**
Test pojedynczej funkcjonalności: rejestr kontrahenta (weryfikacja
GUS/VIES, rachunek bankowy, obieg akceptacji) działa niezależnie od
obiegu faktur zakupowych — więc żyje w osobnym, współdzielonym
module (`2026-09-06-contractor-registry.md`), a AP odwołuje się do
niego przez FK-id.

**Stan roboczy faktury (bufor) wchodzi w Fazę 1.** Bez stanu
przed-zaksięgowania nie da się zbudować obiegu akceptacji — a to jest
sens istnienia AP. Status faktury: draft → pending-approval →
approved → posted.

**Konto 300 (GR/IR) wchodzi w Fazę 1.** Ściana pokazuje PZ-przed-
fakturą jako normalny, częsty przypadek (ścieżka "zakup materiałów"),
nie brzegowy wyjątek.

**Obieg akceptacji: prosty, jednostopniowy w Fazie 1.** Jeden
akceptujący, binarna decyzja. Konfigurowalne progi kwotowe i
wielostopniowe ścieżki to Faza 2.

**Brak specjalnego "hooka" pod przyszły silnik 490 — z jedną znaną
luką przejściową.** AP księguje zwykłe, zbalansowane
`JournalEntryLine` w konta zespołu 4 — silnik dekretacji (Posting
Rules Engine, gdy powstanie) czyta z osobnej tabeli wymiarów
(`2026-09-06-journal-entry-line-dimension.md`), nie potrzebuje niczego
dodatkowego od AP. Jedyna konwencja: mapowanie kont AP wskazuje na
zespół 4, nie bezpośrednio na zespół 5. Znana luka: samo istnienie
tabeli wymiarów nie zamyka okna — nic jej jeszcze nie zapisuje, dopóki
Posting Rules Engine (budowany bezpośrednio po AP, patrz
`.ai/specs/2026-09-06-posting-rules-engine.md`) faktycznie nie zacznie
tego robić (`2026-09-06-journal-entry-line-dimension.md` samo mówi:
"Pusta struktura teraz, bez logiki wypełniającej"). Jeśli AP zacznie
księgować zanim Posting Rules Engine w ogóle powstanie, faktury
zaksięgowane w tym oknie nie będą miały zapisanego wymiaru MPK do
retroaktywnej reklasyfikacji — trzeba je będzie ręcznie zreklasyfikować
po starcie silnika 490. Zaakceptowane świadomie jako koszt krótkiego
okna przejściowego, nie przeoczone.

**Purchase Order / three-way matching — Faza 2.** SPEC-024
(przedwarsztatowy brief) zakładał PO→GR→Invoice, ale ściana (aktualne,
zweryfikowane źródło) pokazuje tylko PZ→fakturę (two-way). Fazowanie
podąża za tym, co potwierdzone na warsztacie.

**Odrzucenie przez zablokowany `FiscalPeriod` — teraz zaprojektowane
(patrz niżej).** Faktura może czekać w buforze (draft →
pending-approval → approved) dłużej niż trwa otwarty okres
obrachunkowy. Rozwiązanie: patrz Architecture → Commands
(`postVendorInvoice`) i Risks & Impact Review → Data integrity
failures.

**Weryfikacja Białej Listy/MPP nie jest zagadnieniem tego dokumentu.**
To twardy blocker prawny, ale dotyczy momentu **płatności**, nie
przyjęcia/zaksięgowania faktury — pełne uzasadnienie prawne i
projekt żyją w siostrzanym `2026-09-06-accounts-payable-payments.md`.

### Design decisions (2026-09-07 — dodane podczas pełnego rozwijania spec-a)

Poniższe decyzje nie były jeszcze rozstrzygnięte w szkielecie — każda
wymagała sprawdzenia w realnym kodzie (nie na ścianie), więc są
oznaczone osobno.

**Obieg akceptacji faktury używa silnika `workflows`
(`defineWorkflow`/`USER_TASK`), nie `useGuardedMutation`.**
Sprawdzone w kodzie: jedyny zaimplementowany w repo precedens dla
decyzji typu approve/reject (`sales.order-approval`,
`packages/core/src/modules/sales/workflows.ts`) używa pełnego
workflow engine — `USER_TASK` z `formSchema` (`decision: approve |
reject`), automatyczne przejścia (`UPDATE_ENTITY` na status,
`EMIT_EVENT`), i front-end kompletujący zadanie przez
`POST /api/workflows/tasks/:id/complete` (zwykły `useMutation`, nie
`useGuardedMutation` — to nie jest edycja pola przez `CrudForm`).
`useGuardedMutation` jako "guarded row action" jest realnym wzorcem
tylko dla prostego, odwracalnego toggle (GL's fiscal-period lock/
unlock) — nie dla jednorazowej decyzji approve/reject. Faktura AP to
dokładnie ten drugi przypadek ("jeden akceptujący, binarna decyzja"),
więc AP przyjmuje wzorzec `sales.order-approval` 1:1: `submit for
approval` emituje zdarzenie, `workflows.ts` deklaruje trigger na to
zdarzenie (`eventPattern`), `registerWorkflowSafeCommands` autoryzuje
komendę aktualizującą status, a widget wstrzyknięty w
`backend/accounts_payable/invoices/[id]/page.tsx` pokazuje zadanie do
wykonania — analogicznie do `widgets/injection/order-approval/`. Ta
sama korekta (dokładnie ten sam błędny cytat) została naniesiona
wstecz na już otwarty PR #5955 (Contractor Registry) — patrz tamten
spec's Changelog, 2026-09-07 "approval-pattern citation corrected".

**Wywołanie `postJournalEntry` z GL idzie przez generyczny
`commandBus`, nie przez `tryResolve`/DI-token jak
`checkBankAccountWhitelist`.** To rozróżnienie ma znaczenie: GL nie
jest opcjonalnym peerem dla AP (moduł AP bez GL nie ma sensu — to
twardy, zadeklarowany dependency), więc `packages/core/AGENTS.md` →
Cross-Module Coupling nie ma tu zastosowania (ten wzorzec jest dla
integracji *opcjonalnej*, gdzie brakujący peer musi dać się bezpiecznie
zdegradować). AP wywołuje `container.resolve('commandBus').execute('ledger.postJournalEntry', input, ctx)`
— dokładnie ten sam generyczny mechanizm, którego `workflows`
`UPDATE_ENTITY` już używa do wołania komend po stringowym `commandId`
(`packages/core/src/modules/workflows/lib/activity-executor.ts`).
Zdecydowanie prostsze niż wymyślanie nowego mechanizmu dla tego
przypadku — i zgodne z tym, że GL samo mówi "Phase 1 comes from
`postJournalEntry` called programmatically by a downstream
integration" (GL nie ma jeszcze własnej ścieżki HTTP do tego).

**`goodsReceiptReference` to prawdziwy FK-id do `InventoryMovement`
(WMS), nie wolny tekst — korekta po niezależnym review.** Pierwsza
wersja tej decyzji zakładała, że żadna encja PZ/goods-receipt nie
istnieje w kodzie. Niezależny, świeży-kontekst review znalazł, że to
nieprawda: `packages/core/src/modules/wms`'s `InventoryMovement`
(`type: 'receipt'`, `referenceType: 'po'|'so'|'transfer'|'manual'|'qc'|'rma'`)
to realna, działająca encja przyjęcia towaru, z komendą
`wms.inventory.receive` i UI (`ReceiveInventoryDialog.tsx`). To, co
faktycznie nie istnieje, to wyłączony toggle
(`wms_integration_procurement_goods_receipt`) — a ten dotyczy tylko
przyszłej integracji PO-do-przyjęcia, nie samego przyjęcia. Skutek:
`VendorInvoice.goodsReceiptReference` to nullable `uuid` (FK-id →
`InventoryMovement.id` gdzie `type = 'receipt'`, brak relacji ORM),
nie zwykły string.

**To nie zmienia analizy konta 300 poniżej.** `InventoryMovement` to
czysto ilościowa encja magazynowa (quantity/warehouse/location/lot),
bez jakiegokolwiek pola finansowego (brak `amount`, brak `accountId`)
i bez żadnego wywołania `postJournalEntry`/`commandBus` gdziekolwiek w
`wms/commands/inventory-actions.ts` (sprawdzone niezależnie). Więc
mimo że encja przyjęcia istnieje, nic po stronie WMS nadal nie
księguje drugiej nogi konta 300 — luka opisana niżej pozostaje
aktualna; zmienia się tylko to, czy `goodsReceiptReference` jest
realnym odnośnikiem czy wolnym tekstem.

**Konto 300 (GR/IR): świadomie jednostronna, przejściowa luka w Fazie
1 — nie mechanizm rozliczający się do zera.** Standardowy przepływ
GR/IR wymaga dwóch zapisów: przy przyjęciu towaru (DR koszt/zapas, CR
300) i przy fakturze (DR 300, CR zobowiązania) — dopiero oba razem
zerują konto 300. Ponieważ żadna ścieżka nie księguje pierwszej nogi
finansowo (PZ — `InventoryMovement`, patrz wyżej — istnieje jako
encja, ale nie ma pola na kwotę ani konto i nigdy nie woła
`postJournalEntry`), `postVendorInvoice` w tym dokumencie księguje
**tylko** drugą nogę (DR 300, CR zobowiązania). Skutek: konto 300
będzie pokazywać rosnące, nigdy niezerowane saldo DR, dopóki WMS nie
zacznie księgować przyjęć finansowo — to jest zaakceptowana świadomie,
wprost udokumentowana luka przejściowa (analogiczna do luki z
wymiarem MPK/kontem 490 powyżej), nie błąd projektu. Patrz Risks &
Impact Review → Data integrity failures dla pełnego opisu i
zrewidowanej mitigacji (GL's własna trasa do odczytu salda konta jest
wycięta z Fazy 1 — patrz tamten Risk dla szczegółów).

**VAT naliczony dostaje własne konto — nie jest cicho wliczany w
konto kosztowe.** Korekta po niezależnym review, który prześledził
matematykę księgowania na przykładzie: gdyby `postVendorInvoice`
księgował DR per pozycja tylko na jej `accountId` bez osobnej nogi na
VAT, to żeby zapis się zbilansował z CR na pełną kwotę brutto
zobowiązania, DR musiałby po cichu zawierać VAT — zawyżając koszt w
rachunku wyników i nigdy nie ujmując podatku naliczonego jako
należność od urzędu skarbowego (realny składnik aktywów w polskiej
rachunkowości). Poprawka: `postVendorInvoice` księguje DR netto per
pozycja na jej `accountId`, jedną zagregowaną DR na skonfigurowane
konto VAT naliczonego (`accounts_payable.vatInputAccountId`, suma
`taxAmount` wszystkich pozycji), i CR na konto zobowiązań na pełną
kwotę brutto — patrz Architecture → Commands, Data Models → Module
Config.

**Obieg akceptacji woła osobną, wąską komendę — nie
`updateVendorInvoice`.** Pierwsza wersja tego dokumentu rejestrowała
`accounts_payable.vendor_invoices.update` (tę samą komendę co edycja
pól roboczej faktury) jako `registerWorkflowSafeCommands`'s cel dla
przejścia `PENDING_APPROVAL` → `APPROVED`/`REJECTED` — ale
`updateVendorInvoice` jest zdefiniowane wyżej jako działające
**tylko** na `status === 'DRAFT'`. Niezależny review złapał tę
sprzeczność: albo strażnik statusu odrzuciłby własne przejście
workflow-u, albo reguła "tylko DRAFT" po cichu nie dotyczyłaby wywołań
z workflow-u — żadna z tych opcji nie była zaprojektowana. Poprawka:
osobna, wąska komenda `applyVendorInvoiceApprovalDecision`,
rejestrowana osobno w `registerWorkflowSafeCommands`, która **tylko**
przenosi `PENDING_APPROVAL` → `APPROVED`/`REJECTED` (i nic więcej) —
patrz Architecture → Commands, Workflow definition. To celowe
odejście od `sales.order-approval`'s wzorca (tam `sales.orders.update`
jest reużyte dla obu celów) — sprawdzone, że sales ma dokładnie ten
sam potencjalny problem, nierozwiązany w tamtym module; AP go unika
zamiast kopiować.

**Twardy dependency na `ledger` jest realnym mechanizmem
(`ModuleInfo.requires`), nie tylko stwierdzeniem w tekście.**
Niezależny review sprawdził, że `metadata.requires: string[]` istnieje
i jest walidowane przy generowaniu (`packages/shared/src/modules/registry.ts`,
`packages/cli/src/lib/generators/module-registry.ts`), używane
dziś przez `sales` (`requires: ['catalog','customers','dictionaries']`)
i `wms`. Pierwsza wersja tego dokumentu twierdziła, że AP deklaruje to
w ten sposób, ale nie projektowała tego nigdzie (brak `index.ts` w
Architecture/File Manifest) — poprawka: patrz Architecture → Module
Dependency (`index.ts`), File Manifest.

### Design decisions (2026-09-08 — Q1 resolved: podział na dwa moduły)

**Rozdzielono na `accounts_payable` (ten dokument — faktury) i
`accounts_payable_payments` (siostrzany dokument — płatności).**
Dwa niezależne, świeży-kontekst review (fresh-context, jak
`spec-checklist.md` wymaga) doszły niezależnie do werdyktu SPLIT:
osobne grupy ACL (`invoices.*` vs `payments.*`), osobne wywołania
`postJournalEntry` do GL (dwa różne zapisy księgowe, dwa różne
momenty), sprzężenie tylko przez FK (`PaymentBatchLine.vendorInvoiceId`
— ten sam kształt co odwołanie do w pełni osobnego modułu Contractor
Registry), osobna domena ryzyka prawnego (Biała Lista/MPP dotyczy
tylko płatności, nie przyjęcia faktury). Kontrargument za COHESIVE
(współdzielone konto zobowiązań, żywy dostęp do zatwierdzonych faktur
przy budowaniu paczki) był realny, ale nie przeważył — a pierwsza
wersja tego dokumentu uzasadniała "Pass" analogią do tego, jak GL
zostawił `FiscalPeriod` w jednym dokumencie, co po sprawdzeniu okazało
się nietrafnym porównaniem (GL's własny scope-cohesion check też
zwrócił SPLIT i został tam utrzymany tylko przez jawną decyzję
interesariusza, nie przez czyste uzasadnienie architektoniczne).
Zespół potwierdził SPLIT 2026-09-08. Współdzielone konto zobowiązań
(`accounts_payable.liabilityAccountId`) zostaje **celowo** własnością
tego dokumentu (ustawiane przez jego config UI) i jest **czytane**
przez `accounts_payable_payments` — to jedyny zamierzony punkt
sprzężenia między dwoma modułami poza samym FK, udokumentowany
explicite w obu dokumentach, żeby uniknąć rozjazdu.

### Alternatives considered

| Alternative | Why Rejected |
|-------------|-------------|
| `useGuardedMutation` prosty toggle dla approve/reject faktury | Nie ma pokrycia w żadnym realnym, zaimplementowanym precedensie repo dla decyzji approve/reject (tylko dla odwracalnych toggle jak GL lock/unlock); `sales.order-approval` — jedyny realny precedens tego typu decyzji — używa pełnego workflow engine |
| Pominięcie konta 300 w Fazie 1, księgowanie wprost na konto zespołu 4 | Rozważone i odrzucone po konsultacji — ściana wprost i świadomie chce konta 300 już w Fazie 1 (nie jako brzegowy przypadek); przyjęto zamiast tego udokumentowaną, jednostronną lukę przejściową, patrz Design decisions powyżej |
| Automatyczne mapowanie konto-per-dostawca/kategoria (silnik regułowy) | Brak jakiegokolwiek precedensu w repo dla tego typu mapowania (sprawdzone — nic podobnego nie istnieje); zbudowanie własnego silnika regułowego dla AP dublowałoby przyszły Posting Rules Engine (konto 490), który dokładnie to ma robić. Faza 1: ręczny wybór konta per pozycja faktury + tenant-owe wartości konfiguracyjne (patrz Data Models, Module Config) |
| Zostawić faktury i płatności w jednym module `accounts_payable` | Odrzucone 2026-09-08 po dwóch niezależnych review — patrz Design decisions, "Q1 resolved" |

## User Stories

- **Pracownik AP** chce **wprowadzić fakturę zakupową jako roboczą i
  uzupełniać ją stopniowo**, żeby **nie blokować się na
  jednorazowym, kompletnym wprowadzeniu wszystkich danych naraz**.
- **Pracownik AP** chce **przesłać fakturę do akceptacji jednym
  kliknięciem**, żeby **przełożony zobaczył ją w swoim panelu zadań
  bez ręcznego powiadamiania**.
- **Osoba akceptująca** chce **zatwierdzić albo odrzucić fakturę z
  jednego ekranu, z opcjonalnym komentarzem**, żeby **decyzja była
  udokumentowana i nieodwracalna bez śladu**.
- **Główny księgowy** chce **mieć pewność, że zaksięgowana faktura
  nigdy nie zniknie z konta 202 bez odpowiadającego zapisu
  płatności** (rejestrowanego przez `accounts_payable_payments`), żeby
  **rozrachunki z dostawcami zawsze się zgadzały** — to jest właśnie
  ta cross-modułowa relacja, którą oba dokumenty muszą utrzymać
  spójnie mimo podziału (patrz Design decisions, "Q1 resolved").
- **Główny księgowy** chce **czytelny komunikat zamiast surowego błędu
  komendy, gdy próbuje zaksięgować fakturę w zamkniętym okresie**,
  żeby **wiedział, co dalej zrobić (przełożyć datę czy poprosić o
  odblokowanie okresu)**.

## Architecture

### Entities (`data/entities.ts`)

- `VendorInvoice` — `vendorId` (FK-id → `Contractor`, `uuid`, brak
  relacji ORM), `vendorSnapshot` (nullable `json` — nazwa/NIP dostawcy
  w momencie utworzenia faktury, wyłącznie do renderowania listy bez
  live-joina; analogiczne do `SalesInvoice.customerSnapshot` po
  stronie AR, ale to **inny** snapshot niż `JournalEntryLine.contractorSnapshot`
  z GL — ten drugi powstaje dopiero przy księgowaniu i jest zapisem
  audytowym GL, nie danymi UI tego modułu), `invoiceNumber` (własny
  numer faktury dostawcy, wolny tekst — to nie jest dokument, który
  numerujemy sami), `invoiceDate`, `dueDate`, `currencyId` (FK-id,
  `uuid`, jak `JournalEntry.currencyId` w GL), `status`
  (`DRAFT`/`PENDING_APPROVAL`/`APPROVED`/`REJECTED`/`POSTED`/
  `CANCELLED`), `goodsReceiptReference` (nullable `uuid`, FK-id →
  `wms.InventoryMovement.id` gdzie `type = 'receipt'`, brak relacji
  ORM — patrz Design decisions), `totalNet`/`totalTax`/`totalGross`
  (`numeric(19,4)`, wyliczane z pozycji), `postedJournalEntryId`
  (nullable FK-id — ustawiane raz, po skutecznym `postJournalEntry`;
  służy też jako idempotency guard przed podwójnym zaksięgowaniem),
  tenant/org scoped, `updatedAt` (optymistyczna blokada aktywna dopóki
  `status !== 'POSTED'`), `deletedAt` (soft delete, blokowany dla
  statusów innych niż `DRAFT`/`REJECTED`/`CANCELLED` — patrz
  Commands). **Czytana przez `accounts_payable_payments`** (FK-id
  `PaymentBatchLine.vendorInvoiceId`, tylko faktury `POSTED` mogą
  wejść do paczki płatniczej) — to jest cross-modułowy konsument tej
  encji, patrz siostrzany dokument.
- `VendorInvoiceLine` — `vendorInvoiceId` (FK), `accountId` (FK-id →
  `LedgerAccount`, oczekiwany w zespole 3 [konto 300] albo zespole 4
  — walidowane na poziomie komendy, nie ograniczenia bazy, ta sama
  konwencja co GL's `LedgerAccountType`/`LedgerAccount` bez wymuszania
  numeracji w schemacie), `description`, `netAmount`, `taxRate`,
  `taxAmount`, `grossAmount` (`numeric(19,4)`), własne
  `organizationId`/`tenantId` (jak `ContractorBankAccount` — nie tylko
  odziedziczone przez `vendorInvoiceId`).

### Access Control (`acl.ts`)

Podążając za konwencją modułu `customers`/`ledger`
(`<module>.<resource>.<action>`, `manage`/`post` zależne od `view`):

```typescript
export const features = [
  { id: 'accounts_payable.invoices.view', title: 'View vendor invoices', module: 'accounts_payable' },
  { id: 'accounts_payable.invoices.manage', title: 'Create and edit vendor invoices', module: 'accounts_payable', dependsOn: ['accounts_payable.invoices.view'] },
  { id: 'accounts_payable.invoices.post', title: 'Post vendor invoices to the ledger', module: 'accounts_payable', dependsOn: ['accounts_payable.invoices.view'] },
]
```

`createVendorInvoice`/`updateVendorInvoice`/`submitVendorInvoiceForApproval`
require `accounts_payable.invoices.manage`; `postVendorInvoice`
requires `accounts_payable.invoices.post` (osobno od `.manage` —
mirror `ledger.accounts.manage` vs `ledger.entries.post`: samo
edytowanie roboczej faktury to inna wrażliwość niż wysłanie
nieodwracalnego zapisu do GL).

**Decyzja o approve/reject faktury nie ma własnej funkcjonalności
ACL w tym module** — przechodzi przez `POST
/api/workflows/tasks/:id/complete`, bramkowane `workflows.tasks.complete`
z modułu `workflows` (patrz Cross-module integration) — to świadomy
wybór spójności z jedynym realnym, produkcyjnym precedensem
(`sales.order-approval` robi dokładnie tak samo; w module `workflows`
istnieje też demo `workflows.simple-approval`, ale to jawnie oznaczony
przykład testowy/demonstracyjny, nie precedens biznesowy), nie
przeoczenie.

**Brak kontroli maker-checker (samo-akceptacji) w Fazie 1 —
udokumentowane ryzyko, nie przeoczenie.** Domyślne `defaultRoleFeatures`
dają roli `employee` zarówno `accounts_payable.invoices.manage`
(potrzebne do wprowadzenia i przesłania faktury), jak i — pośrednio,
przez `workflows.tasks.complete` z modułu `workflows` — możliwość
dokończenia własnego zadania akceptacji. Nic w projekcie nie
odróżnia "osoby, która wprowadziła fakturę" od "osoby akceptującej"
(ten sam brak istnieje już w `sales.order-approval`, które AP
mirroruje). Patrz Risks & Impact Review dla pełnego zapisu tego
ryzyka.

### Module Dependency (`index.ts`)

GL jest twardym, zadeklarowanym dependency (patrz Design decisions,
Cross-module integration) — nie opcjonalnym peerem. Wyrażone przez
realny, zwalidowany przy generowaniu mechanizm `ModuleInfo.requires`
(`packages/shared/src/modules/registry.ts`), już używany przez
`sales` (`requires: ['catalog','customers','dictionaries']`) i `wms`:

```typescript
// index.ts
import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  id: 'accounts_payable',
  requires: ['ledger'],
}
```

`contractors` nie jest na tej liście — ten moduł tylko trzyma
`vendorId` jako plain FK-id (żadnego `tryResolve`, żadnego wywołania
serwisu); żywa weryfikacja Białej Listy żyje w
`accounts_payable_payments`, nie tutaj.

### Encryption (`encryption.ts`)

`VendorInvoice.vendorSnapshot` przechowuje zdenormalizowaną nazwę i
NIP dostawcy (patrz Entities) — strukturalnie identyczne do
`SalesOrder.customerSnapshot`/`SalesQuote.customerSnapshot`, oba
zadeklarowane w `sales/encryption.ts`. AP robi to samo:

```typescript
// encryption.ts
export const defaultEncryptionMaps = {
  'accounts_payable:vendor_invoice': ['vendor_snapshot'],
}
```

Odczyty przez `findWithDecryption`/`findOneWithDecryption`, z
`tenantId`/`organizationId` zawsze przekazywanymi — jak wymaga
`packages/core/AGENTS.md` → Encryption.

### Module Setup (`setup.ts`)

```typescript
defaultRoleFeatures: {
  admin: ['accounts_payable.*'],
  employee: [
    'accounts_payable.invoices.view',
    'accounts_payable.invoices.manage',
  ],
},

async seedDefaults({ em, tenantId, organizationId }) {
  // Rejestruje domyślny workflow 'accounts_payable.invoice-approval'
  // przez createWorkflowsModuleConfig — patrz Workflow definition
  // poniżej. Nie zapisuje żadnych wierszy samo w sobie: definicja
  // kodowa (source: 'code') jest projektowana przez workflows
  // dopóki nikt jej nie zmaterializuje w bazie (patrz
  // packages/core/src/modules/workflows/AGENTS.md → Trigger Sources
  // And Precedence).
}
```

### Commands (Command Pattern, `commands/`)

- `createVendorInvoice` / `updateVendorInvoice` — tylko status
  `DRAFT`. Waliduje sumy pozycji (`netAmount`+`taxAmount` =
  `grossAmount` per linia, suma linii = `totalNet`/`totalTax`/
  `totalGross` na nagłówku). Nie waliduje weryfikacji dostawcy —
  faktura robocza może istnieć zanim dostawca zostanie w pełni
  zweryfikowany w GUS/VIES (to blokuje dopiero płatność w
  `accounts_payable_payments`, nie wprowadzenie faktury).
- `submitVendorInvoiceForApproval` — `DRAFT` → `PENDING_APPROVAL`.
  Emituje `accounts_payable.vendor_invoice.submitted` (persistent) —
  to jest jedyny sposób uruchomienia workflow-u akceptacji, patrz
  Workflow definition. Wymaga co najmniej jednej pozycji.
- `applyVendorInvoiceApprovalDecision` — wołana **tylko** wewnątrz
  workflow-u (nie z UI wprost — patrz Workflow definition), przez
  `UPDATE_ENTITY`, `PENDING_APPROVAL` → `APPROVED` albo `REJECTED` i
  nic więcej (nie przyjmuje żadnych innych pól). Zarejestrowana
  osobno w `registerWorkflowSafeCommands`, wymaga
  `accounts_payable.invoices.manage`. **Celowo nie jest
  `updateVendorInvoice`** — patrz Design decisions ("Obieg akceptacji
  woła osobną, wąską komendę") dla sprzeczności, którą to unika.
- `postVendorInvoice` — `APPROVED` → `POSTED`. Resolves
  `commandBus` z kontenera (patrz Cross-module integration) i woła
  `ledger.postJournalEntry` z: jedną linią DR **netto** per
  `VendorInvoiceLine` (na jej `accountId`, kwota `netAmount`, nie
  `grossAmount` — patrz Design decisions, "VAT naliczony dostaje
  własne konto"), jedną zagregowaną linią DR na skonfigurowane konto
  VAT naliczonego (`accounts_payable.vatInputAccountId`, suma
  `taxAmount` wszystkich pozycji — pomijana, jeśli suma wynosi zero)
  i jedną linią CR na skonfigurowane konto zobowiązań
  (`accounts_payable.liabilityAccountId`, pełna kwota `totalGross` —
  `ModuleConfigService`, patrz Data Models — **ta sama wartość
  konfiguracyjna, którą później czyta `accounts_payable_payments`**),
  z `referenceType: 'accounts_payable:vendor_invoice'`,
  `referenceId: invoice.id`. Ustawia `postedJournalEntryId`
  wyłącznie po sukcesie (idempotency guard — ponowne wywołanie na
  fakturze, która ma już `postedJournalEntryId`, jest no-opem, nie
  duplikuje zapisu). **Obsługa zablokowanego okresu**: jeśli
  `ledger.postJournalEntry` odrzuci wywołanie (okres pokrywający
  `invoiceDate`/`postedAt` jest zablokowany), `postVendorInvoice`
  łapie ten błąd i zwraca czytelny komunikat domenowy
  (`FISCAL_PERIOD_LOCKED`, z nazwą/zakresem zablokowanego okresu) —
  faktura zostaje w stanie `APPROVED` (nie traci akceptacji, nie
  wraca do `DRAFT`), gotowa do ponownej próby po odblokowaniu okresu
  albo do ręcznej zmiany `invoiceDate` na aktualnie otwarty okres
  przez główną księgową. To domyka Design decision, który w
  szkielecie był otwarty ("obsługa jeszcze niezaprojektowana").
- `cancelVendorInvoice` — `DRAFT`/`REJECTED` → `CANCELLED`
  (soft-delete via `deletedAt`). Zablokowane dla `PENDING_APPROVAL`/
  `APPROVED`/`POSTED`.

### Workflow definition (`workflows.ts`)

Mirror 1:1 wzorca `sales.order-approval`
(`packages/core/src/modules/sales/workflows.ts`) — nie nowy
mechanizm, ten sam:

```typescript
import { defineWorkflow, createWorkflowsModuleConfig } from '@open-mercato/shared/modules/workflows'
import { registerWorkflowSafeCommands } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'

registerWorkflowSafeCommands([
  { commandId: 'accounts_payable.vendor_invoices.applyApprovalDecision', requiredFeatures: ['accounts_payable.invoices.manage'] },
])

const invoiceApproval = defineWorkflow({
  workflowId: 'accounts_payable.invoice-approval',
  workflowName: 'Vendor Invoice Approval Workflow',
  steps: [
    { stepId: 'start', stepType: 'START' },
    {
      stepId: 'pending_approval',
      stepType: 'USER_TASK',
      userTaskConfig: {
        formSchema: {
          type: 'object',
          required: ['decision'],
          properties: {
            comments: { type: 'string' },
            decision: { enum: ['approve', 'reject'], type: 'string' },
          },
        },
        slaDuration: 'PT24H',
      },
    },
    { stepId: 'approved', stepType: 'AUTOMATED' },
    { stepId: 'rejected', stepType: 'AUTOMATED' },
    { stepId: 'end', stepType: 'END' },
  ] as const,
  transitions: [ /* start→pending_approval (auto), pending_approval→approved
                    (preCondition: decision === 'approve'), pending_approval→rejected
                    (preCondition: decision === 'reject'), both →end — identyczna
                    struktura co sales.order-approval, patrz ten plik */ ],
  triggers: [{
    triggerId: 'invoice_approval_trigger',
    eventPattern: 'accounts_payable.vendor_invoice.submitted',
    config: { entityType: 'VendorInvoice' },
    enabled: true,
    priority: 0,
  }],
})

export const workflowsConfig = createWorkflowsModuleConfig({
  moduleId: 'accounts_payable',
  workflows: [invoiceApproval],
})

export default workflowsConfig
```

Jedna różnica strukturalna wobec `sales.order-approval` — nie
kosmetyczna, wynika wprost z Design decisions: sales uruchamia workflow
natychmiast po **utworzeniu** zamówienia (`eventPattern:
'sales.order.created'` — zamówienie nie ma osobnego stanu roboczego
przed wysłaniem do akceptacji). AP ma jawny stan `DRAFT` przed
akceptacją (Design decision: "Bez stanu przed-zaksięgowania nie da się
zbudować obiegu akceptacji"), więc trigger wiąże się z osobnym
zdarzeniem `accounts_payable.vendor_invoice.submitted`, emitowanym
dopiero przez `submitVendorInvoiceForApproval` — nie z
`accounts_payable.vendor_invoice.created`.

### Events (`events.ts`)

```typescript
const events = [
  { id: 'accounts_payable.vendor_invoice.created', label: 'Vendor Invoice Created', entity: 'vendor_invoice', category: 'crud' },
  { id: 'accounts_payable.vendor_invoice.submitted', label: 'Vendor Invoice Submitted For Approval', entity: 'vendor_invoice', category: 'lifecycle' },
  { id: 'accounts_payable.vendor_invoice.approved', label: 'Vendor Invoice Approved', entity: 'vendor_invoice', category: 'lifecycle' },
  { id: 'accounts_payable.vendor_invoice.rejected', label: 'Vendor Invoice Rejected', entity: 'vendor_invoice', category: 'lifecycle' },
  { id: 'accounts_payable.vendor_invoice.posted', label: 'Vendor Invoice Posted', entity: 'vendor_invoice', category: 'lifecycle' },
] as const
```

`accounts_payable.vendor_invoice.posted` jest ephemeral (mirror
`ledger.journal_entry.posted`) — żaden subscriber persistentny nie
jest jeszcze potrzebny w Fazie 1; przyszły Posting Rules Engine
subskrybuje bezpośrednio `ledger.journal_entry.posted` (z GL), nie
zdarzenia AP — AP nie jest jego źródłem danych, GL jest (patrz
`2026-09-06-posting-rules-engine.md`). `accounts_payable_payments`
**nie** subskrybuje żadnego z powyższych zdarzeń — czyta status
`VendorInvoice` bezpośrednio (query, nie event) przy budowaniu paczki
płatniczej, patrz siostrzany dokument.

### Cross-module integration

- **GL (`ledger.postJournalEntry`) — twardy, zadeklarowany dependency,
  nie opcjonalny peer.** `packages/core/AGENTS.md` → Cross-Module
  Coupling opisuje `tryResolve` dla integracji **opcjonalnej**; GL nie
  jest tu opcjonalne (moduł AP bez GL nie ma sensu funkcjonalnego).
  AP woła `container.resolve('commandBus').execute('ledger.postJournalEntry', input, ctx)`
  — ten sam generyczny mechanizm, którego `workflows`'
  `UPDATE_ENTITY` już używa do wołania dowolnej komendy po stringowym
  `commandId`. Brak degradacji do zaprojektowania: jeśli `ledger` jest
  wyłączony, AP po prostu nie działa (podobnie jak GL bez `ledger`
  samo w sobie nie działa) — to jest oczekiwane, nie błąd do
  obsłużenia.
- **Contractor Registry — plain FK-id, bez integracji.** `vendorId`
  jest zwykłym FK-id (jak każde inne w tym repo); ten moduł nigdy nie
  resolves ani nie woła żadnego serwisu z `contractors`. Żywa
  weryfikacja Białej Listy (`contractorBankWhitelistCheck` przez
  `tryResolve`, fail-closed) żyje wyłącznie w
  `accounts_payable_payments` — patrz ten dokument.

### Backend Pages (`backend/accounts_payable/`)

- `invoices/page.tsx` — `DataTable` faktur (status, dostawca z
  `vendorSnapshot`, kwota, termin płatności).
- `invoices/create/page.tsx`, `invoices/[id]/page.tsx` — `CrudForm`
  z pozycjami faktury jako inline sub-listą; edytowalne tylko w
  `DRAFT`. Wstrzyknięty widget zadania akceptacji (analogiczny do
  `widgets/injection/order-approval/`) na spot ID
  `accounts_payable.vendor_invoice.detail:details`, widoczny gdy
  status to `PENDING_APPROVAL` i istnieje zadanie przypisane
  bieżącemu użytkownikowi.

## Data Models

### VendorInvoice

- `id`: uuid (PK)
- `tenant_id`, `organization_id`: uuid
- `vendor_id`: uuid (FK-id → `contractors.Contractor`, brak relacji ORM)
- `vendor_snapshot`: json, nullable
- `invoice_number`: text
- `invoice_date`, `due_date`: date
- `currency_id`: uuid (FK-id → `currencies.Currency`, brak relacji ORM)
- `status`: text (`DRAFT`/`PENDING_APPROVAL`/`APPROVED`/`REJECTED`/`POSTED`/`CANCELLED`)
- `goods_receipt_reference`: uuid, nullable (FK-id → `wms.InventoryMovement`)
- `total_net`, `total_tax`, `total_gross`: numeric(19,4)
- `posted_journal_entry_id`: uuid, nullable (FK-id → `ledger.JournalEntry`)
- `updated_at`: timestamptz, nullable (optymistyczna blokada, aktywna dopóki `status <> 'POSTED'`)
- `deleted_at`: timestamptz, nullable

Wspierający indeks dla list faktur (status, dostawca, termin
płatności — patrz API Contracts): `(tenant_id, organization_id,
status, due_date)`. Osobny indeks `(tenant_id, organization_id,
vendor_id)` dla filtra po dostawcy i dla `accounts_payable_payments`'s
zapytania "zatwierdzone, niezapłacone faktury tego dostawcy" (patrz
siostrzany dokument's Cross-module integration).

### VendorInvoiceLine

- `id`: uuid (PK)
- `vendor_invoice_id`: uuid (FK)
- `tenant_id`, `organization_id`: uuid (własne, nie tylko odziedziczone)
- `account_id`: uuid (FK-id → `ledger.LedgerAccount`, brak relacji ORM)
- `description`: text
- `net_amount`, `tax_rate`, `tax_amount`, `gross_amount`: numeric(19,4)

Wspierający indeks: `(vendor_invoice_id)` dla ładowania pozycji faktury.

### Module Config (`ModuleConfigService`, tenant scope)

Zamiast budować własny silnik mapowania konto-per-dostawca/kategoria
(odrzucone, patrz Alternatives considered), AP przechowuje dwie
tenant-owe wartości konfiguracyjne przez
`src/modules/configs/lib/module-config-service.ts`:

- `accounts_payable.liabilityAccountId` — `LedgerAccount.id` konta
  zobowiązań wobec dostawców (np. "202"), używane jako CR w
  `postVendorInvoice`. **Własność tego dokumentu, ale czytane też
  przez `accounts_payable_payments`** (jako DR w jego
  `markPaymentBatchSent`) — to jedyny zamierzony, udokumentowany punkt
  współdzielonej konfiguracji między dwoma dokumentami (patrz Design
  decisions, "Q1 resolved"). Ustawiane raz, w tym dokumencie's config
  UI.
- `accounts_payable.vatInputAccountId` — `LedgerAccount.id` konta VAT
  naliczonego (np. "223"), używane jako zagregowana DR w
  `postVendorInvoice` (patrz Design decisions, "VAT naliczony dostaje
  własne konto"). Używane wyłącznie w tym dokumencie.

## API Contracts

### `GET /api/accounts_payable/invoices` / `POST /api/accounts_payable/invoices`

Standard `makeCrudRoute`.

- **Query**: `page?`, `pageSize?` (≤100), `status?`, `vendorId?`,
  `dueDateFrom?`, `dueDateTo?`.
- **Create body**: `{ vendorId, invoiceNumber, invoiceDate, dueDate,
  currencyId, goodsReceiptReference?, lines: { accountId,
  description, netAmount, taxRate }[] }`. `status` defaults to
  `DRAFT`, not settable on create.
- **Response 200 (list)**: `{ items: VendorInvoiceDto[], total, page,
  pageSize }` where `VendorInvoiceDto` is `{ id, vendorId,
  vendorSnapshot, invoiceNumber, invoiceDate, dueDate, currencyId,
  status, totalNet, totalTax, totalGross, postedJournalEntryId,
  updatedAt }`.
- **Response 403**: caller lacks `accounts_payable.invoices.view`
  (list) / `.manage` (create).

### `PUT /api/accounts_payable/invoices/:id`

Standard `makeCrudRoute` update, blocked (409) unless `status ===
'DRAFT'`.

### `DELETE /api/accounts_payable/invoices/:id`

Standard `makeCrudRoute` soft-delete, enforced via its `beforeDelete`
hook (`packages/shared/src/lib/crud/factory.ts`, real precedent:
`api_keys/api/keys/route.ts`) — blocked (409) unless `status` is
`DRAFT`/`REJECTED`/`CANCELLED`.

### `POST /api/accounts_payable/invoices/:id/submit`

Custom write route wired through the mutation guard registry (mapped
to `update`), per `packages/core/AGENTS.md` → API Routes — nie jest
edycją pola, więc nie idzie przez `makeCrudRoute`.

- **Response 200**: `{ id, status: 'PENDING_APPROVAL' }`.
- **Response 409**: `status !== 'DRAFT'` albo brak pozycji.
- **Response 403**: caller lacks `accounts_payable.invoices.manage`.

### `POST /api/accounts_payable/invoices/:id/post`

Custom write route (mapped to `update`).

- **Response 200**: `{ id, status: 'POSTED', postedJournalEntryId }`.
- **Response 409**: `status !== 'APPROVED'`.
- **Response 422 `FISCAL_PERIOD_LOCKED`**: `{ code:
  'FISCAL_PERIOD_LOCKED', periodStart, periodEnd }` — okres
  pokrywający `invoiceDate` jest zablokowany; faktura zostaje w
  `APPROVED`. **Uwaga koordynacyjna**: GL's własny spec
  (`2026-08-18-general-ledger-core-engine.md`) opisuje, że
  `postJournalEntry` odrzuca zablokowany okres, ale nie definiuje
  żadnego typowanego kodu błędu dla tego odrzucenia — `code:
  'FISCAL_PERIOD_LOCKED'` jest **propozycją tego dokumentu**, nie
  potwierdzonym kontraktem GL. Wymaga uzgodnienia z GL's implementacją
  (albo GL doda dyskryminator błędu, albo `postVendorInvoice` będzie
  musiał rozpoznawać odrzucenie po treści/klasie wyjątku — do
  ustalenia przy implementacji, nie rozstrzygnięte tym spec-em samym
  w sobie).
- **Response 403**: caller lacks `accounts_payable.invoices.post`.

## Migration & Deployment

Nowe, addytywne tabele: `accounts_payable_vendor_invoices`,
`accounts_payable_vendor_invoice_lines` — zero zmian w istniejących
tabelach innych modułów (GL, Contractor Registry). `onTenantCreated`
w `setup.ts` zapisuje puste wartości domyślne dla
`accounts_payable.liabilityAccountId`/`vatInputAccountId` (rekord w
`module_configs` z `tenant_id` ustawionym) — nie może wybrać
sensownej wartości automatycznie (zależy od faktycznego planu kont
tenant-a, tworzonego ręcznie przez `ledger.createLedgerAccount`), więc
`postVendorInvoice` odrzuca wywołanie czytelnym błędem
konfiguracyjnym dopóki księgowy nie ustawi obu wartości przez ekran
konfiguracji modułu. **`accounts_payable_payments`'s wdrożenie zależy
od `liabilityAccountId` będącego już ustawionym tutaj** — kolejność
wdrożenia: ten moduł najpierw, siostrzany moduł potem.

## Implementation Plan

### Phase 1: Faktury, akceptacja, księgowanie

1. `index.ts` (`metadata.requires: ['ledger']`) + encje + migracja
   (dwie tabele powyżej) + indeksy z Data Models +
   `encryption.ts` (`vendor_snapshot`).
2. `acl.ts` + `setup.ts` (role, `defaultRoleFeatures`).
3. `createVendorInvoice` / `updateVendorInvoice`.
4. `submitVendorInvoiceForApproval` + `events.ts` (deklaracja
   `accounts_payable.vendor_invoice.submitted` i pozostałych).
5. `workflows.ts` (definicja `accounts_payable.invoice-approval`,
   `registerWorkflowSafeCommands` na `applyVendorInvoiceApprovalDecision`)
   + `applyVendorInvoiceApprovalDecision` + wstrzyknięty widget
   akceptacji na `backend/accounts_payable/invoices/[id]/page.tsx`.
6. `postVendorInvoice` (wywołanie `commandBus` → `ledger.postJournalEntry`
   z trzema nogami — netto/VAT/zobowiązania, patrz Commands — obsługa
   `FISCAL_PERIOD_LOCKED`).
7. API routes + `api/openapi.ts` (w tym `DELETE`).
8. Backend pages (invoices list/create/edit).
9. Moduł config UI (ustawienie `liabilityAccountId`/`vatInputAccountId`).
10. Unit + integration test coverage (patrz Testing Strategy).

### Phase 2 (deferred)

- Purchase Order / three-way matching (`matchToOrder`), gdy powstanie
  finansowe księgowanie PZ w WMS.
- Wielostopniowy, progowy obieg akceptacji (kwotowe progi,
  wieloosobowe ścieżki).
- Automatyczne mapowanie konto-per-dostawca/kategoria — dopiero gdy
  Posting Rules Engine (konto 490) będzie gotowy, żeby nie dublować
  tego samego mechanizmu dwa razy.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `index.ts` | Create | `metadata.requires: ['ledger']` — hard dependency |
| `data/entities.ts` | Create | `VendorInvoice`, `VendorInvoiceLine` |
| `acl.ts` | Create | Trzy funkcjonalności (view/manage/post) |
| `setup.ts` | Create | `defaultRoleFeatures`; `onTenantCreated` zapisujący puste `module_configs` wartości |
| `encryption.ts` | Create | `vendor_snapshot` (mirror `sales`'s `customer_snapshot`) |
| `events.ts` | Create | Pięć zdarzeń (patrz Events) |
| `workflows.ts` | Create | Definicja `accounts_payable.invoice-approval`, `registerWorkflowSafeCommands` na `applyVendorInvoiceApprovalDecision` |
| `commands/vendorInvoices.ts` | Create | `createVendorInvoice`, `updateVendorInvoice`, `submitVendorInvoiceForApproval`, `applyVendorInvoiceApprovalDecision`, `postVendorInvoice`, `cancelVendorInvoice` |
| `widgets/injection/invoice-approval/` | Create | Widget zadania akceptacji, mirror `sales`'s `order-approval` |
| `api/openapi.ts` | Create | `openApi` exports dla wszystkich tras `accounts_payable` |
| `api/invoices/route.ts` | Create | `VendorInvoice` CRUD (`makeCrudRoute`), w tym `beforeDelete`-guarded `DELETE` |
| `api/invoices/[id]/submit/route.ts`, `.../post/route.ts` | Create | Custom guarded write routes |
| `backend/accounts_payable/invoices/page.tsx` (+ create/[id]) | Create | Vendor invoice list/create/edit UI |
| `backend/config/accounts_payable/page.tsx` | Create | `liabilityAccountId`/`vatInputAccountId` config UI |
| `commands/__tests__/*` | Create | Regression coverage for all commands above |
| `__integration__/*` | Create | Integration coverage: full submit→approve→post flow; `FISCAL_PERIOD_LOCKED` path; VAT posting balance |

## Testing Strategy

- Utworzyć fakturę roboczą, edytować, przesłać do akceptacji;
  zaakceptować przez `POST /api/workflows/tasks/:id/complete`; assert
  status `APPROVED` i zdarzenie `accounts_payable.vendor_invoice.approved`
  wyemitowane.
- To samo dla odrzucenia — assert `REJECTED`, faktura nie może być
  zaksięgowana ani ponownie przesłana bez powrotu do `DRAFT`.
- Zaksięgować zatwierdzoną fakturę; assert zbalansowany
  `JournalEntry` z poprawnym `referenceType`/`referenceId`, drugie
  wywołanie `postVendorInvoice` na tej samej fakturze jest no-opem
  (idempotency guard).
- Zaksięgować fakturę z `invoiceDate` w zablokowanym okresie; assert
  odpowiedź `422 FISCAL_PERIOD_LOCKED`, faktura zostaje `APPROVED`.
- Regression test dla konta 300: zaksięgować dwie faktury z liniami na
  konto 300; assert, że `JournalEntry` per faktura jest zbalansowany
  *wewnętrznie* (to sprawdza tylko poprawność pojedynczego zapisu — nie
  jest testem na "saldo konta 300 się zeruje", bo z założenia się nie
  zeruje w Fazie 1, patrz Design decisions i Risks).
- Regression test dla VAT: zaksięgować fakturę z dwiema pozycjami o
  różnych `taxRate`; assert, że `JournalEntry` ma osobną linię DR na
  `vatInputAccountId` równą sumie `taxAmount` obu pozycji, że linie na
  `accountId` per pozycja niosą **netto** (nie brutto), i że CR na
  `liabilityAccountId` równa się `totalGross`.

## Risks & Impact Review

### Data integrity failures

#### Podwójne zaksięgowanie tej samej faktury
- **Scenario**: `postVendorInvoice` wywołane dwa razy dla tej samej
  faktury (np. retry po timeout-cie sieci), zanim pierwsze wywołanie
  zdąży ustawić `postedJournalEntryId`.
- **Severity**: High
- **Affected area**: `accounts_payable`, `ledger` (podwójny,
  niezbalansowany wpis na koncie zobowiązań)
- **Mitigation**: `postedJournalEntryId` sprawdzane i ustawiane w
  jednej transakcji z wywołaniem `commandBus`
  (`withAtomicFlush`/transaction wrapping); druga, równoległa próba na
  tej samej fakturze musi zobaczyć już ustawiony
  `postedJournalEntryId` i zwrócić no-op zamiast wołać
  `postJournalEntry` ponownie.
- **Residual risk**: teoretyczne wyścigowe okno między odczytem a
  zapisem `postedJournalEntryId` przy dwóch równoczesnych requestach —
  wymaga unique constraint albo select-for-update na
  `VendorInvoice.id` wewnątrz komendy; do potwierdzenia przy
  implementacji (nie rozwiązane samym projektem danych).

#### Konto 300 nigdy się nie zeruje w Fazie 1
- **Scenario**: Każda faktura zaksięgowana z linią na konto 300
  zwiększa jego saldo DR; nic nigdy go nie uznaje (brak księgowania
  PZ finansowo). Po miesiącach działania konto 300 pokazuje duże,
  narastające saldo, które może zostać błędnie odczytane jako błąd
  księgowy przez kogoś, kto nie zna tego design decision.
- **Severity**: Medium
- **Affected area**: `ledger` (czytelność bilansu), księgowość
- **Mitigation**: udokumentowane wprost w Design decisions i w tym
  ryzyku (nie ukryte). GL's własny spec jawnie wycina
  `getAccountBalance`/`GET /api/ledger/accounts/:id/balance` z Fazy 1
  (stakeholder-directed scope reduction). Do czasu, aż GL doda tę
  trasę, jedyna dostępna mitigacja to ręczny raport SQL na
  `journal_entry_line` (poza produktem, wymaga dostępu do bazy) albo
  ręczna korekta/reklasyfikacja gdy WMS zacznie księgować PZ
  finansowo. To jest realna, nie tylko kosmetyczna, dodatkowa
  zależność międzyspecowa — GL dodając balance route zamyka tę lukę
  mitigacji taniej niż cokolwiek AP mogłoby zrobić samo.
- **Residual risk**: do czasu WMS-owego księgowania PZ finansowo,
  saldo konta 300 jest z definicji nieprawidłowe księgowo
  (jednostronne) — zaakceptowane świadomie jako koszt fazowania, nie
  do wyeliminowania bez budowania PZ wcześniej niż zaplanowano.
  Dodatkowo, do czasu GL's balance route, nawet wykrycie tego stanu
  wymaga ręcznego zapytania do bazy, nie ekranu w produkcie.

#### Brak kontroli maker-checker (samo-akceptacji faktury)
- **Scenario**: ta sama osoba, mająca `accounts_payable.invoices.manage`,
  tworzy fakturę, przesyła ją do akceptacji, i — jeśli ma też dostęp do
  panelu zadań workflow-u (`workflows.tasks.complete`) — kończy własne
  zadanie akceptacji, zatwierdzając własną fakturę bez drugiej osoby w
  pętli.
- **Severity**: Medium (kontrola finansowa, nie utrata danych)
- **Affected area**: `accounts_payable.invoices.*`, obieg akceptacji
- **Mitigation**: żadna w Fazie 1 na poziomie tego modułu — ten sam
  brak istnieje już w mirrorowanym `sales.order-approval`. Praktyczna
  mitigacja dziś: nie przyznawać `workflows.tasks.complete` tej samej
  roli co `accounts_payable.invoices.manage` na poziomie konfiguracji
  ról tenant-a (możliwe już dziś przez RBAC, nie wymaga zmian w tym
  module) — ale to decyzja operacyjna każdego tenant-a, nie
  wymuszenie na poziomie kodu.
- **Residual risk**: bez wymuszenia na poziomie kodu (np. "assignee
  różny od twórcy faktury"), nic nie chroni przed samo-akceptacją,
  jeśli administrator tenant-a przyzna oba uprawnienia tej samej roli.
  Świadomie zaakceptowane jako luka Fazy 1 (spójna z precedensem, nie
  gorsza od niego), do rozważenia w Fazie 2 razem z wielostopniowym
  obiegiem akceptacji.

### Cascading failures & side effects

#### `ledger.postJournalEntry` niedostępne (moduł `ledger` wyłączony)
- **Scenario**: `commandBus.execute('ledger.postJournalEntry', ...)`
  rzuca, bo `ledger` nie jest zarejestrowany.
- **Severity**: Critical
- **Affected area**: cały moduł `accounts_payable` — nie może
  księgować niczego.
- **Mitigation**: brak degradacji do zaprojektowania — to twardy
  dependency (patrz Cross-module integration), nie opcjonalny peer.
  `accounts_payable` deklaruje `ledger` jako wymagany moduł przez
  `index.ts`'s `metadata.requires`.
- **Residual risk**: brak — to oczekiwane zachowanie dla brakującego
  twardego dependency, analogiczne do tego, że GL samo w sobie nie
  działa bez bazy danych.

#### Zdarzenie `accounts_payable.vendor_invoice.submitted` nie trafia do workflow-u
- **Scenario**: worker zdarzeń persistentnych jest offline w
  momencie `submitVendorInvoiceForApproval`; zdarzenie czeka w
  kolejce.
- **Severity**: Medium
- **Affected area**: obieg akceptacji (opóźniony, nie utracony)
- **Mitigation**: kolejka trwała (`@open-mercato/queue`) doręcza
  zdarzenie, gdy worker wróci — brak utraty danych, tylko opóźnienie.
  Faktura widoczna w UI jako `PENDING_APPROVAL` przez cały ten czas
  (stan trwały w bazie, niezależny od stanu workflow-u).
- **Residual risk**: brak — to jest dokładnie zachowanie, do którego
  `packages/events/AGENTS.md` projektuje kolejkę trwałą.

### Tenant & data isolation

Obie encje mają własne `tenant_id`/`organization_id`
(`VendorInvoiceLine` ma własne kolumny zakresu, nie tylko odziedziczone
przez FK, mirror `ContractorBankAccount`). `ModuleConfigService` z
jawnym `tenantId` w scope gwarantuje, że konto zobowiązań jednego
tenant-a nigdy nie przecieka jako fallback do innego (patrz
`packages/core/AGENTS.md` → Module Config — scoped write nigdy nie
dotyka wiersza globalnego).

### Migration & deployment

Patrz Migration & Deployment section powyżej — dwie nowe, addytywne
tabele, zero zmian w istniejących. `onTenantCreated` idempotentny
(może być uruchomiony wielokrotnie bez duplikowania wierszy
`module_configs` — `ModuleConfigService`'s partial unique indexes to
gwarantują).

## Out of scope (tracked separately)

- Grupowanie faktur w paczki płatnicze, wykonanie przelewu, weryfikacja
  Białej Listy — patrz `2026-09-06-accounts-payable-payments.md`.
- Purchase Order / three-way matching — Faza 2, czeka na finansowe
  księgowanie PZ w WMS.
- Wielostopniowy, progowy obieg akceptacji — Faza 2.
- Automatyczne mapowanie konto-per-dostawca/kategoria — czeka na
  Posting Rules Engine (konto 490), żeby nie dublować mechanizmu.

## Final Compliance Report — 2026-09-08

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/core/src/modules/workflows/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `vendorId`, `currencyId`, `accountId`, `goodsReceiptReference` all FK-id only |
| root AGENTS.md | Filter by organization_id | Compliant | Both entities tenant/org scoped; `VendorInvoiceLine` carries own scope columns |
| `packages/core/AGENTS.md` → API Routes | All API route files MUST export `openApi` | Compliant | `api/openapi.ts` covers every route, per File Manifest |
| `packages/core/AGENTS.md` → API Routes | Custom write routes wire the mutation guard registry | Compliant | `submit`/`post` routes mapped to `update` operation |
| `packages/core/AGENTS.md` → Cross-Module Coupling | Hard dependency uses direct resolution, not `tryResolve` | Compliant | `ledger.postJournalEntry` via direct `commandBus.execute` — verified against `packages/core/src/modules/workflows/lib/activity-executor.ts` and real cross-module command calls elsewhere in the repo that need no allowlist |
| `packages/core/AGENTS.md` → Cross-Module Coupling (hard dependency mechanism) | Hard dependency declared through `ModuleInfo.requires` | Compliant | `index.ts` with `metadata.requires: ['ledger']`, matching `sales`/`wms`'s real usage |
| `packages/core/AGENTS.md` → Database Entities | User-editable entities MUST include `updated_at` | Compliant | `VendorInvoice` has `updatedAt`; `VendorInvoiceLine` is a sub-resource guarded by its parent aggregate (exempt, per the same rule's own exemption list) |
| `packages/core/AGENTS.md` → Database Entities | Standard column contract includes `deleted_at` | Compliant | `VendorInvoice` has `deletedAt`; status guard enforced at both the command layer (`cancelVendorInvoice`) and the route layer (`DELETE`'s `beforeDelete` hook) |
| `packages/core/AGENTS.md` → Encryption | GDPR/PII fields declared in `<module>/encryption.ts`, read via `findWithDecryption` | Compliant | `encryption.ts` declares `vendor_snapshot`, mirroring `sales`'s already-encrypted `customer_snapshot` |
| `packages/core/AGENTS.md` → Access Control (RBAC) | Features declared per module, naming `<module>.<action>` | Compliant | Three features (`view`/`manage`/`post`) |
| `packages/events/AGENTS.md` | Events declared with `as const`; subscribers export `metadata` | Compliant | Five events declared; no persistent subscriber needed in Phase 1 |
| `packages/queue/AGENTS.md` | Workers idempotent, export `metadata` | N/A | This module ships no queue worker in Phase 1 — no background job crosses a request boundary |
| `packages/core/src/modules/workflows/AGENTS.md` | Event triggers for cross-module workflow starts; `registerWorkflowSafeCommands` gates `UPDATE_ENTITY` | Compliant | `accounts_payable.invoice-approval` triggers on `accounts_payable.vendor_invoice.submitted`, mirroring `sales.order-approval`'s `sales.order.created` trigger; the registered command is a dedicated `applyVendorInvoiceApprovalDecision`, not the general-purpose `update` |
| `BACKWARD_COMPATIBILITY.md` | Database schema additive-only | Compliant | Two new tables only, zero changes to existing modules' schemas |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match architecture | Pass | Entities in Architecture and Data Models agree |
| API contracts match data models | Pass | Every documented field/filter has a backing column |
| Commands defined for all mutations | Pass | Every status transition has a named command |
| Double-entry postings balance | Pass | `postVendorInvoice` posts three legs — DR net per line, aggregated DR to `vatInputAccountId`, CR `totalGross` to the liability account |
| Risks cover all write operations | Pass | Double-posting, konto 300, ledger-unavailable, event-queue delay, maker-checker, tenant isolation, migration all addressed |
| Scope cohesion vs. other modules | Pass | Single capability (vendor invoice lifecycle), independently deployable given its one hard dependency (`ledger`) — payments split out per Q1 resolution below |
| Scope cohesion *within* this document | Pass | One entity group, one lifecycle, one GL integration seam — the prior bundling of payments (a second, separate GL integration seam and ACL group) was resolved by the split recorded in Design decisions |
| Cross-module coupling mechanism matches dependency type | Pass | Hard dependency (`ledger`) via `commandBus` + `ModuleInfo.requires`; plain FK-id reference to `Contractor` (no coupling mechanism needed, no service resolved) |

### Non-Compliant Items

None.

### Verdict

**Ready for maintainer review.** Every AGENTS.md rule checked is
compliant. This document is the narrower half of what was originally
a single combined Accounts Payable specification — two independent,
fresh-context reviews (compliance/checklist + architectural sanity)
found the combined document's own scope-cohesion self-assessment
unreliable (it cited a misrepresented GL precedent) and recommended a
split; the team confirmed the split on 2026-09-08. This document
carries forward, unchanged, every fix from that combined document's
own independent-review round that applies to the invoice half
(encryption gap, workflow/command contradiction, VAT posting gap,
corrected goods-receipt claim, undesigned hard dependency) — see
Changelog for the full history. The payments half, its own risks, and
its own compliance report now live in
`2026-09-06-accounts-payable-payments.md`.

## Changelog

### 2026-09-06

- Initial specification (Design Decisions only, from event-storming
  wall).

### 2026-09-07

- Full expansion from skeleton to complete `om-spec-writing` template
  (at this point still combined with payments in one document).
  Research pass against the real repo (not the pre-workshop SPEC-024
  brief) before writing: confirmed no `PurchaseOrder`/`GoodsReceipt`/
  `PaymentOrder` entity exists anywhere; confirmed GL's
  `JournalEntry`/`JournalEntryLine` have no `deletedAt` (append-only,
  direct precedent for this module's own posted-invoice immutability);
  confirmed the generic `commandBus` mechanism (used by `workflows`'
  `UPDATE_ENTITY`) as the correct way to call `ledger.postJournalEntry`,
  distinct from Contractor Registry's narrower `tryResolve`/DI-token
  pattern.
- Verified two significant claims against real code before committing
  them to this document (both flagged to the user as open questions,
  not silently decided): the vendor-invoice approval mechanism (workflow
  engine, not `useGuardedMutation` — confirmed via
  `sales/workflows.ts` and the task-completion API; the same fix was
  applied back to Contractor Registry's PR #5955, which had cited the
  wrong precedent) and konto 300's one-sidedness (no goods-receipt
  posting exists anywhere to pair with it — user decided to keep it in
  Phase 1 anyway, documented as a known transitional gap rather than
  silently designed around).
- Added a new, previously-undecided design decision:
  `goodsReceiptReference` is a FK-id to `wms.InventoryMovement` (later
  corrected the same day — see below — from an initial, wrong
  assumption that no such entity exists).
- Added a new, previously-undecided design decision: automatic
  vendor/category-to-account mapping is out of scope for Phase 1
  (would duplicate the future Posting Rules Engine); Phase 1 uses
  manual per-line account selection plus tenant-scoped
  `ModuleConfigService` values.

### 2026-09-07 (cont. — independent review round, while still combined with payments)

Two fresh-context reviews (compliance/checklist + architectural
sanity) were run against the full expansion above, per the same
protocol used for GL and Contractor Registry. Findings verified
against the real repo before acting on them; fixes applied in this
same round (only the ones affecting the invoice half are listed here
— the payments-half fixes from this same round are recorded in
`2026-09-06-accounts-payable-payments.md`'s own Changelog):

- **Encryption gap (fixed)**: no `encryption.ts` existed for
  `vendorSnapshot` (vendor name/NIP), structurally identical to
  `sales`'s already-encrypted `customer_snapshot`. Added
  `encryption.ts`.
- **Workflow/command contradiction (fixed)**: the approval workflow's
  `UPDATE_ENTITY` step called `accounts_payable.vendor_invoices.update`
  — the same command defined elsewhere in this document as
  `DRAFT`-only, which the workflow's own `PENDING_APPROVAL` transition
  would then contradict. Replaced with a dedicated, narrow
  `applyVendorInvoiceApprovalDecision` command, registered separately
  in `registerWorkflowSafeCommands`, that only moves `PENDING_APPROVAL`
  → `APPROVED`/`REJECTED`. Noted as a deliberate departure from
  `sales.order-approval`'s own pattern (which reuses its general
  `.update` command and carries the same latent risk, unaddressed
  there).
- **VAT posting gap (fixed)**: traced the double-entry math by hand —
  as originally written, `postVendorInvoice` had no dedicated VAT leg,
  which would have silently absorbed VAT into cost/300 accounts and
  never recorded the VAT-recoverable receivable. Added a third posting
  leg (aggregated DR to a new `vatInputAccountId` module-config value)
  and corrected the per-line DR to net (not gross) amounts.
- **False "no goods-receipt entity" claim (corrected)**: independent
  review found `wms.InventoryMovement` (`type: 'receipt'`) is a real,
  working entity — only its *financial* posting doesn't exist (no
  amount/account fields, never calls `postJournalEntry`). Corrected
  `goodsReceiptReference` from free text to a real FK-id; the konto
  300 one-sided-gap analysis itself needed no change, since it never
  depended on the receipt entity not existing, only on nothing
  posting money against it.
- **Undesigned hard dependency (fixed)**: Risks asserted AP declares
  `ledger` as a required module "at the app registration level" but
  never designed it. Found the real mechanism (`ModuleInfo.requires`,
  already used by `sales`/`wms`) and added `index.ts` to Architecture
  and File Manifest.
- **Unrealistic risk mitigation (corrected)**: the konto-300 risk's
  mitigation assumed an account-balance UI that GL's own spec
  explicitly cuts from Phase 1 (`getAccountBalance`). Reworded to
  state the real, more limited mitigation (manual SQL report) and
  flagged the GL balance route as a cross-spec dependency worth
  closing.
- **Maker-checker gap (recorded, not fixed)**: neither this document
  nor the `sales.order-approval` precedent it mirrors prevents an
  invoice's creator from also completing their own approval task.
  Recorded as a new Risk entry rather than silently accepted; no
  code-level fix designed for Phase 1.
- **`FISCAL_PERIOD_LOCKED` contract (flagged, not resolved)**: GL's
  own spec rejects a locked-period posting but defines no typed error
  code for it — this document's `FISCAL_PERIOD_LOCKED` is a proposal,
  not a confirmed contract. Flagged inline in API Contracts as a
  cross-spec coordination item.
- **Dangling cross-reference (softened)**: the `sales-invoice-gl-posting.md`
  citation in the Related header pointed at a document that doesn't
  exist yet anywhere (not even on GL's own branch) — reworded to match
  how Contractor Registry's Related header already handles the same
  citation ("the future ...", not presented as an existing sibling).
- **Scope-cohesion SPLIT (escalated, then resolved 2026-09-08 — see
  below)**: both reviews independently leaned SPLIT for invoices vs.
  payments, and one of them found this document's own justification
  (an analogy to how GL kept `FiscalPeriod` bundled) misrepresented
  that precedent — GL's own check also returned SPLIT and was only
  kept bundled by an explicit stakeholder override. Recorded as **Q1**
  pending resolution, per `spec-checklist.md`'s escalation protocol.

### 2026-09-08 — Q1 resolved: split into two documents

- Resolved Q1: split the combined `accounts_payable` document into
  this document (`accounts_payable` — vendor invoice lifecycle only)
  and a new sibling, `2026-09-06-accounts-payable-payments.md`
  (`accounts_payable_payments` — payment batches, Biała Lista
  verification, payment posting). Removed `PaymentBatch`/
  `PaymentBatchLine` entities, `payments.*` ACL features,
  `createPaymentBatch`/`updatePaymentBatch`/`confirmPaymentBatch`/
  `markPaymentBatchSent`/`cancelPaymentBatch` commands,
  `payment_batch.*` events, the `contractorBankWhitelistCheck`
  `tryResolve` integration, and `defaultCashAccountId` — all moved to
  the sibling document verbatim (with its own Changelog crediting the
  same independent-review round). Kept `accounts_payable.liabilityAccountId`
  in this document as the intentionally shared config value the
  sibling document reads (documented explicitly in both, to avoid
  drift). Corrected the `goods_receipt_reference` column type in Data
  Models from `text` to `uuid` — a leftover inconsistency from the
  2026-09-07 goods-receipt correction that had updated the Entities
  prose and API contract but not the Data Models schema table itself.
  Removed the temporary Open Questions section; Internal Consistency
  Check and Verdict rewritten to be unconditional again.
