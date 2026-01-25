# Analiza wdrożeniowa: Records (Przesyłka wpływająca / RPW / JRWA)

## 1) Cel dokumentu
Ten dokument zbiera:
- zakres MVP i plan wdrożenia pierwszego wycinka modułu `records`,
- założenia architektoniczne i techniczne (zgodne z konwencjami repozytorium),
- propozycję modelu danych + API,
- listę **wątpliwości / pytań** (backlog decyzyjny), które będziemy rozstrzygać po kolei.

Dokument jest celowo „wdrożeniowy”: ma umożliwić przejście od opisu procesu (EZD) do implementacji w Open Mercato, z minimalnym ryzykiem przebudowy.

---

## 2) Kontekst domenowy (skrót)
W oparciu o dostarczone materiały:
- implementację zaczynamy od „Przesyłki wpływającej” (rejestracja wpływu),
- numer RPW jest związany z rejestracją przesyłki (docelowo generator numerów),
- JRWA to klasyfikacja rzeczowa (drzewo klas + retencja), wykorzystywana później m.in. do spraw/dokumentów.

---

## 3) Zakres MVP
### 3.1 Co wchodzi
1) **Moduł `records`** w `packages/core/src/modules/records`.
2) Encje (początkowo minimalne):
   - `records_incoming_shipments` (Przesyłka wpływająca)
   - `records_jrwa_classes` (JRWA)
3) Walidatory Zod:
   - create/update dla obu encji,
   - schemat query listy (paginacja + wyszukiwanie).
4) CRUD API (Next/route):
   - `GET/POST/PUT/DELETE` dla `incoming-shipments`
   - `GET/POST/PUT/DELETE` dla `jrwa-classes`
5) OpenAPI:
   - każdy route eksportuje `openApi` (wymóg repo),
   - modułowy helper `api/openapi.ts`.
6) `di.ts` (nawet jeśli na razie pusty rejestrator).
7) Minimalne `search.ts`:
   - `formatResult` dla obu encji, aby wyniki Cmd+K nie pokazywały gołych UUID.

### 3.2 Co nie wchodzi (na tym etapie)
- generowanie migracji i finalizacja schematu SQL (dopiero po zatwierdzeniu pól + indeksów),
- pełna logika numeracji RPW (generator + sekwencje + konfiguracja),
- encje „kancelaria/office” jako osobny byt w `records` (kancelaria = komórka organizacyjna w strukturze organizacyjnej),
- sprawy i dokumenty (case/document), relacje i workflow.

---

## 4) Ograniczenia i zasady architektoniczne (z repo)
- Moduły muszą być **izomorficzne** i niezależne: brak relacji ORM między modułami (tylko FK jako `*_id`).
- Multi-tenant: wszystkie rekordy tenant-scoped muszą mieć `tenant_id` i (zwykle) `organization_id`.
- Walidacja wejść: Zod (bez ręcznego SQL, bez interpolacji).
- API: CRUD przez `makeCrudRoute`, OpenAPI przez `createCrudOpenApiFactory`.
- Search: dla encji używanych w Cmd+K wymagany `formatResult`.

---

## 5) Proponowany model danych (draft)
### 5.1 `records_incoming_shipments`
Minimalny zestaw pól (MVP):
- `id: uuid`
- `tenant_id: uuid`
- `organization_id: uuid`
- `receiving_org_unit_id: uuid` – ID komórki organizacyjnej (kancelarii) ze struktury organizacyjnej
- `receiving_org_unit_symbol: text` – symbol komórki organizacyjnej (snapshot na przesyłce; używany jako `kanc_id` w RPW)
- `subject: text` – temat (wymagane)
- `sender_name: text` – nadawca (wymagane)
- `delivery_method: text` – typ/sposób wpływu (wymagane; np. papier/ePUAP/e-mail)
- `status: text` – `draft` | `registered` (wymagane; default: `draft`)
- `received_at: timestamptz|null` – data wpływu (wymagane najpóźniej na etapie rejestracji)
- `rpw_number: text|null` – numer RPW (nullable w `draft`, ustawiany wyłącznie w akcji „Zarejestruj wpływ”)
- `attachment_ids: uuid[]` – załączniki (NIE wymagane w MVP; brak wymogu liczby na przesyłce)
- `is_active: boolean`
- `created_at`, `updated_at`, `deleted_at`

Proponowane indeksy (docelowo):
- `(tenant_id, organization_id)`
- `(tenant_id, organization_id, rpw_number)` – unikalność numeru w scope organizacji
- `(tenant_id, organization_id, receiving_org_unit_id)`

