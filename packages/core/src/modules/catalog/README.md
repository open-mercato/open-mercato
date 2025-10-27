# Catalog Module

The catalog module exposes reusable product definitions that feed sales flows. It keeps product entities isolated from order/quote storage so sales documents can snapshot catalog data without creating cross-module dependencies.

## Entities

- **CatalogProduct** – Scope aware product master record (name, code, status, default currency/unit, channel availability, metadata).
- **CatalogProductVariant** – SKU-level configuration with weight/dimensions metadata and variant specific pricing associations.
- **CatalogProductOption**/**CatalogProductOptionValue** – Configurable option definitions used to construct variant matrices or runtime configuration choices.
- **CatalogVariantOptionValue** – Junction storing the selected option values for each variant.
- **CatalogProductPrice** – Tiered prices by currency/kind (list, sale, tier, custom) with optional validity windows and inferred tax context.

All MikroORM relations remain intra-module; cross-module references are exposed as plain UUID strings so sales/order modules can link without foreign key constraints.

## Validation

`data/validators.ts` provides zod schemas that align with the entity model:

- Scoped helpers enforce `{ organizationId, tenantId }` on every payload.
- Product, variant, option, and price schemas normalise codes (lowercase slug-style) and accept ISO currency codes.
- Option configuration arrays enable command handlers to persist `CatalogVariantOptionValue` assignments.

Types exported from the validators are intended for command handlers, CRUD factories, and UI forms.

## Custom Fields

`ce.ts` registers catalog product, variant, and option custom-field containers. These IDs power the global EAV storage so users can extend catalog records without schema changes.

## Access Control

`acl.ts` surfaces feature toggles for catalog operations (`catalog.products.view`, `catalog.options.manage`, etc.). Downstream APIs and pages can declare `requireFeatures` metadata against these identifiers.

## Internationalisation

The module ships with `i18n/{en,pl,es,de}.json` placeholders for navigation and UI grouping. New UI should extend these dictionaries instead of hardcoding labels.

## Extensibility Notes

- Keep calculators/pricing logic small and colocated under `lib/` so the sales module can reuse them.
- When sales documents need product snapshots, copy the relevant fields (`name`, `sku`, pricing) onto the document line to avoid runtime joins.
- Future product catalogue features (attributes, bundling, channels) should continue leveraging option/variant primitives to avoid proliferating table types.
