---
title: Przykłady Pakiet A/B
sidebar_position: 80
---

Ten dokument zawiera przykłady payloadów, które pomagają walidować model danych.

## Pakiet A: utworzenie przesyłki wpływającej

Przykład (roboczy):

```json
{
  "senderAnonymous": false,
  "senderDisplayName": "Bartłomiej Wisłoka, ul. Staffa 4A, 39-300 Mielec",
  "receivedAt": "2025-04-14",
  "deliveryMethod": "in_person",
  "postedAt": "2025-04-14",
  "senderReference": "NUMER_POCZTY_123",
  "remarks": "dowolne",
  "documentDate": "2025-04-12",
  "noDocumentDate": false,
  "documentSign": "WD-9821/21/2025",
  "noDocumentSign": false,
  "accessLevel": "restricted",
  "hasChronologicalRegistration": true,
  "mappingCoverage": "partial"
}
```

## Dokument w przesyłce (podpięty do przesyłki)

```json
{
  "incomingShipmentId": "24f66b31-b198-4099-8332-e261612ccd9c",
  "title": "organizacja archiwum zakladowego.pdf",
  "kind": "pismo",
  "accessLevel": "non_public",
  "receivedAt": "2025-04-14",
  "documentDate": "2025-04-12",
  "documentSign": "WD-9821/21/2025"
}
```

## Dokument „przyniesiony” (bez przesyłki)

```json
{
  "title": "notatka służbowa",
  "kind": "notatka",
  "accessLevel": "non_public",
  "documentDate": "2026-01-23"
}
```

## Pakiet B

Pakiet B wymaga doprecyzowania.

Minimalny zakres do opisania w kolejnej iteracji:

- jakie pola są wymagane przy przekazaniu do archiwum,
- jakie są zależności od JRWA/retencji,
- czy Pakiet B operuje na sprawie, czy na spisie zdawczo‑odbiorczym.
