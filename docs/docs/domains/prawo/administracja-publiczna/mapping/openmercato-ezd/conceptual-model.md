---
title: Model konceptualny
sidebar_position: 40
---

Ten dokument opisuje model pojęciowy (nie techniczny) dla MVP.

## Encje (MVP)

1. `incoming_shipment` – Przesyłka wpływająca
2. `jrwa_class` – JRWA (klasa/pozycja)
3. `case_register` – Spis spraw
4. `case` – Sprawa
5. `folder` – Koszulka
6. `document` – Dokument
7. `chronological_location` – Skład chronologiczny: lokalizacja

Nazwy techniczne są robocze; finalnie będą zależeć od nazwy modułu i istniejących konwencji.

## Relacje (przez ID)

- `document.incomingShipmentId` (opcjonalne)
- `document.folderId` (opcjonalne)
- `document.caseId` (opcjonalne)

- `case.jrwaClassId` (wymagane)
- `case.caseRegisterId` (wymagane)
- `case.folderId` (opcjonalne: jeśli sprawa powstała z koszulki)

- `folder.caseId` (opcjonalne, ustawiane po konwersji; 1:1)

## Zasady spójności (MVP)

- Dokument może istnieć bez przesyłki.
- Dokument może być przypięty do sprawy niezależnie od przesyłki.
- Przesyłka nie inicjuje sprawy automatycznie.
- Koszulka konwertuje się do sprawy 1:1.

## Skład chronologiczny: lokalizacja i historia

Wymaganie: lokalizacja ma historię zmian.

Rekomendowany model konceptualny:

- `chronological_location` opisuje miejsce (np. regał/półka/pojemnik).
- `chronological_location_assignment` (lub równoważny mechanizm) przechowuje historię przypisań dokumentów do lokalizacji:
  - `documentId`
  - `locationId`
  - `validFrom`
  - `validTo` (nullable)
  - `note` (opcjonalne)

To rozdzielenie pozwala:

- mieć słownik lokalizacji,
- utrzymywać historię bez nadpisywania.

## Oznaczenia przesyłki (zamiast statusów)

Minimalny zestaw pól oznaczeń:

- `hasChronologicalRegistration: boolean`
- `mappingCoverage: 'none' | 'partial' | 'full'`

Szczegóły doprecyzowujemy w słowniku danych.
