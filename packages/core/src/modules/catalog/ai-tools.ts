/**
 * Module-root AI tool contribution for the catalog module
 * (Phase 1 WS-C, Steps 3.10 + 3.11 + 3.12 — read-only Phase 1 coverage).
 *
 * The generator walks every module for a top-level `ai-tools.ts` and takes
 * the default/`aiTools` export as the contribution. This file aggregates the
 * eight catalog packs (products, categories, variants, prices + offers,
 * media + tags, product configuration, D18 merchandising, D18 authoring)
 * so they all flow through the existing `ai-tools.generated.ts` pipeline
 * without any generator changes.
 *
 * Mutation tools are deferred to Step 5.14 under the pending-action contract;
 * every tool here is read-only and enforces tenant + organization scoping via
 * the existing encryption helpers. The Step 3.12 authoring tools are
 * structured-output helpers: they NEVER write and never open a second model
 * call from inside the handler — the surrounding agent turn performs
 * structured output against the handler's `outputSchemaDescriptor`.
 *
 * Step 3.11 (D18) adds the seven spec-named read tools in
 * `merchandising-pack.ts`:
 * - `catalog.search_products`
 * - `catalog.get_product_bundle`
 * - `catalog.list_selected_products`
 * - `catalog.get_product_media`
 * - `catalog.get_attribute_schema`
 * - `catalog.get_category_brief`
 * - `catalog.list_price_kinds`
 *
 * Step 3.12 (D18) adds the five spec-named AI-authoring tools in
 * `authoring-pack.ts`:
 * - `catalog.draft_description_from_attributes`
 * - `catalog.extract_attributes_from_description`
 * - `catalog.draft_description_from_media`
 * - `catalog.suggest_title_variants`
 * - `catalog.suggest_price_adjustment`
 *
 * `catalog.list_price_kinds` (D18) and `catalog.list_price_kinds_base` (base)
 * coexist as distinct tools — both route through the shared `listPriceKindsCore`
 * helper in `ai-tools/_shared.ts` so they cannot drift.
 *
 * See `.ai/runs/2026-04-18-ai-framework-unification/step-3.10-checks.md`,
 * `step-3.11-checks.md`, and `step-3.12-checks.md` for the matrix of
 * required features and decisions.
 */
import productsAiTools from './ai-tools/products-pack'
import categoriesAiTools from './ai-tools/categories-pack'
import variantsAiTools from './ai-tools/variants-pack'
import pricesOffersAiTools from './ai-tools/prices-offers-pack'
import mediaTagsAiTools from './ai-tools/media-tags-pack'
import configurationAiTools from './ai-tools/configuration-pack'
import merchandisingAiTools from './ai-tools/merchandising-pack'
import authoringAiTools from './ai-tools/authoring-pack'
import type { CatalogAiToolDefinition } from './ai-tools/types'

export const aiTools: CatalogAiToolDefinition[] = [
  ...productsAiTools,
  ...categoriesAiTools,
  ...variantsAiTools,
  ...pricesOffersAiTools,
  ...mediaTagsAiTools,
  ...configurationAiTools,
  ...merchandisingAiTools,
  ...authoringAiTools,
]

export default aiTools
