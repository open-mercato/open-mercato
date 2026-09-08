# Accounts Payable — płatności

**Related:** [Accounts Payable — faktury](2026-09-06-accounts-payable.md)
(siostrzany dokument — cykl życia faktury zakupowej; ten dokument ma
na niego twardy, zadeklarowany dependency, patrz Architecture →
Module Dependency; wydzielony z niego 2026-09-08, patrz Changelog),
[General Ledger core engine](2026-08-18-general-ledger-core-engine.md)
(posting engine ten spec księguje do), [Contractor
Registry](2026-09-06-contractor-registry.md) (rejestr dostawcy i
weryfikacja Białej Listy — ten spec ją konsumuje jako opcjonalny
peer, nie duplikuje)

## TLDR

Moduł obsługujący grupowanie zatwierdzonych, zaksięgowanych faktur
zakupowych w paczki płatnicze i księgowanie ich wysyłki. Twardy,
zadeklarowany dependency na `accounts_payable` (czyta status i sumy
faktur) i na `ledger` (księguje wysyłkę paczki). Weryfikuje Białą
Listę/MPP przed potwierdzeniem paczki — opcjonalny peer,
`contractors`, z polityką fail-closed. Nie wykonuje realnego
przelewu — to jest Faza 2 (patrz Out of scope).

## Overview

Na ścianie proces AP to cztery równoległe ścieżki: (A) rejestracja i
weryfikacja kontrahenta (GUS/VIES/Biała Lista — wyciągnięte do
`Contractor Registry`), (B) zakup materiałów (PZ → faktura →
zaksięgowano — wyciągnięte do `2026-09-06-accounts-payable.md`), (C)
zakup środka trwałego (OT, tabela amortyzacyjna — wyciągnięte do
osobnego spec-a Fixed Assets, patrz
`.ai/specs/2026-09-06-fixed-assets.md`), (D) płatności wychodzące
(grupowanie zatwierdzonych faktur w paczki płatnicze, wysyłka).
**Ten dokument obejmuje wyłącznie D** — A, B i C są świadomie
wyciągnięte (własne, niezależne funkcjonalności; D samo było do
2026-09-08 częścią tego samego dokumentu co B, patrz Changelog).

> **Market Reference**: SPEC-024 (przedwarsztatowy brief, sekcja
> "Cash Management Module") nie definiuje żadnego typu w stylu
> `PaymentOrder`/`PaymentInstruction` — tylko `BankTransaction` z
> polem `matchedEntryId: Option<EntryId>`, co pokazuje logikę
> **rekoncyliacji** (dopasowanie zaimportowanej pozycji z wyciągu do
> już istniejącego zapisu), nie logikę **inicjowania** płatności.
> Ściana (zweryfikowane źródło) rozstrzyga to na korzyść podziału:
> ten moduł inicjuje i księguje wysyłkę paczki płatniczej; przyszły
> Bank Management (SPEC-024) tylko importuje wyciąg i dopasowuje go
> wstecz do tego, co ten moduł już wykonał — patrz Design decisions.

## Problem Statement

Dziś nie ma żadnego modułu odpowiadającego za stronę płatniczą —
zatwierdzone, zaksięgowane faktury zakupowe (`2026-09-06-accounts-payable.md`)
nie mają żadnego mechanizmu grupowania w paczki płatnicze ani
księgowania wysyłki. Potwierdzone bezpośrednio w repo: nie istnieje
żadna encja `PaymentBatch`/`PaymentOrder`/`PaymentInstruction`
nigdzie w kodzie, a moduł `contractors` (Contractor Registry) ma
`ContractorBankAccount` z numerem rachunku (zaszyfrowanym) i
weryfikacją Białej Listy jako część rejestru kontrahenta, ale żadnej
logiki grupowania faktur w płatności.

**Ten dokument pierwotnie był częścią jednego modułu `accounts_payable`**
razem z fakturami (`VendorInvoice`/`VendorInvoiceLine`). Dwa
niezależne, świeży-kontekst review (compliance/checklist +
architektoniczny) doszły niezależnie do werdyktu SPLIT: osobne grupy
ACL, osobne wywołania `postJournalEntry` do GL, sprzężenie tylko przez
FK (jak do w pełni osobnego modułu Contractor Registry), osobna
domena ryzyka prawnego (Biała Lista/MPP dotyczy tylko płatności, nie
przyjęcia faktury). Zespół potwierdził podział 2026-09-08 — patrz
Design decisions i Changelog.

## Proposed Solution

Nowy, niezależny moduł `accounts_payable_payments` z jedną grupą
encji: **paczki płatnicze** (`PaymentBatch`/`PaymentBatchLine`,
grupowanie zatwierdzonych, zaksięgowanych faktur z
`accounts_payable` w paczki, potwierdzenie z weryfikacją Białej
Listy, wysyłka z księgowaniem). Moduł nie księguje bezpośrednio do
bazy — przejście w stan `SENT` wywołuje `postJournalEntry` z GL przez
generyczny `commandBus`, tak samo jak robi to `accounts_payable`
samo (patrz Architecture → Cross-module integration). Ma twardy,
zadeklarowany dependency na dwa moduły: `ledger` (księgowanie) i
`accounts_payable` (czyta status faktury i skonfigurowane konto
zobowiązań) — w odróżnieniu od `contractors`, który pozostaje
opcjonalnym peerem z polityką fail-closed.

### Design decisions (2026-09-07 — resolved na warsztacie)

**Płatności: ten moduł tworzy propozycję i wykonuje przelew; Bank
Management robi import wyciągu i rekoncyliację.** Potwierdzone
bezpośrednio w kodzie źródłowym SPEC-024 (`grep` na
`.ai/specs/SPEC-024-...md`, sekcja "Cash Management Module"):

```typescript
type BankTransaction = {
  id: TransactionId
  bankAccountId: BankAccountId
  transactionDate: LocalDate
  valueDate: LocalDate
  amount: Money
  reference: string
  matchedEntryId: Option<EntryId>
}
```

Pole `matchedEntryId: Option<EntryId>` pokazuje, że Cash Management
**dopasowuje** transakcję bankową do już istniejącego zapisu — to jest
logika rekoncyliacji (importowana pozycja z wyciągu ↔ coś, co już
zaksięgowano), nie logika **inicjowania** płatności. SPEC-024 nie
definiuje żadnego typu w stylu `PaymentOrder`/`PaymentInstruction`
w module Cash Management. Rozstrzyga to pytanie otwarte z review
(czy płatności zostają w AP, czy przechodzą do Bank Management) na
korzyść obecnego podziału: ten moduł inicjuje i wykonuje przelew
(grupowanie faktur w paczki płatnicze — to wymaga bliskiego związku
z zatwierdzonymi fakturami), Bank Management tylko importuje wyciąg
i dopasowuje go wstecz do tego, co ten moduł już wykonał.

**Weryfikacja Białej Listy i split payment (MPP) to twardy blocker
Fazy 1, nie ostrzeżenie.** Realne ryzyko prawne (odpowiedzialność
solidarna VAT, próg 15 000 zł, załącznik nr 15 ustawy o VAT) — patrz
pełne uzasadnienie prawne w `2026-09-06-contractor-registry.md`.

