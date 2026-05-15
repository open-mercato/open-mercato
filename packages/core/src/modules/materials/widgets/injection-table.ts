import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Materials module — widget injection mapping.
 *
 * Two new spots introduced in Phase 1 (per spec — both additive, BC-safe per surface #6):
 *
 *  - `page:catalog.product.sidebar` — consumed by catalog/backend/catalog/products/[id]/page.tsx.
 *    Hosts a "Linked material" panel. Wiring (`<InjectionSpot spotId="page:catalog.product.sidebar" />`)
 *    in the catalog product detail page is a small follow-up that touches the catalog module.
 *
 *  - `page:customers.company.tabs` — consumed by customers/backend/customers/companies/[id]/page.tsx.
 *    Hosts a "Supplied materials" tab. Same wiring caveat — needs a separate small commit
 *    in the customers module.
 *
 * Visibility for both widgets is gated by the materials.widgets.* feature flags (declared
 * in acl.ts); the widget components consult `hasFeature` from `@open-mercato/shared/security/features`
 * so wildcard grants like `materials.*` are respected.
 */
export const injectionTable: ModuleInjectionTable = {
  'page:catalog.product.sidebar': [
    {
      widgetId: 'materials.injection.catalog-product-sidebar.linked-material',
      priority: 30,
    },
  ],
  'page:customers.company.tabs': [
    {
      widgetId: 'materials.injection.customer-company-tabs.supplied-materials',
      priority: 30,
    },
  ],
}

export default injectionTable
