# Catalog Module — Agent Guidelines

Use the catalog module for products, categories, pricing, variants, and offers.

## MUST Rules

1. **MUST NOT reimplement pricing logic** — use `selectBestPrice` and the resolver pipeline from `lib/pricing.ts`
2. **MUST use the DI token `catalogPricingService`** when resolving prices — ensures overrides take effect
3. **MUST register custom pricing resolvers** with explicit priority (`registerCatalogPricingResolver(resolver, { priority })`)
4. **MUST declare widget injections** in `widgets/injection/` and map via `injection-table.ts`
5. **MUST follow the standard event pattern** in `events.ts` for all CRUD and lifecycle events

## When You Need Pricing Logic

1. Resolve `catalogPricingService` from DI
2. Use `selectBestPrice` to find the best price for a context
3. Use `resolvePriceVariantId` to find variant-level prices
4. Register custom resolvers with priority (higher = checked first)

Price layers compose in order: base price → channel override → customer-specific → promotional.

```typescript
import { registerCatalogPricingResolver } from '@open-mercato/core/modules/catalog/lib/pricing'
registerCatalogPricingResolver(myResolver, { priority: 10 })
```

The default pipeline emits `catalog.pricing.resolve.before|after` events.

## Data Model Constraints

- **Products** — core entities with media and descriptions. MUST have at least a name
- **Categories** — hierarchical. MUST maintain parent-child integrity (no circular references)
- **Variants** — linked to products via `product_id`. MUST reference valid option schemas
- **Prices** — multi-tier with channel scoping. MUST use `selectBestPrice` for resolution
- **Offers** — time-limited promotional pricing. MUST have valid date ranges
- **Option Schemas** — define variant option types. MUST NOT be deleted while variants reference them

## Adding a New Catalog Entity

1. Define the ORM entity in `data/entities.ts`
2. Create validators in `data/validators.ts`
3. Add CRUD routes in `api/` with `openApi` export
4. Add events to `events.ts`
5. Create backend admin pages in `backend/`
6. Run `yarn db:generate` for migrations, then `yarn generate`

## Key Directories

| Directory | When to modify |
|-----------|---------------|
| `api/` | When adding/modifying CRUD routes (products, categories, variants, prices, offers) |
| `backend/` | When changing admin pages (product management, config) |
| `commands/` | When adding undoable product/price operations |
| `components/` | When modifying product forms, category tree, price editors |
| `data/` | When changing ORM entities or validators |
| `lib/` | When modifying the pricing engine or business logic |
| `seed/` | When updating example products for `seedExamples` |
| `services/` | When adding/modifying domain services |
| `subscribers/` | When adding event subscribers (indexing, cache invalidation) |
| `widgets/injection/` | When injecting widgets into other modules (e.g., product selectors in sales) |

## Events

Key events follow the standard pattern in `events.ts`:
- `catalog.product.created/updated/deleted` — CRUD events
- `catalog.pricing.resolve.before/after` — pricing lifecycle (excluded from workflow triggers)

## AI Agents in This Module

Two typed AI agents ship from `ai-agents.ts`. See `/framework/ai-assistant/agents` for the full guide. Copy `packages/core/src/modules/customers/ai-agents.ts` + `ai-tools.ts` first; use this module's agents as the catalog-specific reference.

| Agent ID | Mode | Policy | Purpose |
|----------|------|--------|---------|
| `catalog.catalog_assistant` | chat | `read-only` | General operator explorer for products, categories, variants, prices, offers, product media, tags, option schemas, and unit conversions via the base catalog tool pack + general-purpose packs. |
| `catalog.merchandising_assistant` | chat | `read-only` (mutation-capable via per-tenant override unlocking `catalog.update_product`, `catalog.bulk_update_products`, `catalog.apply_attribute_extraction`, `catalog.update_product_media_descriptions`) | D18 demo agent: proposes descriptions, attribute extractions, title variants, and price adjustments for the current selection on the products list page. |

The merchandising assistant is the Phase 2 D18 demo. `<AiChat agent="catalog.merchandising_assistant" />` is injected via `MerchandisingAssistantSheet.tsx` on `/backend/catalog/catalog/products` (see `packages/core/src/modules/catalog/backend/catalog/products/page.tsx`). Mutation-capable authoring tools route through `prepareMutation` + the approval-card contract; confirmed batches refresh the DataTable via `catalog.product.updated` events on the DOM event bridge.
