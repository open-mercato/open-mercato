# Sales Entities DI Registration

## TLDR

Register all sales module MikroORM entities in the Awilix DI container so external modules can resolve them via `container.resolve('SalesQuote')` (and other sales entities) without direct import coupling.

## Overview

The sales module's `di.ts` previously registered only three entities: `SalesOrder`, `SalesChannel`, and `SalesShipment`. The remaining 14 entities (`SalesQuote`, `SalesInvoice`, `SalesCreditMemo`, `SalesPayment`, `SalesReturn`, `SalesOrderLine`, `SalesQuoteLine`, `SalesNote`, `SalesDocumentAddress`, `SalesDocumentTag`, `SalesShippingMethod`, `SalesDeliveryWindow`, `SalesPaymentMethod`, `SalesTaxRate`) were inaccessible via DI resolution.

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
| `SalesQuote` | `SalesQuote` |
| `SalesInvoice` | `SalesInvoice` |
| `SalesCreditMemo` | `SalesCreditMemo` |
| `SalesPayment` | `SalesPayment` |
| `SalesReturn` | `SalesReturn` |
| `SalesOrderLine` | `SalesOrderLine` |
| `SalesQuoteLine` | `SalesQuoteLine` |
| `SalesNote` | `SalesNote` |
| `SalesDocumentAddress` | `SalesDocumentAddress` |
| `SalesDocumentTag` | `SalesDocumentTag` |
| `SalesShippingMethod` | `SalesShippingMethod` |
| `SalesDeliveryWindow` | `SalesDeliveryWindow` |
| `SalesPaymentMethod` | `SalesPaymentMethod` |
| `SalesTaxRate` | `SalesTaxRate` |

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

- **2026-05-17** — Initial implementation: registered all 14 previously missing sales entities in `di.ts`.
