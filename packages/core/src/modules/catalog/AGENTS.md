# Catalog Module — Agent Guidelines

The catalog module manages products, categories, pricing, variants, and offers.

## Data Model

- **Products** — core product entities with media, descriptions
- **Categories** — hierarchical product categorization
- **Variants** — product variations (size, color, etc.)
- **Prices** — multi-tier pricing with channel scoping
- **Price Kinds** — pricing tier definitions
- **Offers** — time-limited promotional pricing
- **Option Schemas** — variant option definitions
- **Product Media** — images and files attached to products
- **Tags** — categorization labels

## Pricing System

### Multi-Strategy Pricing

All pricing must use the helpers from `lib/pricing.ts`:

- `selectBestPrice` — resolve the best price for a given context
- `resolvePriceVariantId` — find the correct variant-level price
- Layered overrides with channel scoping and priority resolution

### Custom Pricing Resolvers

```typescript
import { registerCatalogPricingResolver } from '@open-mercato/core/modules/catalog/lib/pricing'

// Register with priority (higher = checked first)
registerCatalogPricingResolver(myResolver, { priority: 10 })
```

The default pipeline emits `catalog.pricing.resolve.before|after` events. Use the DI token `catalogPricingService` when resolving prices so overrides take effect.

### Rules

- **Never reimplement pricing logic** — use `selectBestPrice` and the resolver pipeline
- Price layers compose: base price → channel override → customer-specific → promotional
- Channel scoping filters which prices are visible

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `api/` | CRUD routes (products, categories, variants, prices, offers, etc.) |
| `backend/` | Admin pages (product management, config) |
| `commands/` | Undoable product/price commands |
| `components/` | Product forms, category tree, price editors |
| `data/` | ORM entities and validators |
| `lib/` | Pricing engine, business logic |
| `seed/` | Example products for `seedExamples` |
| `services/` | Domain services |
| `subscribers/` | Event subscribers (indexing, cache invalidation) |
| `widgets/injection/` | Injected widgets for cross-module UI |

## Widget Injection

The catalog module injects widgets into other modules (e.g., product selectors in sales forms). Widgets are in `widgets/injection/` and mapped via `injection-table.ts`.

## Events

Catalog events follow the standard pattern in `events.ts`. Key events:
- `catalog.product.created/updated/deleted` — CRUD events
- `catalog.pricing.resolve.before/after` — pricing lifecycle (excluded from workflow triggers)
