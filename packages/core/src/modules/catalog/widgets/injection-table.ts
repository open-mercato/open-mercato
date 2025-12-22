import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Catalog module injection table
 * Maps injection spot IDs to widget IDs for automatic widget injection
 */
export const injectionTable: ModuleInjectionTable = {
  // Inject the SEO helper widget into the catalog product CRUD form
  'crud-form:catalog.product': 'catalog.injection.product-seo',
  // Fallback alias when forms derive spot id from entity id
  'crud-form:catalog.catalog_product': 'catalog.injection.product-seo',
}

export default injectionTable
