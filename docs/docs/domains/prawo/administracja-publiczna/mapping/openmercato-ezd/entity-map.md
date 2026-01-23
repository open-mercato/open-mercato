---
title: Mapowanie encji
sidebar_position: 50
---

Ten dokument mapuje obiekty kancelaryjno‑archiwalne na encje i moduły w OpenMercato.

## Hipoteza modułu

Rekomendacja robocza: nowy moduł `records` (obszar „records/office records”).

Uwaga: to tylko hipoteza do walidacji – finalna nazwa zależy od spójności z istniejącymi modułami.

## Tabela mapowania (MVP)

| Potrzeba (domena) | Typ | Odpowiednik w OM | Status | Notatki |
|---|---|---|---|---|
| Przesyłka wpływająca | Encja | `records.incoming_shipments` | Nowe | RPW jako numeracja na tej encji |
| RPW | Widok/numeracja | pola na przesyłce + lista | Nowe | Bez osobnej tabeli/encji |
| JRWA | Encja | `records.jrwa_classes` | Nowe | Drzewo klas + retencja |
| Spis spraw | Encja | `records.case_registers` | Nowe | Zakres numeracji do dopięcia |
| Sprawa | Encja | `records.cases` | Nowe | Znak sprawy jako pole wyliczalne lub przechowywane |
| Koszulka | Encja | `records.folders` | Nowe | Konwersja 1:1 do sprawy |
| Dokument | Encja | `records.documents` | Nowe | Powiązania opcjonalne: przesyłka/koszulka/sprawa |
| Skład chronologiczny – lokalizacja | Encja | `records.chronological_locations` | Nowe | Z historią zmian przypisań |

## Pokrycie istniejącymi modułami OM (core/shared/search)

Ta tabela pokazuje „klocki platformy” OpenMercato, które wykorzystamy przy implementacji modułu `records`.

MVP wymaga:

- wyszukiwania Cmd+K dla **Sprawy** i **Dokumentu**,
- strategii search **tokens** (minimalnie).

| Potrzeba EZD | Moduł/Helper OM | Zakres reuse | Wymóg na MVP? | Linki (docs) |
|---|---|---|---:|---|
| Załączniki / odwzorowania dokumentów (pliki) | `attachments` (core) | upload, metadane, powiązania z rekordami | tak | /docs/api/attachments (kod: `packages/core/src/modules/attachments`) |
| Ślad zmian / historia operacji CRUD | `audit_logs` (core) | logowanie zmian i inspekcja w UI | opcjonalnie | /docs/user-guide/audit-logs (kod: `packages/core/src/modules/audit_logs`) |
| Konfigurowalne pola (Custom Fields) dla encji `records.*` | `entities` (core) + custom fields | definicje pól + przechowywanie wartości + walidacje | opcjonalnie | /docs/user-guide/custom-fieldsets oraz /docs/api/entities (kod: `packages/core/src/modules/entities`) |
| Normalizacja i rozdział payloadu custom fields | `splitCustomFieldPayload`, `normalizeCustomFieldValues`, `normalizeCustomFieldResponse` (shared) | spójny format `cf_`/`cf:` w create/update/response | opcjonalnie | kod: `packages/shared/src/lib/crud/custom-fields.ts`, `packages/shared/src/lib/custom-fields/normalize.ts` |
| Mapowanie custom fields w formularzach CRUD (backend UI) | `collectCustomFieldValues` (ui) | zbieranie `cf_*`/`cf:` z form i transformacja wartości | opcjonalnie | kod: `packages/ui/src/backend/utils/customFieldValues.ts` |
| Indeksowanie encji pod zapytania/listy | `query_index` (core) | indeks (doc) + odświeżanie po CRUD | tak | kod: `packages/core/src/modules/query_index` |
| Wyszukiwanie (Cmd+K) dla Sprawy i Dokumentu | `search` (core + package) | strategia `tokens`, presenter dla wyników | tak | /docs/user-guide/search (kod: `packages/search`, `packages/core/src/modules/search`) |
| Fulltext/vector search (później) | `search` + `vector` | opcjonalne strategie, embeddings | nie | /docs/api/vector |
| Procesy obiegu (później) | `workflows` (core) | definicje workflow, taski, monitoring | nie | /docs/user-guide/workflows (kod: `packages/core/src/modules/workflows`) |

### Konsekwencje dla implementacji `records` (MVP)

- CRUD dla `records.cases` i `records.documents` powinien od razu emitować side effects do `query_index`, żeby `tokens` search działał.
- W module `records` trzeba będzie dodać `search.ts` z `formatResult` (dla tokens), aby wyniki Cmd+K nie były surowymi UUID.
- Custom fields są oznaczone jako „opcjonalnie”, ale jeśli zdecydujemy się na nie dla metadanych (np. pola specyficzne jednostki), to od początku używamy helperów z `packages/shared`/`packages/ui` zamiast ad-hoc parsowania `cf_*`.

## Uwaga o relacjach między modułami

W OpenMercato moduły są niezależne.

- Nie tworzymy relacji ORM między modułami.
- Powiązania realizujemy przez pola `...Id`.

Jeśli w przyszłości trzeba będzie łączyć np. nadawcę (podmiot) z innym modułem, robimy to przez ID i osobne zapytania.