Docelowo (generator RPW):
- sekwencja `seq` jest **per organization + komórka + rok**

### 5.2 `records_jrwa_classes`
Minimalny zestaw pól (MVP):
- `id: uuid`
- `tenant_id: uuid`
- `organization_id: uuid`
- `code: text` – liczbowy (np. „1234”)
- `name: text`
- `parent_id: uuid|null` – drzewo
- `retention_years: int|null`
- `retention_category: text|null` – np. A/B/BE itd.
- `version: int` – wersja JRWA (wersjonowanie w MVP; szczegóły w backlogu)
- `is_active: boolean`
- `created_at`, `updated_at`, `deleted_at`

Proponowane indeksy (docelowo):
- `(tenant_id, organization_id, parent_id, code)` – unikalność węzłów w drzewie
- `(tenant_id, organization_id, version)`

---

## 6) API (MVP)
### 6.1 Endpointy
- `GET /api/records/incoming-shipments`
- `POST /api/records/incoming-shipments`
- `PUT /api/records/incoming-shipments`
- `DELETE /api/records/incoming-shipments?id=<uuid>`

Akcja procesowa (poza CRUD):
- `POST /api/records/incoming-shipments/{id}/register` – „Zarejestruj wpływ” (nadaje RPW, wymusza komplet danych, ustawia status `registered`)

- `GET /api/records/jrwa-classes`
- `POST /api/records/jrwa-classes`
- `PUT /api/records/jrwa-classes`
- `DELETE /api/records/jrwa-classes?id=<uuid>`

### 6.2 Listowanie
W MVP listowanie może iść „ORM fallback” (bez QueryEngine `entityId`), żeby nie blokować się na generatorach `E.*`.

W kolejnym kroku (po generatorach) listy można przepiąć na QueryEngine:
- jawne `entityId` + `fields`,
- docelowo filtrowanie/sortowanie, custom fields itd.

---

## 7) Uprawnienia (ACL)
Proponowane feature flags (MVP):
- `records.incoming_shipments.view|create|edit|delete`
- `records.incoming_shipments.register`
- `records.jrwa_classes.view|create|edit|delete`

Decyzja: czy wprowadzamy `manage` zamiast CRUD-owych akcji – do ustalenia (patrz backlog pytań).

---

## 8) OpenAPI
Wszystkie route’y muszą eksportować `openApi`.
- Dla CRUD używamy modułowego wrappera `createRecordsCrudOpenApi` (analogicznie do customers/sales/catalog).

---

## 9) Search (Cmd+K)
MVP: definicje w `records/search.ts`:
- `formatResult` dla `incoming_shipments` (np. tytuł / RPW),
- `formatResult` dla `jrwa_classes` (np. `code — name`).

Uwaga: `entityId` w search musi być spójne z rejestrem encji (generator). Decyzja: uruchamiamy generator od razu.

---

## 10) Migracje i generator modułów
Na ten etap: **nie generujemy migracji**.

Jednocześnie: **uruchamiamy generator modułów od razu** (żeby mieć `E.records.*`, registries i spójne `entityId` dla search/indexer).

Plan:
1) Zatwierdzamy model pól + unikalności + indeksy.
2) Dopiero wtedy aktualizujemy encje MikroORM.
3) Generujemy migracje poleceniem repo (`npm run db:generate`).

---

## 11) Strategia wdrożenia (kolejność prac)
1) Scaffold modułu `records` (pliki + kompilacja): encje, validators, routes, openapi, di, search.
2) Generator: `modules:prepare` i dopięcie `entityId`/search.
3) Smoke test API (lokalnie): create/list/update/delete + akcja `register`.
4) Doprecyzowanie RPW:
  - implementacja generatora numerów (wzorowana na `salesDocumentNumberGenerator`),
  - format stały: `RPW/{kanc_id}/{seq:5}/{yyyy}` (sekwencja resetowana rocznie),
  - nadawanie RPW wyłącznie w akcji „Zarejestruj wpływ”.
5) Doprecyzowanie JRWA:
  - import CSV,
  - wersjonowanie,
  - unikalność `(parent_id, code)`.
6) Migracje.
7) UI/backoffice.

---

## 12) Ryzyka i pułapki
- `kanc_id` w numerze RPW: jeśli nie ustalimy jednoznacznej reprezentacji (UUID vs symbol), łatwo o przebudowę formatowania i kompatybilności numerów.
  - decyzja wdrożeniowa: przechowujemy `receiving_org_unit_symbol` na przesyłce i używamy go jako `kanc_id` w RPW.
