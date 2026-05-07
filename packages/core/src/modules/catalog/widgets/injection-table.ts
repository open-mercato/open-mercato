import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Catalog module injection table
 * Maps injection spot IDs to widget IDs for automatic widget injection
 */
export const injectionTable: ModuleInjectionTable = {
  // Inject the SEO helper widget into the catalog product CRUD form
  'crud-form:catalog.product': [
    {
      widgetId: 'catalog.injection.product-seo',
      kind: 'group',
      column: 2,
      groupLabel: 'catalog.widgets.productSeo.groupLabel',
      groupDescription: 'catalog.widgets.productSeo.groupDescription',
      priority: 50,
    },
  ],
  // Fallback alias when forms derive spot id from entity id
  'crud-form:catalog.catalog_product': 'catalog.injection.product-seo',
  'data-table:catalog.products:bulk-actions': {
    widgetId: 'catalog.injection.product-bulk-delete',
    priority: 40,
  },
  'data-table:catalog.products.list:bulk-actions': {
    widgetId: 'catalog.injection.product-bulk-delete',
    priority: 40,
  },
  // Step 5.15 — Phase 3 WS-D.
  // Merchandising assistant trigger moved behind the injection system so the
  // products list page no longer imports `MerchandisingAssistantSheet`
  // directly. The DataTable's `injectionSpotId="data-table:catalog.products"`
  // exposes the `:search-trailing` variant that this widget targets — the
  // round icon-only trigger lives next to the products list search input.
  'data-table:catalog.products:search-trailing': [
    {
      widgetId: 'catalog.injection.merchandising-assistant-trigger',
      priority: 100,
    },
  ],
}

export default injectionTable
