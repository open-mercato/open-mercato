/**
 * Module-root AI tool contribution for the catalog module
 * (Phase 1 WS-C, Step 3.10 — read-only Phase 1 base coverage).
 *
 * The generator walks every module for a top-level `ai-tools.ts` and takes
 * the default/`aiTools` export as the contribution. This file aggregates the
 * six catalog packs (products, categories, variants, prices + offers,
 * media + tags, product configuration) so they all flow through the existing
 * `ai-tools.generated.ts` pipeline without any generator changes.
 *
 * Mutation tools are deferred to Step 5.14 under the pending-action contract;
 * every tool here is read-only and enforces tenant + organization scoping via
 * the existing encryption helpers. D18 merchandising-specific read tools
 * (`catalog.search_products`, `catalog.get_product_bundle`,
 * `catalog.list_selected_products`, `catalog.get_product_media`,
 * `catalog.get_attribute_schema`, `catalog.get_category_brief`,
 * `catalog.list_price_kinds`) are Step 3.11 scope and add alongside these
 * base tools. The base price-kinds enumerator intentionally uses the
 * distinct name `catalog.list_price_kinds_base` to leave the D18 name
 * available for that Step.
 *
 * See `.ai/runs/2026-04-18-ai-framework-unification/step-3.10-checks.md`
 * for the matrix of required features and decisions.
 */
import productsAiTools from './ai-tools/products-pack'
import categoriesAiTools from './ai-tools/categories-pack'
import variantsAiTools from './ai-tools/variants-pack'
import pricesOffersAiTools from './ai-tools/prices-offers-pack'
import mediaTagsAiTools from './ai-tools/media-tags-pack'
import configurationAiTools from './ai-tools/configuration-pack'
import type { CatalogAiToolDefinition } from './ai-tools/types'

export const aiTools: CatalogAiToolDefinition[] = [
  ...productsAiTools,
  ...categoriesAiTools,
  ...variantsAiTools,
  ...pricesOffersAiTools,
  ...mediaTagsAiTools,
  ...configurationAiTools,
]

export default aiTools