- JRWA import CSV + wersjonowanie: bez doprecyzowania modelu wersji i aktualizacji drzew, ryzyko duplikatów i chaosu w indeksach.
- Załączniki wymagane w MVP: trzeba ustalić minimalny kontrakt (attachments module, walidacja min. 1, relacje przesyłka↔dokument).
- Generator/sekwencje: ryzyko błędów współbieżności bez atomic upsert (wymaga dobrego testu/komendy administracyjnej).

---

## 13) Nowy backlog wątpliwości / pytań do rozstrzygnięcia
Poniżej lista otwartych kwestii po zamknięciu kluczowych decyzji (office usunięte, RPW format/scope/rok/akcja, JRWA scope/unikalność/import/wersja, statusy i wymagane pola).

### A) RPW / rejestracja wpływu
- **Q2-RPW-001 (P0)**: Czym dokładnie jest `kanc_id` w formacie `RPW/{kanc_id}/{seq:5}/{yyyy}`?
  - opcje: symbol komórki organizacyjnej, numer porządkowy, kod zewnętrzny, skrót tekstowy.
  - wpływ: przechowywanie w strukturze organizacyjnej i stabilność numerów.
  - decyzja: symbol komórki organizacyjnej

- **Q2-RPW-002 (P0)**: Jaki jest klucz sekwencji `seq`?
  - decyzja o unikalności jest per organization, ale trzeba potwierdzić czy `seq` jest:
    - per organization + rok (wspólna sekwencja), czy
    - per organization + komórka + rok (sekwencje równoległe; w numerze rozróżnia je `kanc_id`).
    - decyzja: per organization + komórka + rok

- **Q2-RPW-003 (P1)**: Czy akcja `register` ma być idempotentna?
  - jeśli przesyłka już ma RPW / status `registered`, czy zwracamy 200 i nic nie robimy, czy 409?
  - decyzja: 409

### B) Przesyłka wpływająca + załączniki
- **Q2-SHIP-001 (P0)**: Jak modelujemy „załączniki na przesyłce” w MVP?
  - czy to bezpośrednio `attachment_ids` na przesyłce, czy dokumenty `records.documents` powiązane z przesyłką, czy oba.
  - decyzja: dokumenty `records.documents` powiązane z przesyłką, czy oba.

- **Q2-SHIP-002 (P1)**: Czy wymagamy dokładnie 1+ załączników na etapie `draft`, czy dopiero na etapie `register`?
    - decyzja: przesyłka może być niejawna, wiec zostanie wyłącznie zarejestrowana bez załączników. nie ma wiec wymogu liczby załączników. musi mieć za to co najmniej jeden Dokument.

### C) JRWA (wersje + import)
- **Q2-JRWA-001 (P0)**: Jak wygląda model wersjonowania JRWA?
  - osobna encja „jrwa_versions” i `jrwa_class.version_id`, czy pole `version` na klasie, czy snapshoty.
  - decyzja: pole `version` na klasie

- **Q2-JRWA-002 (P0)**: Kontrakt importu CSV: format kolumn + jak mapujemy `parent_id` (kod rodzica, ścieżka, osobne ID)?
    - decyzja: kod rodzica

### D) UI / Backoffice
- **Q2-UI-001 (P1)**: Które ekrany są w MVP dla `incoming_shipments` i `jrwa_classes`?
  - minimalnie: lista + create/edit + przycisk „Zarejestruj wpływ” (Cmd/Ctrl+Enter).
  - decyzja: lista + create/edit + przycisk „Zarejestruj wpływ” (Cmd/Ctrl+Enter).

### E) Search
- **Q2-SEARCH-001 (P1)**: Jaka strategia search dla `incoming_shipments` i `jrwa_classes` w MVP?
  - tokens vs fulltext; oraz jakie pola mają być tytułem/subtytułem wyniku.
  - decyzja: tokens

---

## 14) Kryteria akceptacji (MVP)
- Moduł `records` buduje się i uruchamia bez migracji.
- API CRUD działa (create/list/update/delete) dla obu zasobów w scope tenant/org.
- Każdy route ma `openApi`.
- Search ma `formatResult` i nie pokazuje surowych UUID jako tytułu.
- Backlog pytań jest kompletny i gotowy do „zamykania” w kolejnych iteracjach.
