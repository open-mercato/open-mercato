---
title: Decyzje (EZD → OpenMercato)
sidebar_position: 90
---

Ten dokument zbiera decyzje projektowe związane z mapowaniem kancelaryjno‑archiwalnym na OpenMercato.

Format decyzji (ADR‑like):

- Id: `D-XXX`
- Kontekst
- Decyzja
- Konsekwencje
- Status: proposed/accepted/superseded

## D-001: MVP ograniczone do CRUD

- Status: accepted
- Kontekst: chcemy szybko zmapować model danych i API.
- Decyzja: na start budujemy tylko CRUD + walidacje + OpenAPI.
- Konsekwencje: procesy/workflow będą opisywane, ale wdrażane później.

## D-002: RPW jako numeracja/widok

- Status: accepted
- Kontekst: RPW jest rejestrem przesyłek wpływających.
- Decyzja: RPW nie jest osobną encją – to numeracja + widoki na przesyłkach.
- Konsekwencje: pola RPW lądują na encji przesyłki; raporty/listy budujemy query.

## D-003: Koszulka → Sprawa 1:1

- Status: accepted
- Kontekst: dokumenty podlegają pracy merytorycznej, zanim powstanie sprawa.
- Decyzja: koszulka jest encją i może zostać przekształcona w sprawę 1:1.
- Konsekwencje: tworzymy pole wiążące (`folder.caseId` oraz opcjonalnie `case.folderId`).

## D-004: Dokument może istnieć bez przesyłki

- Status: accepted
- Kontekst: dokument może zostać „przyniesiony”.
- Decyzja: `document.incomingShipmentId` jest opcjonalne.
- Konsekwencje: walidacje nie mogą wymagać przesyłki.

## D-005: Skład chronologiczny – lokalizacja jako encja z historią

- Status: accepted
- Kontekst: lokalizacja ma być śledzona w czasie.
- Decyzja: modelujemy lokalizacje oraz historię przypisań (bez nadpisywania).
- Konsekwencje: potrzebny jest dodatkowy zasób „history/assignments”.

## D-006: Wyszukiwanie MVP = tokens dla Spraw i Dokumentów

- Status: accepted
- Kontekst: chcemy, aby użytkownik mógł szybko znajdować rekordy Cmd+K, ale bez wdrażania fulltext/vector w MVP.
- Decyzja:
	- W MVP indeksujemy i wystawiamy w Cmd+K tylko: **Sprawa** i **Dokument**.
	- Strategia search na start: **tokens**.
- Konsekwencje:
	- CRUD dla tych encji musi odświeżać `query_index`.
	- Moduł `records` musi dostarczyć presenter (`formatResult`) dla tokens, żeby wyniki były czytelne.
