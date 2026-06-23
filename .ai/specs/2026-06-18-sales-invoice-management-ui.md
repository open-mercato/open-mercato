# Sales Invoice Management UI

## TLDR

Adds backend sales invoice list/detail pages and an order detail invoice tab. Users can create one full invoice from an order, open invoice details, review lines/totals/source order links, update the invoice status from the invoice detail page, and avoid duplicate invoices for the same order.

## Overview

The sales module already exposes invoice entities and commands, but backend users have no dedicated invoice browsing surface and cannot create invoices from the order detail workflow. This feature closes that UI gap while reusing the existing sales invoice command/API contract and preserving the quote -> order -> invoice flow.

## Problem Statement

Sales orders can progress to invoices, but the backend order detail page only exposes adjacent shipment, payment, and return workflows. Without an invoice tab or invoice pages, users cannot discover existing invoices from an order, create a full invoice from order lines, or inspect invoice lines and outstanding totals in the backend UI.

## Proposed Solution

- Add `/backend/sales/invoices` as a DataTable list for invoice number, status, source order, dates, total, and outstanding amount.
- Add `/backend/sales/invoices/[id]` as a detail page with header metadata, invoice status update action, line items, totals, source order navigation, and delete action.
- Add an `Invoices` tab on order detail pages only.
- Create one full invoice from current order lines and totals via the existing invoice command endpoint.
- Disable duplicate creation once the order already has an invoice.
- Add `GET /api/sales/invoices/[id]` for invoice header and line details.

## Architecture

The UI lives in `packages/core/src/modules/sales/components/documents/` and backend route files under `packages/core/src/modules/sales/backend/sales/invoices/`.

The order detail page integrates `SalesDocumentInvoicesSection` only for `kind === 'order'`. The section loads invoices through `GET /api/sales/invoices?orderId=<id>`, builds a create payload from the order and order-line APIs, posts it to `/api/sales/invoices`, then redirects to the invoice detail route.

Invoice writes remain command-backed. The create command resolves order and order-line MikroORM relations before persistence so invoice headers and lines retain the source-order linkage.

Invoice status updates use the existing invoice update API from the invoice detail page. The action sends the current invoice `updatedAt` optimistic-lock value and reloads the canonical invoice detail response after a successful save so the status badge, select value, and list readback stay aligned with persisted state.

## Data Models

No database schema changes are required.

The implementation uses existing `SalesInvoice` and `SalesInvoiceLine` entities. The invoice command now writes the `order` and `orderLine` relation properties instead of assigning non-existent scalar relation fields.

## API Contracts

### Existing API

- `GET /api/sales/invoices`
- `POST /api/sales/invoices`
- `PUT /api/sales/invoices`
- `DELETE /api/sales/invoices`

The list API remains backwards compatible and now normalizes camelCase aliases for UI consumers while preserving existing fields.

### New API

- `GET /api/sales/invoices/[id]`

Returns:

```jsonc
{
  "invoice": {
    "id": "uuid",
    "orderId": "uuid|null",
    "invoiceNumber": "INV-...",
    "status": "draft",
    "currencyCode": "EUR",
    "grandTotalGrossAmount": "123.0000",
    "outstandingAmount": "123.0000",
    "updatedAt": "ISO|null"
  },
  "lines": [
    {
      "id": "uuid",
      "orderLineId": "uuid|null",
      "lineNumber": 1,
      "name": "Item",
      "quantity": "1.0000",
      "currencyCode": "EUR",
      "totalGrossAmount": "123.0000"
    }
  ]
}
```

## UI Paths

- `/backend/sales/invoices`
- `/backend/sales/invoices/[id]`
- `/backend/sales/documents/[id]?kind=order` invoice tab

## Migration & Backward Compatibility

- The API change is additive: `GET /api/sales/invoices/[id]` is a new detail route, and existing invoice list/create/update/delete routes remain available.
- Invoice list normalization adds camelCase aliases for UI consumers while preserving existing response fields.
- New backend invoice pages and page metadata add auto-discovered routes; no existing backend routes, page metadata exports, or route conventions are renamed or removed.
- No database schema changes or migrations are required.
- ACL usage stays on the existing `sales.invoices.manage` feature; no new feature IDs are introduced.

## Integration Coverage

- API route tests cover invoice route exports and the new invoice detail route metadata/OpenAPI export.
- Command tests cover draft defaulting and persisted order/order-line relations.
- Component tests cover invoice status selection, optimistic-lock update headers, success messaging, and invoice detail readback after saving.
- Playwright integration `TC-SALES-032` covers invoice create/read/delete and invalid source order handling.

## Risks & Impact Review

- **Duplicate invoice semantics:** The create command rejects a second invoice for the same order. This protects the UI's one-full-invoice behavior but may need future expansion for partial invoices.
- **Money/order flow impact:** Invoice creation touches sales totals and source order linkage. Mitigation: reuse existing totals from the order and preserve command-backed writes.
- **ACL impact:** Invoice pages and detail API require `sales.invoices.manage`, matching existing invoice route behavior.
- **UI evidence:** The PR should remain draft until a screenshot or recording is attached, or the PR body clearly says screenshots or recording are pending before review.

## Final Compliance Report

- No schema migration required.
- User-facing strings are in sales locale dictionaries.
- New backend pages have `page.meta.ts` guards.
- New API route exports `openApi`.
- Invoice delete actions send optimistic-lock headers from `updatedAt`.
- Invoice status updates send optimistic-lock headers from `updatedAt` and reload invoice detail readback after saving.
- Tests added for command/API behavior, invoice status updates, and invoice integration flow.
- QA follow-up covers localized invoice status labels, consistent money/date display, readable invoice identifiers, source-order link propagation, duplicate invoice prevention, and non-blocking backend feedback UI.

## Changelog

- 2026-06-18: Added the invoice management UI spec for sales invoice list/detail pages and order-detail invoice creation.
- 2026-06-19: Added migration and backward compatibility notes for the upstream contribution review gate.
- 2026-06-19: Added QA follow-up notes for invoice display polish, source-order navigation, and backend feedback prompt behavior.
- 2026-06-23: Added invoice detail status update coverage with optimistic-lock save and canonical readback.
