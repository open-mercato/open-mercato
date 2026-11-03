import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

// Replaces the free-text `customerGroupId` input on the catalog price editor.
// The sales tax-rate form is intentionally not targeted: `TaxRatesSettings`
// renders its `CrudForm` without an `entityId`, so a
// `crud-form:sales.sales_tax_rate:fields` entry would never resolve.
export const injectionTable: ModuleInjectionTable = {
  'crud-form:catalog.catalog_product_price:fields': [
    {
      widgetId: 'customer_groups.injection.group-picker-field',
      priority: 100,
    },
  ],
  // Membership tab on the customer/person and company detail pages (Step 1.9) —
  // mirrors `warranty_claims/widgets/injection-table.ts`'s identical two-entity
  // mapping for its own customer-facing tab.
  'detail:customers.person:tabs': [
    {
      widgetId: 'customer_groups.injection.person-groups-tab',
      kind: 'tab',
      groupLabel: 'customer_groups.groups.personTab.title',
      priority: 45,
    },
  ],
  'detail:customers.company:tabs': [
    {
      widgetId: 'customer_groups.injection.person-groups-tab',
      kind: 'tab',
      groupLabel: 'customer_groups.groups.personTab.title',
      priority: 45,
    },
  ],
}

export default injectionTable