**Rzeczywista integracja bankowa (wywołanie API banku / plik
przelewów) — Faza 2.** Brak jakiegokolwiek precedensu w repo —
SPEC-024's Cash Management nie definiuje żadnego typu
`PaymentOrder`/`PaymentInstruction`/`PaymentBatch`. Faza 1 kończy się
na stworzeniu i zaksięgowaniu paczki płatniczej; samo wykonanie
przelewu (plik do banku, API) to Faza 2 — patrz Out of scope.

**Płatności częściowe — Faza 2.** Faza 1: `PaymentBatchLine.amount`
zawsze równa się pełnej pozostałej kwocie faktury; brak wsparcia dla
częściowego rozliczenia jednej faktury wieloma płatnościami.

### Design decisions (2026-09-07 — dodane podczas pełnego rozwijania spec-a, wtedy jeszcze połączone z fakturami)

**`confirmPaymentBatch` woła `contractorBankWhitelistCheck` z
modułu `contractors` przez lokalny `tryResolve`, fail-closed —
inna polityka niż w Contractor Registry, ten sam mechanizm.**
`contractors` **jest** opcjonalnym peerem tutaj (w odróżnieniu od
`ledger`/`accounts_payable`, oba twarde dependency). Różnica
względem Contractor Registry: tam brak modułu degraduje tylko UI
(przycisk "verify now" przestaje działać, fail-open — bezpieczne,
bo to wygoda UX, nie blocker prawny); tutaj brak modułu **blokuje
potwierdzenie całej paczki** (fail-closed), bo chodzi o twardy
blocker prawny (Biała Lista/MPP), nie wygodę. Ten sam mechanizm
(`tryResolve`), inna polityka biznesowa przy braku wyniku — moduł
nigdy nie traktuje brakującego wyniku jako "zakładam WHITELISTED".

**`PaymentBatchLine.whitelistCheckResult` nie duplikuje numeru
rachunku bankowego.** Numer rachunku jest już zaszyfrowany na
`ContractorBankAccount.accountNumber` (`contractors/encryption.ts`);
duplikowanie go tu w niezaszyfrowanej formie byłoby drugą,
niekontrolowaną kopią danych już objętych szyfrowaniem. Zapisywany
jest wyłącznie wynik weryfikacji (`status`, `checkedAt`, `requestId`)
— to jest **dowód zgodności**, nie cache UX jak
`ContractorBankAccount.lastVerifiedAt` (nigdy nie czytany zamiast
ponownego wywołania przy kolejnej paczce). Skutek dla tego dokumentu:
nie potrzeba własnego `encryption.ts` — patrz Architecture →
Encryption.

### Design decisions (2026-09-08 — Q1 resolved: podział na dwa moduły)

**Rozdzielono na `accounts_payable` (siostrzany dokument — faktury) i
`accounts_payable_payments` (ten dokument — płatności).** Dwa
niezależne, świeży-kontekst review doszły niezależnie do werdyktu
SPLIT: osobne grupy ACL (`invoices.*` vs `payments.*`), osobne
wywołania `postJournalEntry` do GL (dwa różne zapisy księgowe, dwa
różne momenty), sprzężenie tylko przez FK
(`PaymentBatchLine.vendorInvoiceId` — ten sam kształt co odwołanie
do w pełni osobnego modułu Contractor Registry), osobna domena
ryzyka prawnego (Biała Lista/MPP dotyczy tylko tego dokumentu, nie
przyjęcia faktury). Kontrargument za COHESIVE (współdzielone konto
zobowiązań, żywy dostęp do zatwierdzonych faktur przy budowaniu
paczki) był realny, ale nie przeważył — patrz siostrzany dokument's
Design decisions dla pełnego uzasadnienia (ta sama analiza, ten sam
werdykt, nie powtarzana tu w całości). Zespół potwierdził SPLIT
2026-09-08.

