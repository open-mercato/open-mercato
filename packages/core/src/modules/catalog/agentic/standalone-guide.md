# Catalog Module — Standalone App Guide

Use the catalog module for products, categories, pricing, variants, and offers.

## Pricing System

Never reimplement pricing logic. Use the catalog pricing service via DI:

```typescript
const pricingService = container.resolve('catalogPricingService')
```

- `selectBestPrice` — finds the best price for a given context (customer, channel, quantity)
- `resolvePriceVariantId` — resolves variant-level prices
- Register custom pricing resolvers with priority (higher = checked first):

```typescript
import { registerCatalogPricingResolver } from '@open-mercato/core/modules/catalog/lib/pricing'
registerCatalogPricingResolver(myResolver, { priority: 10 })
```

Price layers compose in order: base price → channel override → customer-specific → promotional.

The pipeline emits `catalog.pricing.resolve.before` and `catalog.pricing.resolve.after` events that your module can subscribe to.

## Data Model

| Entity | Purpose | Key Constraints |
|--------|---------|----------------|
| **Products** | Core items with media and descriptions | MUST have at least a name |
| **Categories** | Hierarchical product grouping | No circular parent-child references |
| **Variants** | Product variations (size, color) | MUST reference valid option schemas |
| **Prices** | Multi-tier with channel scoping | Use `selectBestPrice` for resolution |
| **Offers** | Time-limited promotions | MUST have valid date ranges |
| **Option Schemas** | Variant option type definitions | Cannot delete while variants reference them |

## Subscribing to Catalog Events

React to product lifecycle events in your module:

```typescript
// src/modules/<your_module>/subscribers/product-updated.ts
export const metadata = {
  event: 'catalog.product.updated',
  persistent: true,
  id: 'your-module-product-updated',
}

export default async function handler(payload, ctx) {
  // payload.resourceId = product ID
}
```

Key events:
- `catalog.product.created` / `updated` / `deleted`
- `catalog.pricing.resolve.before` / `after` (excluded from workflow triggers)

## Extending Catalog UI

Use widget injection to add your module's UI into catalog pages:

```typescript
// src/modules/<your_module>/widgets/injection-table.ts
export const widgetInjections = {
  'crud-form:catalog.catalog_product:fields': {
    widgetId: 'your-module-product-fields',
    priority: 100,
  },
}
```

Common injection spots:
- `crud-form:catalog.catalog_product:fields` — product edit form
- `data-table:catalog.products:columns` — product list columns
- `data-table:catalog.products:row-actions` — product row actions

## Using Catalog in Sales

When building sales-related features, use the catalog pricing service to resolve prices rather than reading price entities directly. This ensures channel scoping, customer-specific pricing, and promotional offers are applied correctly.
