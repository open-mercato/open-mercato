---
title: Pokrycie (co już mamy)
sidebar_position: 30
---

Robocza tabela pokrycia: element domeny → istniejący moduł/funkcja Open Mercato.

## Dokumentacja mapowania EZD → OpenMercato

Rozwinięcie i bieżące decyzje trzymamy w przestrzeni:

- [OpenMercato ↔ EZD (kancelaryjno-archiwalne)](./openmercato-ezd/index)

W szczególności:

- [Zakres i MVP](./openmercato-ezd/scope-mvp)
- [Słownik (dev)](./openmercato-ezd/glossary-dev)
- [Model konceptualny](./openmercato-ezd/conceptual-model)
- [Mapowanie encji](./openmercato-ezd/entity-map)
- [Mapowanie API (CRUD)](./openmercato-ezd/api-map)
- [Słownik danych (MVP)](./openmercato-ezd/data-dictionary)
- [Przykłady Pakiet A/B](./openmercato-ezd/examples-archival-packages)
- [Decyzje (EZD → OpenMercato)](./openmercato-ezd/decisions)

## Checklist: EZD (MVP/CRUD)

### Co już mamy (ustalone)

- [x] MVP ograniczone do modelu danych + CRUD
- [x] MVP obejmuje 7 encji domenowych: Przesyłka wpływająca, JRWA, Spis spraw, Sprawa, Koszulka, Dokument, Skład chronologiczny – lokalizacja
- [x] RPW traktujemy jako widok/numerację dla Przesyłek wpływających (bez osobnej encji)
- [x] Koszulka jako kontener roboczy, konwersja do sprawy 1:1
- [x] Dokument może istnieć bez przesyłki i może być przypięty bezpośrednio do sprawy
- [x] Przesyłka wpływająca nie ma statusów — ma oznaczenia dot. odwzorowania (pełne/częściowe/skład chronologiczny)
- [x] Skład chronologiczny – lokalizacja jako osobna encja z historią zmian

### Co do dopięcia (żeby zacząć implementację CRUD)

- [ ] Decyzja: nazwa i scope modułu (roboczo: `records`) oraz nazwy zasobów/endpointów
- [ ] JRWA: minimalny schemat (pola obowiązkowe, drzewo, retencja) + sposób zasilania (import vs CRUD)
- [ ] Spis spraw: zakres numeracji i unikalność (per rok? per komórka? per JRWA?)
- [ ] Sprawa: minimalne statusy (czy tylko open/closed), zasady zamknięcia, oraz generacja/unikalność znaku sprawy
- [ ] Dokument: model załączników (osobne dokumenty vs pliki), minimalne typy `kind`
- [ ] Przesyłka wpływająca: które pola Pakietu A są wymagane na start (na create vs na update)
- [ ] Dostęp (accessLevel): ustalenie enumów i znaczenia „publiczny / częściowo / niepubliczny” dla MVP
- [ ] Skład chronologiczny: konkretna encja historii (np. `chronological_assignments`) + reguły (1 aktywne przypisanie?)
- [ ] OpenAPI: spójne schemy request/response dla każdego CRUD route (Zod) + opisy
- [ ] RBAC/feature flags: minimalny zestaw uprawnień dla CRUD w tym module

### Co już istnieje w OpenMercato (do wykorzystania)

- [ ] CRUD factory i wzorce tras API (do wskazania konkretnymi przykładami)
- [ ] Custom Fields / Custom Entities (jeżeli część pól ma być konfigurowalna)
- [ ] Audit logs (jeśli chcemy śledzić zmiany encji)
- [ ] Workflows / Business Rules (później, po MVP)

Format wiersza:
- Element domeny:
- Wymaganie (AP-...):
- Proponowane odwzorowanie w OM:
- Braki / uwagi:

Start (do wypełnienia):
- Załączniki i wersjonowanie dokumentów
- Audit logs
- Workflows
- Business Rules
- Custom Entities + Custom Fields
