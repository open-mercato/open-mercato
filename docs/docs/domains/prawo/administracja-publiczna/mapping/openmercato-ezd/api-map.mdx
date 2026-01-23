---
title: Mapowanie API (CRUD)
sidebar_position: 60
---

Ten dokument opisuje minimalny zestaw endpointów CRUD dla MVP.

## Zasady

- Każda encja MVP ma standardowe operacje: list/get/create/update/delete.
- Dla list: paginacja, podstawowe filtrowanie, sortowanie.
- Brak procesów asynchronicznych w MVP.

## Proponowane zasoby

| Zasób | Endpoint (docelowy) | Uwagi |
|---|---|---|
| Przesyłki wpływające | `/api/records/incoming-shipments` | RPW jako numeracja na rekordzie |
| Dokumenty | `/api/records/documents` | dokument może istnieć sam |
| Koszulki | `/api/records/folders` | koszulka → sprawa 1:1 (patrz niżej) |
| Sprawy | `/api/records/cases` | nie inicjujemy automatycznie z przesyłki |
| Spisy spraw | `/api/records/case-registers` | numeracja spraw do dopięcia |
| JRWA | `/api/records/jrwa-classes` | drzewo klas |
| Lokalizacje składu | `/api/records/chronological-locations` | słownik |
| Historia lokalizacji | `/api/records/chronological-assignments` | historia przypisań dokument↔lokalizacja |

## Operacje „na granicy CRUD”

### Konwersja koszulki do sprawy

W MVP (CRUD) konwersję można ująć jako:

- `POST /api/records/cases` z polem `folderId`, które tworzy sprawę i ustawia `folder.caseId`.

Alternatywnie (później, jako proces): dedykowany endpoint typu `POST /api/records/folders/{id}/convert-to-case`.

## Przesyłka: oznaczenia odwzorowania

Zamiast statusów przesyłka posiada pola/flagę odwzorowania:

- rejestracja w składzie chronologicznym
- odwzorowanie pełne / częściowe

Te pola są aktualizowane przez standardowe `PATCH/PUT` na przesyłce.

## Search/indexer requirements (MVP)

W MVP wyszukiwanie Cmd+K ma obejmować tylko:

- **Sprawy**
- **Dokumenty**

Strategia search: **tokens**.

### Wymagania dla indeksowania (`query_index`)

CRUD dla `records.cases` i `records.documents` musi odświeżać indeks.

Checklist (implementacyjnie):

- Każdy CRUD route ma ustawiony `indexer: { entityType }`.
- `entityType` jest stabilnym identyfikatorem typu rekordu (np. `records:case`, `records:document` – do potwierdzenia konwencji).
- Po create/update/delete emitujemy side effects tak, aby rekord był widoczny w `tokens` search.

### Wymagania dla prezentacji wyników (`search.ts`)

Ponieważ `tokens` search renderuje wynik na podstawie konfiguracji w module search, moduł `records` musi dostarczyć presenter.

Checklist:

- Plik `search.ts` w module `records` zawiera wpisy dla `records:case` oraz `records:document`.
- Każdy wpis ma `formatResult` (title/subtitle/icon), aby uniknąć wyników w stylu „UUID”.
- (Opcjonalnie) `resolveUrl` kieruje do docelowej strony backend (gdy powstanie UI).
