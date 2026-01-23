---
title: Słownik danych (MVP)
sidebar_position: 70
---

Ten dokument definiuje minimalne pola dla encji MVP oraz ich źródła (np. Pakiet A).

## Przesyłka wpływająca (incoming shipment)

Źródło: Pakiet A.

| Pole | Typ | Wymagane | Uwagi |
|---|---|---:|---|
| `senderId` lub `senderDisplayName` | string | tak* | jeśli nadawca anonimowy, przechowujemy displayName/minimum |
| `senderAnonymous` | boolean | nie | domyślnie false |
| `receivedAt` | date | tak | data wpływu |
| `deliveryMethod` | enum | tak | `in_person` / `epuap` / `edoręczenia` (robocze) |
| `postedAt` | date | nie | data nadania |
| `senderReference` | string | nie | numer nadawczy |
| `remarks` | string | nie | uwagi |
| `documentDate` | date | nie | data na piśmie |
| `noDocumentDate` | boolean | nie | gdy brak daty |
| `documentSign` | string | nie | znak na piśmie |
| `noDocumentSign` | boolean | nie | gdy brak znaku |
| `accessLevel` | enum | tak | publiczny / częściowo / niepubliczny (robocze) |
| `hasChronologicalRegistration` | boolean | nie | oznaczenie |
| `mappingCoverage` | enum | nie | `none` / `partial` / `full` |

`*` Wymagalność nadawcy: doprecyzować regułę (senderId vs senderDisplayName) na podstawie trybu „nadawca anonimowy”.

## Dokument

| Pole | Typ | Wymagane | Uwagi |
|---|---|---:|---|
| `title` | string | tak | tytuł dokumentu |
| `kind` | enum | tak | np. `pismo` (robocze) |
| `accessLevel` | enum | tak | publiczny/częściowo/niepubliczny |
| `receivedAt` | date | nie | jeśli dotyczy |
| `documentDate` | date | nie | data na dokumencie |
| `documentSign` | string | nie | znak na dokumencie |
| `incomingShipmentId` | uuid | nie | link do przesyłki |
| `folderId` | uuid | nie | link do koszulki |
| `caseId` | uuid | nie | link do sprawy |

## Koszulka

| Pole | Typ | Wymagane | Uwagi |
|---|---|---:|---|
| `title` | string | tak | nazwa koszulki |
| `caseId` | uuid | nie | ustawiane po konwersji |

## Sprawa

| Pole | Typ | Wymagane | Uwagi |
|---|---|---:|---|
| `caseRegisterId` | uuid | tak | spis spraw |
| `jrwaClassId` | uuid | tak | JRWA |
| `sign` | string | nie | znak sprawy; zasady generacji do dopięcia |
| `folderId` | uuid | nie | jeśli sprawa z koszulki |

## Spis spraw

| Pole | Typ | Wymagane | Uwagi |
|---|---|---:|---|
| `name` | string | tak | nazwa spisu |
| `year` | number | nie | jeśli numeracja roczna |
| `jrwaClassId` | uuid | nie | jeśli spis per JRWA |

## JRWA (klasa)

| Pole | Typ | Wymagane | Uwagi |
|---|---|---:|---|
| `symbol` | string | tak | np. „WD-9821” (robocze) |
| `title` | string | tak | hasło klasy |
| `parentId` | uuid | nie | drzewo |
| `retentionCategory` | enum | nie | A/B/BE (robocze) |
| `retentionYears` | number | nie | |

## Skład chronologiczny: lokalizacja

| Pole | Typ | Wymagane | Uwagi |
|---|---|---:|---|
| `code` | string | tak | identyfikator miejsca |
| `description` | string | nie | opis |

## Historia lokalizacji (przypisania)

| Pole | Typ | Wymagane | Uwagi |
|---|---|---:|---|
| `documentId` | uuid | tak | |
| `locationId` | uuid | tak | |
| `validFrom` | datetime | tak | |
| `validTo` | datetime | nie | null = aktualne |
| `note` | string | nie | |
