# WMS — raport gap: Miesiąc 1 vs implementacja Fazy 1

| Pole | Wartość |
|------|---------|
| **Data** | 2026-06-06 |
| **Branch** | `feat/388-wms-phase-1` |
| **Commit** | `79fe0f515` |
| **Issue** | [#388](https://github.com/open-mercato/open-mercato/issues/388) |
| **Język** | Polski |

## Streszczenie

Implementacja na branchu `feat/388-wms-phase-1` **pokrywa zdecydowaną większość** zakresu biznesowego Miesiąca 1 z roadmapy WMS oraz **~95%** specyfikacji technicznej Fazy 1. Jednocześnie branch **wyprzedza plan** w kilku obszarach zaplanowanych na Miesiąc 2+ (integracja sales, auto-reserve/release, akcje Move/Release w konsoli, przypisanie magazynu do zamówienia).

| Metryka | Ocena |
|---------|-------|
| Pokrycie planu biznesowego M1 | **~85–90%** |
| Pokrycie specyfikacji technicznej Fazy 1 | **~95%** |
| Nadmiar względem M1 (M2+) | **Znaczący** — integracja sales i zaawansowane mutacje UI |
| Gotowość do zamknięcia M1 | **Blisko** — kilka luk UX/operacyjnych i brak powiadomień in-app |

---

## Źródła baseline (plan)

| Dokument | Ścieżka | Rola |
|----------|---------|------|
| Roadmapa biznesowa (M1–M3) | `docs/wms/wms-roadmap-and-estimates-en.md` | Definicja „Miesiąc 1” — magazyn, słowniki, widoki operacyjne, Adjust, cycle count, import CSV, primary warehouse |
| Spec techniczny Fazy 1 | `.ai/specs/2026-04-15-wms-phase-1-core-inventory.md` | Kontrakt techniczny: encje, API, UI, integracje catalog/sales |
| Kontekst roadmapy | `.ai/specs/2026-04-15-wms-roadmap.md` | Fazy 1–5, zależności między modułami |

### Definition of Done — Miesiąc 1 (z roadmapy)

> *Warehouse structure + catalog + solid UX + operational visibility (including lot/expiry) + primary warehouse + Adjust + simple cycle count + import decision tied to first merchant scale* — demo: configure warehouses with one primary, create locations/SKUs, post an opening balance via Adjust, run a short cycle count, show per-SKU / per-location / per-lot + expiry card + overview; import path exists or is explicitly waived with written scale assumption.

---

## Zakres implementacji (moduł WMS)

**Ścieżka:** `packages/core/src/modules/wms/`

**Testy integracyjne:** 22 pliki Playwright w `packages/core/src/modules/wms/__integration__/`

---

## Macierz zgodności — Miesiąc 1

Legenda statusów:

| Symbol | Znaczenie |
|--------|-----------|
| ✅ | Zrobione zgodnie z planem M1 |
| ⚠️ | Częściowo / jakość poniżej oczekiwań M1 |
| ❌ | Brak względem planu M1 |
| 🔵 | Nadmiar — zaplanowane na M2+ lub wykracza poza M1 |

### 1. Topologia magazynowa i master data

| Wymaganie M1 | Status | Dowód / uwagi |
|--------------|--------|---------------|
| Magazyny (`Warehouse`) | ✅ | CRUD + UI `/backend/config/wms` |
| Strefy (`WarehouseZone`) | ✅ | CRUD w konfiguracji WMS |
| Lokalizacje (`WarehouseLocation`) | ✅ | Hierarchia, unikalność adresów |
| **Primary warehouse** (`is_primary`) | ✅ | Polityka MVP; używana przez automatyzację sales |
| Produkty/SKU (integracja catalog) | ✅ | `ProductInventoryProfile`, widget `catalog-inventory-profile` |
| Jednostki miary | ✅ | Przez catalog (nie duplikowane w WMS) |
| RBAC: operator / supervisor | ✅ | `setup.ts`, `acl.ts` — 9 feature'ów |
| Import CSV (bootstrap) | ✅ | `ImportInventoryDialog`, API validate/apply/template, testy TC-WMS-025, TC-WMS-IMPORT-UI-001 |

### 2. Silnik inwentaryzacyjny

| Wymaganie M1 | Status | Dowód / uwagi |
|--------------|--------|---------------|
| Ledger ruchów (`InventoryMovement`) | ✅ | Append-only, API `/api/inventory/movements` |
| Salda (`InventoryBalance`) | ✅ | Per lokalizacja/wariant/lot |
| Rezerwacje (`InventoryReservation`) | ✅ | Model + API + UI `/backend/wms/reservations` |
| Partie (`InventoryLot`) + expiry | ✅ | Encja, widoki, dashboard expiry |
| Profile inwentaryzacyjne | ✅ | Lot/serial/FEFO/safety stock/reorder |
| Mutacja **Adjust** (UI) | ✅ | `AdjustInventoryDialog`, TC-WMS-INVENTORY-UI-001 |
| Mutacja **Cycle count** (3 kroki) | ✅ | Prosty flow count → variance → post |
| Mutacja **Move** (UI row action) | 🔵 | `MoveInventoryDialog`, TC-WMS-026 — roadmapa M1 odkłada na M2+ |
| Mutacja **Release** (UI row action) | 🔵 | `ReleaseReservationDialog`, TC-WMS-026 — j.w. |
| API `receive` | 🔵 | Endpoint istnieje — receiving to zakres M2 |
| API `allocate` | 🔵 | Endpoint istnieje — głębsza alokacja to M2+ |

### 3. Widoki operacyjne (read-only)

| Wymaganie M1 | Status | Dowód / uwagi |
|--------------|--------|---------------|
| Per SKU — „gdzie leży” | ✅ | `/backend/wms/sku/[id]`, TC-WMS-023/024 |
| Per lokalizacja — „co tu jest” | ✅ | `/backend/wms/location/[id]` |
| Per lot — „co wygasa” | ✅ | `/backend/wms/lot/[id]`, lista `/backend/wms/lots` |
| Karta expiry (nadchodzące/przeterminowane) | ✅ | Dashboard operacyjny |
| Dashboard: low stock, expiry, aging reservations, dzisiejsze ruchy | ✅ | `WmsOperationalDashboardPage`, TC-WMS-DASHBOARD-001/UI-001 |
| Konsola inwentaryzacyjna | ✅ | `/backend/wms/inventory` |

### 4. Uprawnienia i audyt

| Wymaganie M1 | Status | Dowód / uwagi |
|--------------|--------|---------------|
| Role operator / supervisor (seed) | ✅ | `setup.ts`, `lib/roleFeatures.ts` |
| Log kluczowych zmian | ⚠️ | Ledger (`InventoryMovement`) zapewnia audyt techniczny; **brak dedykowanego widoku audytu operacyjnego** dla supervisora |
| Powiadomienia in-app (np. low stock) | ❌ | Event `wms.inventory.low_stock` emitowany (`commands/inventory-actions.ts`), ale `notifications.ts` jest **puste** — brak typów powiadomień i rendererów UI |

### 5. Integracja catalog

| Wymaganie M1 / Faza 1 | Status | Dowód / uwagi |
|-----------------------|--------|---------------|
| Widget profilu inwentaryzacyjnego na produkcie | ✅ | `widgets/injection/catalog-inventory-profile` |
| Enrichery `_wms.*` | ✅ | `data/enrichers.ts`, testy `enrichers.test.ts` |
| Sync profilu z catalog | ✅ | `lib/catalogInventoryProfileSync.ts` |

### 6. Integracja sales (plan M2 — pojawia się wcześniej)

Roadmapa umieszcza **pełną integrację sales** w Miesiącu 2. Na branchu jest już znaczna część:

| Wymaganie M2 | Status na branchu | Dowód / uwagi |
|--------------|-------------------|---------------|
| Auto-reserve na `sales.order.confirmed` | 🔵 | `subscribers/sales-order-confirmed-reserve.ts`, TC-WMS-017 |
| Auto-release na `sales.order.cancelled` | 🔵 | `subscribers/sales-order-cancelled-release.ts`, TC-WMS-017 |
| Kolumna stock w pozycjach zamówienia | 🔵 | `order-items-stock-column`, TC-WMS-STOCK-COL-001/002/003 |
| Kontekst stock na karcie zamówienia | 🔵 | `sales-order-stock-context` widget |
| Przypisanie magazynu do zamówienia | 🔵 | `SalesOrderWarehouseAssignment`, TC-WMS-004 |
| **Multi-warehouse breakdown per magazyn** na karcie | ⚠️ | Enrichment istnieje, ale **pełny breakdown Warsaw/Kraków/Poznań** jak w scenariuszu M2 nie jest domknięty w UX |
| **Insufficient-stock UX** przed fulfillment | ⚠️ | Częściowo przez enrichment; brak dedykowanego guardrail UX zgodnego ze scenariuszem M2 |
| Test E2E UI widgetu sales na karcie zamówienia | ⚠️ | Testy API/kolumn istnieją; **brak pełnego E2E UI** karty zamówienia z widocznym shortfall |

---

## Macierz zgodności — Spec Fazy 1 (techniczny)

| Obszar specyfikacji | Status | Uwagi |
|---------------------|--------|-------|
| Encje: Warehouse, Zone, Location | ✅ | `data/entities.ts` |
| Encje: Profile, Lot, Balance, Reservation, Movement | ✅ | Komplet |
| CRUD API + OpenAPI | ✅ | `makeCrudRoute`, `openApi` na trasach |
| Komendy: adjust, cycle-count, move, reserve, release, allocate, receive | ✅ | `commands/inventory-actions.ts` |
| Wyszukiwanie (search config) | ✅ | `search.ts` |
| Eventy WMS | ✅ | `events.ts` — m.in. `wms.inventory.low_stock` |
| ACL (9 feature'ów) | ✅ | `acl.ts` |
| i18n (en, pl, de, es) | ✅ | `i18n/*.json` |
| Backend UI (dashboard, konsola, config, detail views) | ✅ | Strony pod `/backend/wms/*` |
| Integracja catalog (widget + enricher) | ✅ | |
| Integracja sales (enricher + widget + subscriber) | ✅ / 🔵 | Zrobione, ale wykracza poza „backend-first bez pełnej integracji sales” z opisu fazy |
| Powiadomienia in-app | ❌ | Puste `notifications.ts` |
| Status specyfikacji | ⚠️ | Nadal **Draft** — nie przeniesiona do `.ai/specs/implemented/` |
| Pokrycie testami integracyjnymi ze spec | ✅ | 22 scenariusze TC-WMS-* |

---

## Luki (gap) — co brakuje względem M1

### Must (blokuje zamknięcie M1 wg roadmapy)

1. **Powiadomienia in-app dla low stock** — event jest, brak `notificationTypes`, subscribera powiadomień i rendererów w `notifications.client.ts`. Dashboard pokazuje low stock, ale brak proaktywnego alertu dla supervisora.

### Should (jakość operacyjna M1)

2. **Dedykowany widok audytu operacyjnego** — ruchy są w ledgerze i na liście movements, ale brak skonsolidowanego widoku „kto/co/kiedy” dla supervisora (roadmapa wymaga „minimum auditability”).
3. **Widget sales — nazwy SKU zamiast UUID** — kolumna stock na pozycjach zamówienia może pokazywać identyfikatory wariantów zamiast czytelnych nazw produktów.
4. **Status specyfikacji** — Faza 1 pozostaje Draft; brak changelogu implementacyjnego i przeniesienia do `implemented/`.

### Could (nice-to-have przed demo M1)

5. **Ujednolicenie empty states** na widokach detail przed pierwszym Adjust (roadmapa przewiduje poprawne puste stany do czasu M2).
6. **Dokumentacja written waiver** dla importu CSV — jeśli pierwszy merchant ma <2k SKU, roadmapa wymaga jawnego zapisu decyzji w planowaniu.

---

## Nadmiar (scope creep) — zrobione przed planem

Poniższe elementy **nie były wymagane w Miesiącu 1** i należą do M2+ wg `docs/wms/wms-roadmap-and-estimates-en.md`:

| Element | Planowany miesiąc | Pliki / testy |
|---------|-------------------|---------------|
| Subskryber auto-reserve (`sales.order.confirmed`) | M2 | `subscribers/sales-order-confirmed-reserve.ts` |
| Subskryber auto-release (`sales.order.cancelled`) | M2 | `subscribers/sales-order-cancelled-release.ts` |
| Automatyzacja rezerwacji (`salesOrderInventoryAutomation.ts`) | M2 | `lib/salesOrderInventoryAutomation.ts` |
| Widget kontekstu stock na zamówieniu | M2 | `sales-order-stock-context` |
| Kolumna stock w tabeli pozycji zamówienia | M2 | `order-items-stock-column` |
| Przypisanie magazynu do zamówienia | M2 | TC-WMS-004 |
| Row actions Move / Release w konsoli | M2+ (explicit defer) | TC-WMS-026 |
| API receiving (`receive`) | M2 (inbound) | `commands/inventory-actions.ts` |
| Rozbudowany dashboard operacyjny z aging reservations | M1 częściowo + M2 | Więcej niż minimalny overview M1 |

**Ocena nadmiaru:** pozytywny dla velocity integracji sales, ale **rozmywa granicę M1/M2** i utrudnia raportowanie postępu kwartalnego bez tej analizy.

---

## Pokrycie testami

| Kategoria | Liczba | Przykłady |
|-----------|--------|-----------|
| API / backend | 12+ | TC-WMS-001–003, 017–023, 025 |
| UI WMS | 6+ | TC-WMS-INVENTORY-UI-001, DASHBOARD-UI-001, IMPORT-UI-001, 024 |
| Integracja sales | 5+ | TC-WMS-004, 017, STOCK-COL-001/002/003 |
| Row actions (M2+) | 1 | TC-WMS-026 |

**Luka testowa:** brak dedykowanego testu E2E pełnej karty zamówienia sales z widocznym breakdown per magazyn i insufficient-stock UX (scenariusz Definition of Done M2).

---

## Werdykt końcowy

### Miesiąc 1 (biznes)

Implementacja **spełnia lub przewyższa** większość kryteriów M1:

- ✅ Struktura magazynu, primary warehouse, lokalizacje
- ✅ Adjust + prosty cycle count (UI produkcyjne)
- ✅ Import CSV
- ✅ Widoki per SKU / lokalizacja / lot + expiry
- ✅ Dashboard operacyjny
- ✅ RBAC operator/supervisor
- ⚠️ Audyt operacyjny (ledger tak, dedykowany widok nie)
- ❌ Powiadomienia in-app (low stock)

**Szacunek: ~85–90% M1.**

### Faza 1 (techniczna)

**Szacunek: ~95%** — brakuje głównie warstwy powiadomień i formalnego domknięcia specyfikacji (status Draft → implemented).

### Rekomendacje następnych kroków

1. Dodać `notificationTypes` + subscriber na `wms.inventory.low_stock` + renderer UI.
2. Rozważyć prosty widok audytu (filtr movements + actor/timestamp) lub integrację z `audit_logs`.
3. Naprawić wyświetlanie nazw SKU w widgetach sales.
4. Przenieść spec do `implemented/` z changelogiem i datą wdrożenia.
5. Dla issue #388: oznaczyć elementy M2 już zrobione, żeby nie dublować pracy w kolejnym sprincie.
6. Dodać test E2E karty zamówienia sales (scenariusz M2 DoD) — może być w osobnym PR pod M2.

---

## Załącznik — kluczowe ścieżki w repozytorium

```
packages/core/src/modules/wms/
├── acl.ts                          # 9 feature'ów RBAC
├── setup.ts                        # role operator/supervisor
├── events.ts                       # wms.inventory.low_stock
├── notifications.ts                # PUSTE — gap
├── commands/inventory-actions.ts # adjust, cycle-count, move, reserve, release, allocate, receive
├── subscribers/
│   ├── sales-order-confirmed-reserve.ts   # M2+
│   └── sales-order-cancelled-release.ts     # M2+
├── widgets/injection/
│   ├── catalog-inventory-profile/
│   ├── sales-order-stock-context/         # M2+
│   └── order-items-stock-column/            # M2+
├── backend/wms/                    # dashboard, inventory, reservations, lots, detail views
├── backend/config/wms/             # konfiguracja magazynów
└── __integration__/                # 22 pliki TC-WMS-*
```

---

## Changelog tego raportu

| Data | Autor | Zmiana |
|------|-------|--------|
| 2026-06-06 | Cursor Agent | Pierwsza wersja — analiza gap M1 vs branch `feat/388-wms-phase-1` @ `79fe0f515` |