**Nowy mechanizm wprowadzony przez podział: bezpośrednie zapytanie o
`VendorInvoice` przez granicę modułu, bez `commandBus`.**
`createPaymentBatch`/`updatePaymentBatch` muszą znaleźć zatwierdzone
(`status === 'POSTED'`), jeszcze niepodpięte do innej, niezakończonej
paczki faktury tego samego dostawcy/waluty. Dopóki oba zestawy encji
żyły w jednym module, było to zwykłe zapytanie wewnątrz-modułowe;
podział czyni je pierwszym miejscem w całym tym dokumencie, gdzie
moduł czyta cudzą encję (nie tylko FK-id) przez granicę modułu.
**Decyzja**: bezpośrednie zapytanie `entityManager` po encji
`VendorInvoice` (import typu, **bez** deklaracji relacji ORM —
`root AGENTS.md`'s zakaz dotyczy relacji/joinów, nie samego importu
typu do zapytania), zawsze ze scope `tenantId`/`organizationId`
(mirror tego, jak `ModuleConfigService.get('accounts_payable.liabilityAccountId',
{ tenantId })` już czyta cudzą wartość konfiguracyjną bezpośrednio,
bez opakowania w `commandBus`). Uzasadnienie: `accounts_payable` jest
twardym, zawsze-współobecnym dependency tego modułu (zwalidowanym
przy generowaniu przez `ModuleInfo.requires`, patrz Module
Dependency) — nie opcjonalnym peerem jak `contractors` — więc nie ma
tu scenariusza degradacji do zaprojektowania, tak samo jak dla
`ledger`. **To jest nowy wzorzec, nie istniejący precedens w repo** —
w odróżnieniu od `commandBus.execute('ledger.postJournalEntry', ...)`,
które ma bezpośredni precedens (`workflows`' `UPDATE_ENTITY`), żaden
istniejący moduł w repo dziś nie odpytuje bezpośrednio encji innego,
twardo-zależnego modułu. Odrzucony alternatywny wzorzec: cienka
komenda zapytania w `accounts_payable`
(`accounts_payable.vendorInvoices.listPayable`, wołana przez ten sam
`commandBus`) — dałaby ściślejszą enkapsulację kosztem dodatkowej
warstwy pośredniej dla czegoś, co i tak zawsze współistnieje z
`accounts_payable`; oznaczone jako otwarta decyzja implementacyjna
(nie architektoniczna rozbieżność wymagająca eskalacji Q-stylu — obie
opcje są poprawne i niskiego ryzyka), do potwierdzenia przez
maintainerów przy code review, patrz Alternatives considered.

**Zmiana ścieżki API**: bazowa ścieżka tras HTTP zmienia się z
`/api/accounts_payable/payments/...` (gdy był to jeden moduł) na
`/api/accounts_payable_payments/payments/...` (mirror konwencji "trasy
API żyją pod prefiksem własnego modułu", tak jak
`/api/accounts_payable/invoices` żyje pod `accounts_payable`) — patrz
API Contracts. Zewnętrzna zmiana kontraktu wynikająca z podziału,
udokumentowana explicite, nie po cichu.

### Alternatives considered

| Alternative | Why Rejected |
|-------------|-------------|
| Rzeczywista integracja bankowa (wywołanie API banku / plik przelewów) w Fazie 1 | Brak jakiegokolwiek precedensu w repo — SPEC-024's Cash Management nie definiuje żadnego typu `PaymentOrder`/`PaymentInstruction`/`PaymentBatch`. Faza 1 kończy się na stworzeniu i zaksięgowaniu paczki płatniczej; samo wykonanie przelewu to Faza 2 |
| Zostawić faktury i płatności w jednym module `accounts_payable` | Odrzucone 2026-09-08 po dwóch niezależnych review — patrz Design decisions, "Q1 resolved" |
| Cienka komenda zapytania w `accounts_payable` (`listPayable`) zamiast bezpośredniego zapytania `entityManager` przez granicę modułu | Rozważone jako bezpieczniejsza, bardziej enkapsulowana alternatywa (ten sam mechanizm co `postJournalEntry`) — nie odrzucona, tylko odroczona jako otwarta decyzja implementacyjna: albo ta jest wybrana przy code review, albo bezpośrednie zapytanie (obie mają ten sam efekt funkcjonalny, żadna nie wymaga rework encji/komend) |

## User Stories

- **Pracownik AP** chce **zgrupować kilka zatwierdzonych faktur tego
  samego dostawcy w jedną paczkę płatniczą**, żeby **wykonać jeden
  przelew zamiast wielu osobnych**.
- **Pracownik AP** chce, żeby **system zablokował wysyłkę płatności,
  jeśli rachunek bankowy dostawcy nie jest tego dnia na Białej
  Liście**, żeby **firma nie poniosła odpowiedzialności solidarnej za
  VAT dostawcy**.
- **Główny księgowy** chce **mieć pewność, że zaksięgowana faktura
  (w `accounts_payable`) nigdy nie zniknie z konta 202 bez
  odpowiadającego zapisu płatności rejestrowanego przez ten moduł**,
  żeby **rozrachunki z dostawcami zawsze się zgadzały** — to jest
  właśnie ta cross-modułowa relacja, którą oba dokumenty muszą
  utrzymać spójnie mimo podziału (patrz Design decisions, "Q1
  resolved").

## Architecture

### Entities (`data/entities.ts`)

- `PaymentBatch` — `bankAccountId` (FK-id, `uuid` — referencja do
  przyszłej encji Bank Management/SPEC-024; ten moduł jej nie
  implementuje, dokładnie tak samo jak `accounts_payable` referencuje
  `Contractor`/`LedgerAccount` z modułów, które w momencie pisania
  tego spec-a mogą same być jeszcze tylko spec-em), `status`
  (`DRAFT`/`CONFIRMED`/`SENT`/`CANCELLED`), `scheduledPaymentDate`,
  `totalAmount` (`numeric(19,4)`, wyliczane z pozycji),
  `postedJournalEntryId` (nullable FK-id, ustawiane po
  `markPaymentBatchSent` — ten sam idempotency guard co
  `VendorInvoice.postedJournalEntryId`, patrz siostrzany dokument),
  tenant/org scoped, `updatedAt` (optymistyczna blokada dopóki
  `status` to `DRAFT`/`CONFIRMED`), `deletedAt` (soft delete,
  blokowany po `SENT`).
- `PaymentBatchLine` — `paymentBatchId` (FK), `vendorInvoiceId`
  (FK-id → `accounts_payable.VendorInvoice`, `uuid`, brak relacji
  ORM — patrz Design decisions, "Nowy mechanizm... bezpośrednie
  zapytanie"), `contractorBankAccountId` (FK-id →
  `ContractorBankAccount` z Contractor Registry — konkretny rachunek,
  na który leci ten konkretny przelew), `amount` (`numeric(19,4)` —
  Faza 1: zawsze pełna pozostała kwota faktury, brak płatności
  częściowych, patrz Out of scope), `whitelistCheckResult` (nullable
  `json` — wynik żywej weryfikacji Białej Listy w momencie
  `confirmPaymentBatch`: `status`, `checkedAt`, `requestId` — **bez**
  numeru rachunku, patrz Design decisions i Encryption poniżej),
  własne `organizationId`/`tenantId`.

### Access Control (`acl.ts`)

Podążając za konwencją modułu `customers`/`ledger`
(`<module>.<resource>.<action>`, `manage`/`execute` zależne od
`view`):

```typescript
export const features = [
  { id: 'accounts_payable_payments.payments.view', title: 'View payment batches', module: 'accounts_payable_payments' },
  { id: 'accounts_payable_payments.payments.manage', title: 'Create and edit payment batches', module: 'accounts_payable_payments', dependsOn: ['accounts_payable_payments.payments.view'] },
  { id: 'accounts_payable_payments.payments.execute', title: 'Confirm and send payment batches', module: 'accounts_payable_payments', dependsOn: ['accounts_payable_payments.payments.view'] },
]
```

`createPaymentBatch`/`updatePaymentBatch`/`cancelPaymentBatch`
require `accounts_payable_payments.payments.manage` (anulowanie
niewysłanej paczki to nie ruch pieniędzy, więc `.manage` wystarcza —
mirror decyzji z siostrzanego dokumentu dla `cancelVendorInvoice`).
`confirmPaymentBatch`/`markPaymentBatchSent` require
`accounts_payable_payments.payments.execute` (osobno od `.manage` —
realne przesunięcie pieniędzy zasługuje na własną, węższą bramkę).

Nazwa funkcjonalności powtarza słowo "payments" (nazwa modułu i nazwa
zasobu) — świadomie zaakceptowana redundancja, nie błąd: zasób jest
rzeczywiście "payments" (paczki płatnicze), niezależnie od nazwy
modułu, i konwencja `<module>.<resource>.<action>` obowiązuje
niezależnie od tego, czy nazwa modułu już zawiera nazwę zasobu.

### Module Dependency (`index.ts`)

Dwa twarde, zadeklarowane dependency — `ledger` (księgowanie) i
`accounts_payable` (status faktury, skonfigurowane konto zobowiązań
— patrz Cross-module integration) — wyrażone przez ten sam realny,
zwalidowany przy generowaniu mechanizm `ModuleInfo.requires`
(`packages/shared/src/modules/registry.ts`), już używany przez
`sales` (`requires: ['catalog','customers','dictionaries']`) i `wms`:

```typescript
// index.ts
import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  id: 'accounts_payable_payments',
  requires: ['ledger', 'accounts_payable'],
}
```

Brak `contractors` na tej liście jest celowy — to opcjonalny peer
(patrz Cross-module integration), nie twardy dependency; deklarowanie
go tutaj złamałoby dokładnie ten mechanizm degradacji, który
`tryResolve` ma zapewnić.

### Encryption (`encryption.ts`)

**Ten moduł nie potrzebuje własnego `encryption.ts`.**
`PaymentBatchLine.whitelistCheckResult` przechowuje tylko wynik
weryfikacji (`status`/`checkedAt`/`requestId`), celowo bez numeru
rachunku bankowego — ten jest już zaszyfrowany na
`ContractorBankAccount.accountNumber` w `contractors/encryption.ts`
(patrz Design decisions). Żadne inne pole w `PaymentBatch`/
`PaymentBatchLine` nie niesie danych PII/GDPR-wrażliwych.

### Module Setup (`setup.ts`)

```typescript
defaultRoleFeatures: {
  admin: ['accounts_payable_payments.*'],
  employee: [
    'accounts_payable_payments.payments.view',
    'accounts_payable_payments.payments.manage',
  ],
  // employee celowo bez '.execute' — potwierdzenie/wysyłka paczki
  // (realne przesunięcie pieniędzy) to węższa brama, mirror braku
  // '.post' dla employee w accounts_payable
},

async seedDefaults({ em, tenantId, organizationId }) {
  // Zapisuje pusty wiersz module_configs dla
  // accounts_payable_payments.defaultCashAccountId — patrz Migration
  // & Deployment. Nie zapisuje wartości dla
  // accounts_payable.liabilityAccountId — ta należy do siostrzanego
  // dokumentu (patrz Data Models → Module Config).
}
```

### Commands (Command Pattern, `commands/`)

- `createPaymentBatch` — tworzy `PaymentBatch` w `DRAFT`, pusty.
- `updatePaymentBatch` — dodaje/usuwa `PaymentBatchLine` (tylko
  faktury w statusie `POSTED` z `accounts_payable`, jeszcze
  niepodpięte do innej, niezakończonej paczki — czytane bezpośrednio
  przez `entityManager`, patrz Design decisions i Cross-module
  integration), tylko gdy `PaymentBatch.status === 'DRAFT'`.
- `confirmPaymentBatch` — `DRAFT` → `CONFIRMED`. Dla każdej linii
  rozwiązuje `contractorBankWhitelistCheck` z modułu `contractors`
  przez lokalny `tryResolve` (ten sam wzorzec co w Contractor
  Registry — `contractors` **jest** opcjonalnym peerem tutaj, w
  odróżnieniu od `ledger`/`accounts_payable`). **Polityka degradacji
  jest inna niż w Contractor Registry**: tam brak modułu powodował
  bezpieczne pominięcie tylko UI-owego przycisku "verify now"; tutaj,
  ponieważ chodzi o twardy blocker prawny (Biała Lista/MPP), brak
  modułu **blokuje potwierdzenie całej paczki** (fail-closed), zamiast
  cicho przechodzić dalej (fail-open) — ten sam mechanizm
  (`tryResolve`), inna polityka biznesowa przy braku wyniku.
- `markPaymentBatchSent` — `CONFIRMED` → `SENT`. Resolves
  `commandBus` z kontenera i woła `ledger.postJournalEntry` z jedną
  linią DR na skonfigurowane konto zobowiązań (`accounts_payable.liabilityAccountId`
  — czytane bezpośrednio przez `ModuleConfigService` ze scope
  `tenantId` siostrzanego modułu, patrz Data Models → Module Config)
  per `VendorInvoiceLine`-suma (albo jedną linią per faktura w
  paczce), jedną linią CR na skonfigurowane konto bankowe/kasowe
  (`accounts_payable_payments.defaultCashAccountId`),
  `referenceType: 'accounts_payable_payments:payment_batch'`,
  `referenceId: batch.id`. **Nie wykonuje realnego przelewu** — patrz
  Out of scope. Ustawia `postedJournalEntryId` (idempotency guard,
  mirror `postVendorInvoice`).
- `cancelPaymentBatch` — `DRAFT`/`CONFIRMED` → `CANCELLED`
  (soft-delete via `deletedAt`; zwalnia podpięte faktury, żeby mogły
  trafić do innej paczki — logicznie, przez usunięcie
  `PaymentBatchLine`, nie zapis do `VendorInvoice` samego). Zablokowane
  dla `SENT`.

**Ten moduł nie definiuje żadnego workflow-u.** W odróżnieniu od
`accounts_payable`'s obiegu akceptacji faktury (jednorazowa decyzja
approve/reject, `defineWorkflow`/`USER_TASK`), potwierdzenie i
wysyłka paczki płatniczej to proste, odwracalne-do-anulowania
przejścia stanu bramkowane samą `.execute`/`.manage` ACL i
`useGuardedMutation` na poziomie UI (patrz Backend Pages) — nie
jednorazowa, nieodwracalna decyzja wymagająca `USER_TASK`. To jest
dokładnie ten pierwszy przypadek ("prosty, odwracalny toggle"),
odróżniony w `accounts_payable`'s Design decisions od drugiego
("jednorazowa decyzja approve/reject").

### Events (`events.ts`)

```typescript
const events = [
  { id: 'accounts_payable_payments.payment_batch.confirmed', label: 'Payment Batch Confirmed', entity: 'payment_batch', category: 'lifecycle' },
  { id: 'accounts_payable_payments.payment_batch.sent', label: 'Payment Batch Sent', entity: 'payment_batch', category: 'lifecycle' },
] as const
```

`.sent` jest ephemeral (mirror `ledger.journal_entry.posted`) — żaden
subscriber persistentny nie jest jeszcze potrzebny w Fazie 1;
przyszły Posting Rules Engine subskrybuje bezpośrednio
`ledger.journal_entry.posted` (z GL), nie zdarzenia tego modułu — ten
moduł nie jest jego źródłem danych, GL jest (patrz
`2026-09-06-posting-rules-engine.md`). Ten moduł **nie** subskrybuje
żadnego zdarzenia z `accounts_payable` — czyta status `VendorInvoice`
bezpośrednio (query, nie event) przy budowaniu paczki płatniczej,
patrz Cross-module integration.

### Cross-module integration

Trzy różne relacje z trzema różnymi modułami — celowo różne
mechanizmy, nie przez przeoczenie:

- **GL (`ledger.postJournalEntry`) — twardy, zadeklarowany dependency,
  nie opcjonalny peer.** `packages/core/AGENTS.md` → Cross-Module
  Coupling opisuje `tryResolve` dla integracji **opcjonalnej**; GL nie
  jest tu opcjonalne. Ten moduł woła
  `container.resolve('commandBus').execute('ledger.postJournalEntry', input, ctx)`
  — ten sam generyczny mechanizm, którego `accounts_payable` już
  używa dla dokładnie tego samego celu, i którego `workflows`'
  `UPDATE_ENTITY` już używa do wołania dowolnej komendy po stringowym
  `commandId`.
- **`accounts_payable` — twardy, zadeklarowany dependency, z nowym
  wzorcem: bezpośrednie zapytanie encji przez granicę modułu.**
  `updatePaymentBatch` odpytuje `VendorInvoice` bezpośrednio przez
  `entityManager` (status `POSTED`, dostawca, waluta, wykluczając
  faktury już podpięte do innej, niezakończonej paczki — zawsze ze
  scope `tenantId`/`organizationId`), a `markPaymentBatchSent` czyta
  `accounts_payable.liabilityAccountId` bezpośrednio przez
  `ModuleConfigService` ze scope `tenantId` (nie przez `commandBus` —
  to jest wartość konfiguracyjna, nie komenda). Uzasadnienie i
  odrzucona alternatywa (cienka komenda zapytania) — patrz Design
  decisions, "Nowy mechanizm wprowadzony przez podział".
- **Contractors (`contractorBankWhitelistCheck`) — opcjonalny peer,
  z polityką fail-closed.** Ten moduł resolves przez lokalny
  `tryResolve` w `try/catch`, dokładnie jak zaprojektowano w
  Contractor Registry. Różnica względem tamtego spec-a: tam brak
  modułu degraduje tylko UI (`verify now` przestaje działać), tutaj
  brak modułu **blokuje** `confirmPaymentBatch` w całości — bo to
  twardy blocker prawny (Biała Lista/MPP), nie wygoda UX. Ten moduł
  nigdy nie traktuje brakującego wyniku jako "zakładam WHITELISTED"
  (fail-open) — zawsze jako "nie mogę zweryfikować, więc blokuję"
  (fail-closed).

### Backend Pages (`backend/accounts_payable_payments/`)

- `payments/page.tsx` — `DataTable` paczek płatniczych.
- `payments/create/page.tsx`, `payments/[id]/page.tsx` — tworzenie
  paczki (wybór zatwierdzonych, zaksięgowanych, niezapłaconych faktur
  tego samego dostawcy/waluty z `accounts_payable`), guarded row
  action "Potwierdź" (`useGuardedMutation` na `confirmPaymentBatch` —
  to jest zwykły toggle-podobny stan przejścia, nie decyzja
  approve/reject, więc `useGuardedMutation` jest tu właściwym wzorcem,
  w odróżnieniu od akceptacji faktury w siostrzanym dokumencie) i
  "Wyślij" (`markPaymentBatchSent`).

## Data Models

### PaymentBatch

- `id`: uuid (PK)
- `tenant_id`, `organization_id`: uuid
- `bank_account_id`: uuid (FK-id, referencja do przyszłej encji Bank Management)
- `status`: text (`DRAFT`/`CONFIRMED`/`SENT`/`CANCELLED`)
- `scheduled_payment_date`: date
- `total_amount`: numeric(19,4)
- `posted_journal_entry_id`: uuid, nullable
- `updated_at`: timestamptz, nullable (optymistyczna blokada dopóki `status` to `DRAFT`/`CONFIRMED`)
- `deleted_at`: timestamptz, nullable

Wspierający indeks: `(tenant_id, organization_id, status,
scheduled_payment_date)` dla listy paczek.

### PaymentBatchLine

- `id`: uuid (PK)
- `payment_batch_id`: uuid (FK)
- `vendor_invoice_id`: uuid (FK-id → `accounts_payable.VendorInvoice`, brak relacji ORM)
- `contractor_bank_account_id`: uuid (FK-id → `contractors.ContractorBankAccount`, brak relacji ORM)
- `amount`: numeric(19,4)
- `whitelist_check_result`: json, nullable
- `tenant_id`, `organization_id`: uuid (własne)

Wspierający indeks: `(payment_batch_id)` dla ładowania pozycji paczki;
`(vendor_invoice_id)` żeby `createPaymentBatch`/`updatePaymentBatch`
mogły szybko wykluczyć faktury już podpięte do innej, niezakończonej
paczki.

### Module Config (`ModuleConfigService`, tenant scope)

- `accounts_payable_payments.defaultCashAccountId` — domyślne konto
  bankowe/kasowe (np. "130"), używane jako CR w `markPaymentBatchSent`
  gdy `PaymentBatch.bankAccountId` nie mapuje się jeszcze na konkretne
  konto księgowe (Bank Management nie istnieje w kodzie — to
  tymczasowy fallback, do usunięcia gdy powstanie realne mapowanie
  rachunek-bankowy → konto księgowe). Własność tego dokumentu,
  ustawiane w jego config UI.
- **`accounts_payable.liabilityAccountId` — czytane, nie
  własność.** Konto zobowiązań wobec dostawców, używane jako DR w
  `markPaymentBatchSent`. Ustawiane w siostrzanego dokumentu config
  UI; ten moduł czyta je bezpośrednio przez `ModuleConfigService` ze
  scope `tenantId` (patrz Cross-module integration) — to jedyny
  zamierzony, udokumentowany punkt współdzielonej konfiguracji między
  dwoma dokumentami (patrz Design decisions, "Q1 resolved").

Obie czytane bez `tenantId` w scope tylko jako fallback (globalny
wiersz) — w praktyce każdy tenant ustawia je przy onboardingu, przez
`onTenantCreated` (patrz Migration & Deployment).

## API Contracts

### `GET /api/accounts_payable_payments/payments` / `POST /api/accounts_payable_payments/payments`

Standard `makeCrudRoute` dla `PaymentBatch` (create tworzy pusty
`DRAFT`; pozycje dodawane osobno). Bazowa ścieżka zmieniona z
`/api/accounts_payable/payments/...` (gdy był to jeden moduł, patrz
Design decisions, "Zmiana ścieżki API") na
`/api/accounts_payable_payments/payments/...`, mirror konwencji
"trasy API żyją pod prefiksem własnego modułu".

- **Response 403**: caller lacks `accounts_payable_payments.payments.view` (list) / `.manage` (create).

### `POST /api/accounts_payable_payments/payments/:id/lines`

Custom write route dodająca `PaymentBatchLine` (mapped to `update`).

- **Request**: `{ vendorInvoiceId, contractorBankAccountId, amount }`.
- **Response 409**: `PaymentBatch.status !== 'DRAFT'`, albo faktura
  nie jest `POSTED` (w `accounts_payable`), albo faktura jest już
  podpięta do innej, niezakończonej paczki.
- **Response 403**: caller lacks `accounts_payable_payments.payments.manage`.

### `POST /api/accounts_payable_payments/payments/:id/confirm`

Custom write route (mapped to `update`).

- **Response 200**: `{ id, status: 'CONFIRMED' }`.
- **Response 422 `WHITELIST_CHECK_FAILED`**: `{ code:
  'WHITELIST_CHECK_FAILED', failedLines: { vendorInvoiceId, reason
  }[] }` — co najmniej jedna linia nie przeszła żywej weryfikacji
  Białej Listy (albo moduł `contractors` jest niedostępny — patrz
  Cross-module integration, fail-closed).
- **Response 403**: caller lacks `accounts_payable_payments.payments.execute`.

### `POST /api/accounts_payable_payments/payments/:id/send`

Custom write route (mapped to `update`).

- **Response 200**: `{ id, status: 'SENT', postedJournalEntryId }`.
- **Response 409**: `status !== 'CONFIRMED'`.
- **Response 403**: caller lacks `accounts_payable_payments.payments.execute`.

### `POST /api/accounts_payable_payments/payments/:id/cancel`

Custom write route (mapped to `update`).

- **Response 200**: `{ id, status: 'CANCELLED' }`.
- **Response 409**: `status === 'SENT'`.
- **Response 403**: caller lacks `accounts_payable_payments.payments.manage`.

## Migration & Deployment

Nowe, addytywne tabele: `accounts_payable_payments_payment_batches`,
`accounts_payable_payments_payment_batch_lines` — zero zmian w
istniejących tabelach innych modułów (GL, Contractor Registry,
`accounts_payable`). `onTenantCreated` w `setup.ts` zapisuje pustą
wartość domyślną dla `accounts_payable_payments.defaultCashAccountId`
(rekord w `module_configs` z `tenant_id` ustawionym) — nie może
wybrać sensownej wartości automatycznie (zależy od faktycznego planu
kont tenant-a), więc `markPaymentBatchSent` odrzuca wywołanie
czytelnym błędem konfiguracyjnym dopóki księgowy nie ustawi tej
wartości (i `accounts_payable.liabilityAccountId` w siostrzanym
dokumencie) przez ekran konfiguracji modułu.

## Implementation Plan

### Phase 1: Paczki płatnicze, weryfikacja Białej Listy, księgowanie wysyłki

1. `index.ts` (`metadata.requires: ['ledger', 'accounts_payable']`)
   + encje + migracja (dwie tabele powyżej) + indeksy z Data Models.
2. `acl.ts` + `setup.ts` (role, `defaultRoleFeatures`,
   `onTenantCreated` zapisujący pustą wartość
   `defaultCashAccountId`).
3. `createPaymentBatch` / `updatePaymentBatch` / `cancelPaymentBatch`
   (zapytanie o zatwierdzone, niepodpięte faktury z
   `accounts_payable` — patrz Cross-module integration, decyzja
   implementacyjna do potwierdzenia przy code review: bezpośrednie
   zapytanie czy cienka komenda-zapytanie).
4. `confirmPaymentBatch` (integracja `contractorBankWhitelistCheck`
   przez `tryResolve`, fail-closed) + `events.ts`.
5. `markPaymentBatchSent` (wywołanie `commandBus` →
   `ledger.postJournalEntry`, czytanie
   `accounts_payable.liabilityAccountId` z siostrzanego modułu).
6. API routes + `api/openapi.ts` (w tym `.../cancel`).
7. Backend pages (payments list/create/edit).
8. Moduł config UI (ustawienie `defaultCashAccountId`).
9. Unit + integration test coverage (patrz Testing Strategy).

### Phase 2 (deferred)

- Rzeczywista integracja bankowa (wywołanie API banku albo eksport
  pliku przelewów) — dziś `markPaymentBatchSent` tylko księguje,
  nie wysyła pieniędzy.
- Płatności częściowe (dziś: pełna kwota faktury albo nic).
- Budżety/limity kwotowe na płatności — pre-warsztatowy brief
  (SPEC-024, sekcja "Budgeting & Forecasting", rola "Finance Manager
  chce ustawiać limity budżetowe") sugeruje osobny, przyszły moduł
  Budgeting — nie potwierdzone na warsztacie jako część tego dokumentu,
  więc świadomie poza zakresem.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `index.ts` | Create | `metadata.requires: ['ledger', 'accounts_payable']` — dwa twarde dependency |
| `data/entities.ts` | Create | `PaymentBatch`, `PaymentBatchLine` |
| `acl.ts` | Create | Trzy funkcjonalności (view/manage/execute) |
| `setup.ts` | Create | `defaultRoleFeatures`; `onTenantCreated` zapisujący pustą `defaultCashAccountId` |
| `events.ts` | Create | Dwa zdarzenia (patrz Events) |
| `commands/paymentBatches.ts` | Create | `createPaymentBatch`, `updatePaymentBatch`, `confirmPaymentBatch`, `markPaymentBatchSent`, `cancelPaymentBatch` |
| `lib/whitelistCheck.ts` | Create | Lokalny `tryResolve` wrapper wokół `contractorBankWhitelistCheck`, fail-closed policy |
| `lib/vendorInvoiceQueries.ts` | Create | Bezpośrednie zapytania `entityManager` po `accounts_payable.VendorInvoice` (albo wołanie cienkiej komendy-zapytania, jeśli tak zdecydowano przy code review — patrz Design decisions) |
| `api/openapi.ts` | Create | `openApi` exports dla wszystkich tras `accounts_payable_payments` |
| `api/payments/route.ts` | Create | `PaymentBatch` CRUD (`makeCrudRoute`) |
| `api/payments/[id]/lines/route.ts`, `.../confirm/route.ts`, `.../send/route.ts`, `.../cancel/route.ts` | Create | Custom guarded write routes |
| `backend/accounts_payable_payments/payments/page.tsx` (+ create/[id]) | Create | Payment batch list/create/edit UI |
| `backend/config/accounts_payable_payments/page.tsx` | Create | `defaultCashAccountId` config UI |
| `commands/__tests__/*` | Create | Regression coverage for all commands above |
| `__integration__/*` | Create | Integration coverage: full batch build→confirm→send flow; whitelist fail-closed path; `accounts_payable` unavailable path |

## Testing Strategy

- Zbudować paczkę płatniczą z dwóch zatwierdzonych, zaksięgowanych
  faktur tego samego dostawcy (z `accounts_payable`); potwierdzić
  (mock `contractorBankWhitelistCheck` zwraca `WHITELISTED` dla obu);
  wysłać; assert zbalansowany `JournalEntry` na koncie
  zobowiązań/koncie bankowym.
- Potwierdzić paczkę gdy jedna linia nie przechodzi weryfikacji
  Białej Listy; assert `422 WHITELIST_CHECK_FAILED`, paczka zostaje
  `DRAFT`.
- Potwierdzić paczkę gdy moduł `contractors` jest wyłączony (test
  module-decoupling, patrz `packages/core/AGENTS.md` → Testing with
  Disabled Modules); assert fail-closed — paczka **nie** przechodzi do
  `CONFIRMED`.
- Zbudować paczkę gdy moduł `accounts_payable` jest wyłączony (test
  module-decoupling); assert, że `createPaymentBatch`/
  `updatePaymentBatch` nie mogą znaleźć żadnej kwalifikującej się
  faktury — w odróżnieniu od `contractors`' testu powyżej, ten
  scenariusz jest w praktyce niemożliwy do wywołania w produkcji
  (`accounts_payable` to zwalidowany przy generowaniu twardy
  dependency), ale regression test dokumentuje oczekiwane zachowanie
  jeśli walidacja kiedyś zawiedzie.
- Anulować paczkę płatniczą w `DRAFT` i w `CONFIRMED`; assert
  `CANCELLED`, podpięte faktury zwolnione (dostępne dla innej
  paczki); anulowanie paczki `SENT` musi zwrócić 409.
- Wysłać tę samą paczkę dwa razy (retry po timeout-cie sieci); assert
  drugie wywołanie `markPaymentBatchSent` jest no-opem, nie duplikuje
  zapisu (idempotency guard, mirror `postVendorInvoice`'s test w
  siostrzanym dokumencie).

## Risks & Impact Review

### Data integrity failures

#### Podwójne zaksięgowanie tej samej paczki płatniczej
- **Scenario**: `markPaymentBatchSent` wywołane dwa razy dla tej samej
  paczki (np. retry po timeout-cie sieci), zanim pierwsze wywołanie
  zdąży ustawić `postedJournalEntryId`.
- **Severity**: High
- **Affected area**: `accounts_payable_payments`, `ledger` (podwójny,
  niezbalansowany wpis na koncie zobowiązań/bankowym)
- **Mitigation**: `postedJournalEntryId` sprawdzane i ustawiane w
  jednej transakcji z wywołaniem `commandBus`
  (`withAtomicFlush`/transaction wrapping); druga, równoległa próba na
  tej samej paczce musi zobaczyć już ustawiony `postedJournalEntryId`
  i zwrócić no-op zamiast wołać `postJournalEntry` ponownie — mirror
  `postVendorInvoice`'s mitigacja w siostrzanym dokumencie.
- **Residual risk**: teoretyczne wyścigowe okno między odczytem a
  zapisem `postedJournalEntryId` przy dwóch równoczesnych requestach —
  wymaga unique constraint albo select-for-update na
  `PaymentBatch.id` wewnątrz komendy; do potwierdzenia przy
  implementacji.

### Cascading failures & side effects

#### Brak modułu `contractors` blokuje wszystkie płatności
- **Scenario**: moduł `contractors` wyłączony albo niedostępny (błąd
  DI); `confirmPaymentBatch` nie może rozwiązać
  `contractorBankWhitelistCheck`.
- **Severity**: High (dla operacji), ale zamierzone
- **Affected area**: `accounts_payable_payments.payments.*`
- **Mitigation**: fail-closed z założenia — żadna paczka nie może
  przejść do `CONFIRMED` bez świeżego wyniku weryfikacji. To jest
  poprawne zachowanie prawne, nie błąd do naprawienia.
- **Residual risk**: brak — to jest projektowany, akceptowalny wynik
  (blokada płatności > naruszenie odpowiedzialności solidarnej VAT).

#### `ledger.postJournalEntry` niedostępne (moduł `ledger` wyłączony)
- **Scenario**: `commandBus.execute('ledger.postJournalEntry', ...)`
  rzuca, bo `ledger` nie jest zarejestrowany.
- **Severity**: Critical
- **Affected area**: cały moduł — nie może księgować wysyłki żadnej
  paczki.
- **Mitigation**: brak degradacji do zaprojektowania — to twardy
  dependency (patrz Cross-module integration), deklarowany przez
  `index.ts`'s `metadata.requires`.
- **Residual risk**: brak — oczekiwane zachowanie dla brakującego
  twardego dependency.

#### Moduł `accounts_payable` niedostępny
- **Scenario**: moduł `accounts_payable` wyłączony albo niedostępny;
  bezpośrednie zapytanie o `VendorInvoice` (patrz Cross-module
  integration) nie zwraca żadnych wierszy albo rzuca, jeśli encja nie
  jest zarejestrowana.
- **Severity**: Critical, ale zamierzone
- **Affected area**: cały moduł — nie może zbudować ani wysłać żadnej
  paczki (brak faktur do podpięcia, brak
  `accounts_payable.liabilityAccountId` do zaksięgowania wysyłki).
- **Mitigation**: brak degradacji do zaprojektowania — to twardy,
  zwalidowany przy generowaniu dependency (`ModuleInfo.requires`),
  analogiczne do `ledger`. **Nowe ryzyko wprowadzone przez podział**
  (przed 2026-09-08 to był jeden moduł — ten scenariusz po prostu nie
  istniał), ale symetryczne do już zaakceptowanego ryzyka braku
  `ledger`.
- **Residual risk**: brak — oczekiwane zachowanie dla brakującego
  twardego dependency; w praktyce niemożliwe do wywołania, bo
  rejestracja modułów waliduje `requires` przy generowaniu.

### Tenant & data isolation

Obie encje mają własne `tenant_id`/`organization_id`
(`PaymentBatchLine` ma własne kolumny zakresu, nie tylko odziedziczone
przez FK, mirror `ContractorBankAccount`). `ModuleConfigService` z
jawnym `tenantId` w scope gwarantuje, że konto bankowe/kasowe jednego
tenant-a nigdy nie przecieka jako fallback do innego — to samo
dotyczy odczytu `accounts_payable.liabilityAccountId` (patrz Data
Models → Module Config).

### Migration & deployment

Patrz Migration & Deployment section powyżej — dwie nowe, addytywne
tabele, zero zmian w istniejących. `onTenantCreated` idempotentny
(może być uruchomiony wielokrotnie bez duplikowania wierszy
`module_configs` — `ModuleConfigService`'s partial unique indexes to
gwarantują).

## Out of scope (tracked separately)

- Rzeczywista integracja bankowa (przelew wykonywany naprawdę) — brak
  jakiegokolwiek precedensu w repo; `markPaymentBatchSent` w tym
  dokumencie tylko księguje, nie wysyła pieniędzy. Osobny, przyszły
  spec (Bank Management/SPEC-024 rozwinięcie).
- Budżety/limity kwotowe na płatności — pre-warsztatowy koncept
  (SPEC-024), niepotwierdzony na warsztacie jako część tego dokumentu;
  osobny, przyszły moduł Budgeting, jeśli w ogóle powstanie.
- Płatności częściowe — Faza 2.
- Przyjęcie faktury i obieg akceptacji — patrz
  `2026-09-06-accounts-payable.md`.

## Final Compliance Report — 2026-09-08

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/events/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `vendorInvoiceId`, `contractorBankAccountId`, `bankAccountId` all FK-id only, no relation decorators — including the new direct-query pattern against `accounts_payable.VendorInvoice` (patrz Design decisions) |
| root AGENTS.md | Filter by organization_id | Compliant | Both entities tenant/org scoped; `PaymentBatchLine` carries own scope columns |
| `packages/core/AGENTS.md` → API Routes | All API route files MUST export `openApi` | Compliant | `api/openapi.ts` covers every route, per File Manifest |
| `packages/core/AGENTS.md` → API Routes | Custom write routes wire the mutation guard registry | Compliant | `lines`/`confirm`/`send`/`cancel` routes all mapped to `update` operation |
| `packages/core/AGENTS.md` → Cross-Module Coupling | Optional-peer sync calls resolve via `tryResolve` in `try/catch`; hard dependency uses direct resolution | Compliant | `contractorBankWhitelistCheck` via `tryResolve` (optional peer, fail-closed policy); `ledger.postJournalEntry` via direct `commandBus.execute` (hard dependency) |
| `packages/core/AGENTS.md` → Cross-Module Coupling (hard dependency mechanism) | Hard dependency declared through `ModuleInfo.requires` | Compliant | `index.ts` with `metadata.requires: ['ledger', 'accounts_payable']` |
| `packages/core/AGENTS.md` → Cross-Module Coupling (new pattern) | Direct entity query across a hard-dependency module boundary | **Compliant, but a new pattern introduced by this split — flagged, not silently assumed** | No existing repo module today queries another hard-dependency module's entity directly (the closest precedent, `commandBus.execute`, is for command calls, not reads); this document's own Design decisions record the reasoning and the rejected thin-query-command alternative, and recommend maintainer confirmation at code review rather than treating this as a settled, verified precedent |
| `packages/core/AGENTS.md` → Database Entities | User-editable entities MUST include `updated_at` | Compliant | `PaymentBatch` has `updatedAt`; `PaymentBatchLine` is a sub-resource guarded by its parent aggregate (exempt, per the same rule's own exemption list) |
| `packages/core/AGENTS.md` → Database Entities | Standard column contract includes `deleted_at` | Compliant | `PaymentBatch` has `deletedAt`; `PaymentBatchLine` exempt as sub-resource. Status guard blocking delete after `SENT` enforced at the command layer (`cancelPaymentBatch`) |
| `packages/core/AGENTS.md` → Encryption | GDPR/PII fields declared in `<module>/encryption.ts`, read via `findWithDecryption` | N/A | No PII/GDPR-sensitive field in this module's entities — `whitelistCheckResult` deliberately excludes the bank account number (already encrypted in `contractors/encryption.ts`), see Encryption |
| `packages/core/AGENTS.md` → Access Control (RBAC) | Features declared per module, naming `<module>.<action>` | Compliant | Three features (`view`/`manage`/`execute`) |
| `packages/events/AGENTS.md` | Events declared with `as const`; subscribers export `metadata` | Compliant | Two events declared; no persistent subscriber needed in Phase 1 |
| `packages/queue/AGENTS.md` | Workers idempotent, export `metadata` | N/A | This module ships no queue worker in Phase 1 — no background job crosses a request boundary |
| `BACKWARD_COMPATIBILITY.md` | Database schema additive-only | Compliant | Two new tables only, zero changes to existing modules' schemas |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match architecture | Pass | Entities in Architecture and Data Models agree |
| API contracts match data models | Pass | Every documented field/filter has a backing column, including the `.../cancel` route |
| Commands defined for all mutations | Pass | Every status transition has a named command, including `cancelPaymentBatch` for `CANCELLED` |
| Double-entry postings balance | Pass | `markPaymentBatchSent` posts DR liability / CR cash, both to configured accounts |
| Risks cover all write operations | Pass | Double-posting, `contractors`/`ledger`/`accounts_payable` cascades, tenant isolation, migration all addressed |
| Scope cohesion vs. other modules | Pass | Single capability (payment batching and sending), independently deployable given its two hard dependencies (`ledger`, `accounts_payable`) — invoices split out per Q1 resolution, see siostrzany dokument |
| Scope cohesion *within* this document | Pass | One entity group, one lifecycle, one GL integration seam — this is exactly the half of the original combined document that both independent reviews identified as its own cohesive capability |
| Cross-module coupling mechanism matches dependency type | Pass, with one flagged new pattern | Hard dependencies (`ledger`, `accounts_payable`) via `ModuleInfo.requires`; `ledger` calls via `commandBus` (existing precedent); `accounts_payable` reads via direct entity query and direct `ModuleConfigService` read (new pattern, explicitly flagged — see Compliance Matrix above); optional peer (`contractors`) via `tryResolve`, fail-closed |

### Non-Compliant Items

None. One item is a **newly introduced design pattern flagged for
maintainer confirmation, not a compliance gap**: the direct
cross-module entity query against `accounts_payable.VendorInvoice`
(see Compliance Matrix and Design decisions).

### Verdict

**Ready for maintainer review, with one implementation detail
flagged for confirmation at code review (not a compliance blocker):**
whether `updatePaymentBatch`'s read of `accounts_payable.VendorInvoice`
should go through a thin query command on `commandBus` (stricter
encapsulation, no new pattern) or the direct `entityManager` query
this document designs (simpler, no new command surface) — see Design
decisions and Alternatives considered. Every AGENTS.md rule checked
is compliant. This document is the narrower, payments-only half of
what was originally a single combined Accounts Payable
specification — two independent, fresh-context reviews found the
combined document's own scope-cohesion self-assessment unreliable
(it cited a misrepresented GL precedent) and recommended a split; the
team confirmed the split on 2026-09-08. This document carries
forward, unchanged, every fix from that combined document's own
independent-review round that applies to the payments half (the
`cancelPaymentBatch`/unreachable-`CANCELLED` fix, the
`whitelistCheckResult` encryption-avoidance design) — see Changelog
for the full history. The invoice half, its own risks, and its own
compliance report live in `2026-09-06-accounts-payable.md`.

## Changelog

### 2026-09-06

- Initial specification (Design Decisions only, from event-storming
  wall — at this point part of one combined `accounts_payable`
  document with the invoice half).

### 2026-09-07

- Full expansion from skeleton to complete `om-spec-writing` template
  (at this point still combined with invoices in one document).
  Research pass against the real repo (not the pre-workshop SPEC-024
  brief) before writing: confirmed no `PaymentOrder`/`PaymentInstruction`
  entity exists anywhere; confirmed SPEC-024's `BankTransaction` type
  (`matchedEntryId: Option<EntryId>`) shows reconciliation logic, not
  payment-initiation logic, settling the payments-vs-Bank-Management
  boundary question in favor of this module initiating and posting
  the payment batch.

### 2026-09-07 (cont. — independent review round, while still combined with invoices)

Two fresh-context reviews (compliance/checklist + architectural
sanity) were run against the full expansion, per the same protocol
used for GL and Contractor Registry. Findings verified against the
real repo before acting on them; fixes applied in this same round
(only the ones affecting the payments half are listed here — the
invoice-half fixes from this same round are recorded in
`2026-09-06-accounts-payable.md`'s own Changelog):

- **Unreachable status + missing route (fixed)**: `PaymentBatch.CANCELLED`
  had no producing command. Added `cancelPaymentBatch` command +
  `.../cancel` route.
- **Encryption avoided by design, not a gap**: `PaymentBatchLine.whitelistCheckResult`
  was designed from the start to exclude the bank account number
  (already encrypted on `ContractorBankAccount`) rather than needing
  its own `encryption.ts` entry — confirmed correct by the encryption
  review pass alongside the invoice half's genuine gap.
- **Scope-cohesion SPLIT (escalated, then resolved 2026-09-08 — see
  below)**: both reviews independently leaned SPLIT for invoices vs.
  payments, and one of them found the combined document's own
  justification (an analogy to how GL kept `FiscalPeriod` bundled)
  misrepresented that precedent. Recorded as **Q1** pending
  resolution, per `spec-checklist.md`'s escalation protocol.

### 2026-09-08 — Q1 resolved: split into two documents

- Resolved Q1: split the combined `accounts_payable` document into
  this document (`accounts_payable_payments` — payment batches,
  Biała Lista verification, payment posting) and
  `2026-09-06-accounts-payable.md` (`accounts_payable` — vendor
  invoice lifecycle only, kept as the sibling document's title).
  Carried over verbatim: `PaymentBatch`/`PaymentBatchLine` entities,
  `payments.*` ACL (renamed to `accounts_payable_payments.payments.*`
  for the new module id), `createPaymentBatch`/`updatePaymentBatch`/
  `confirmPaymentBatch`/`markPaymentBatchSent`/`cancelPaymentBatch`
  commands, `payment_batch.*` events (renamed with the new module
  prefix), the `contractorBankWhitelistCheck` `tryResolve`
  integration, and `defaultCashAccountId`.
- Declared a new hard dependency on `accounts_payable` (alongside the
  existing hard dependency on `ledger`) via `index.ts`'s
  `metadata.requires: ['ledger', 'accounts_payable']` — this dependency
  didn't need to exist as a *cross-module* mechanism before the split,
  since both entity groups lived in one module.
- Designed, for the first time in this document family, a direct
  cross-module entity query (`updatePaymentBatch` reading
  `accounts_payable.VendorInvoice` directly, and `markPaymentBatchSent`
  reading `accounts_payable.liabilityAccountId` directly) — recorded
  as a new pattern requiring explicit justification, not silently
  assumed to be covered by existing precedent (`commandBus.execute`
  covers command calls, not reads). Recorded the rejected alternative
  (a thin query command on `commandBus`) as an open implementation
  detail for maintainer confirmation, not a blocking question.
  Documented `accounts_payable.liabilityAccountId` explicitly as the
  one intentionally shared config value between the two documents,
  to avoid drift.
  Renamed the API base path from `/api/accounts_payable/payments/...`
  to `/api/accounts_payable_payments/payments/...`, matching the
  per-module route-prefix convention — flagged explicitly as an
  external contract change caused by the split, not glossed over.
  Rewrote Overview, Problem Statement, Proposed Solution, User
  Stories, Risks, Out of scope, and the Final Compliance Report for
  the narrower payments-only scope; removed the Open Questions
  section (Q1 resolved).
