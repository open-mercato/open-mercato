# Sales Entities DI Registration

## TLDR

Register the full set of externally-useful sales module MikroORM entities in the Awilix DI container so external modules can resolve them via `container.resolve('SalesQuote')` (and other sales entities) without direct import coupling. Two internal-only entities (`SalesSettings`, `SalesDocumentSequence`) are intentionally excluded.

## Overview

The sales module's `di.ts` previously registered only three entities: `SalesOrder`, `SalesChannel`, and `SalesShipment`. 22 of the remaining 24 entities were inaccessible via DI resolution. This change registers all externally-useful entities, leaving out only two internal-only entities that have no valid external consumer use case (see Intentional Exclusions below).

## Problem Statement

Modules that need to reference sales entities for cross-module queries (e.g. `inbox_ops`, integrations, AI tools) had two options:

1. **Direct import** — `import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'` — creates hard compile-time coupling between modules, violating the module isolation principle.
2. **Silent failure** — `container.resolve('SalesQuote')` would throw and be swallowed by the `try/catch` in `createRequestContainer`, returning `undefined` at runtime with no diagnostic signal.

The pattern already established for `SalesOrder` (used in `inbox_ops/api/routeHelpers.ts`) was not extended to the remaining entities.

## Proposed Solution

Register all sales module entities as `asValue(...)` entries in `packages/core/src/modules/sales/di.ts`. This is consistent with how `SalesOrder`, `SalesChannel`, and `SalesShipment` were already handled.

### File Changed

`packages/core/src/modules/sales/di.ts`

### Entities Added to DI

| DI Key | Entity Class |
|--------|-------------|
| `SalesOrderLine` | `SalesOrderLine` |
| `SalesOrderAdjustment` | `SalesOrderAdjustment` |
| `SalesQuote` | `SalesQuote` |
| `SalesQuoteLine` | `SalesQuoteLine` |
| `SalesQuoteAdjustment` | `SalesQuoteAdjustment` |
| `SalesShipmentItem` | `SalesShipmentItem` |
| `SalesInvoice` | `SalesInvoice` |
| `SalesInvoiceLine` | `SalesInvoiceLine` |
| `SalesCreditMemo` | `SalesCreditMemo` |
| `SalesCreditMemoLine` | `SalesCreditMemoLine` |
| `SalesPayment` | `SalesPayment` |
| `SalesPaymentAllocation` | `SalesPaymentAllocation` |
| `SalesReturn` | `SalesReturn` |
| `SalesReturnLine` | `SalesReturnLine` |
| `SalesNote` | `SalesNote` |
| `SalesDocumentAddress` | `SalesDocumentAddress` |
| `SalesDocumentTag` | `SalesDocumentTag` |
| `SalesDocumentTagAssignment` | `SalesDocumentTagAssignment` |
| `SalesShippingMethod` | `SalesShippingMethod` |
| `SalesDeliveryWindow` | `SalesDeliveryWindow` |
| `SalesPaymentMethod` | `SalesPaymentMethod` |
| `SalesTaxRate` | `SalesTaxRate` |

### Intentional Exclusions

| Entity | Reason |
|--------|--------|
| `SalesSettings` | Singleton per-tenant config row — no valid external consumer; accessed via `salesSettingsService` |
| `SalesDocumentSequence` | Internal numbering counter — managed exclusively by `SalesDocumentNumberGenerator` |

### Usage Pattern (unchanged)

```typescript
// External module — no direct import needed
try {
  const SalesQuote = container.resolve('SalesQuote')
  const quote = await em.findOne(SalesQuote, { id, tenantId })
} catch {
  // sales module not available
}
```

## Architecture

No architectural changes. This is an additive registration — Awilix `asValue(EntityClass)` stores the class constructor as a static value. No lifecycle implications (no `.singleton()`, no `.scoped()`).

The DI container for the sales module is built once per request in `createRequestContainer()` via the `diRegistrars` loop (`packages/shared/src/lib/di/container.ts:59`).

## Risks & Impact Review

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Name collision with another module's DI key | Low | `Sales*` prefix is unique across the codebase; no conflicts found |
| Increased container size per request | Negligible | `asValue` stores a reference, not an instance — 14 extra pointer registrations |
| Breaking change for callers expecting `undefined` on resolve | None | Previously threw (caught silently); now resolves correctly |

## Backward Compatibility

Additive-only change. No existing `resolve('Sales*')` calls return different types — they previously failed silently and now succeed. No API, schema, or event contract changes.

## Changelog

- **2026-05-18** — Follow-up: added 7 overlooked child entities (`SalesOrderAdjustment`, `SalesQuoteAdjustment`, `SalesShipmentItem`, `SalesInvoiceLine`, `SalesCreditMemoLine`, `SalesReturnLine`, `SalesPaymentAllocation`) after code review; added `SalesDocumentTagAssignment` (junction table needed for tag queries); updated intentional exclusions to `SalesSettings` and `SalesDocumentSequence` only.
- **2026-05-17** — Initial implementation: registered 14 previously missing sales entities in `di.ts`.
