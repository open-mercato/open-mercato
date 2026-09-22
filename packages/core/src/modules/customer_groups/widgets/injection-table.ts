import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

// Same widget, two spots — mirrors
// `packages/core/src/modules/wms/widgets/injection-table.ts` mapping
// `wms.injection.catalog-inventory-profile` to both
// `crud-form:catalog.product:fields` and
// `crud-form:catalog.catalog_product_variant:fields`.
//
// `crud-form:sales.sales_tax_rate:fields` is declared for spec compliance but
// currently INERT: `sales/components/TaxRatesSettings.tsx` renders its
// `CrudForm` without an `entityId`, so that host never resolves this spot at
// all (see the widget's own doc comment). This module never edits that sales
// file per the hard "catalog/sales off-limits" constraint on this task; wiring
// `entityId={E.sales.sales_tax_rate}` + a `customerGroupId` field there is a
// follow-up that needs an explicit ask (it touches `sales/`).
export const injectionTable: ModuleInjectionTable = {
  'crud-form:catalog.catalog_product_price:fields': [
    {
      widgetId: 'customer_groups.injection.group-picker-field',
      priority: 100,
    },
  ],
  'crud-form:sales.sales_tax_rate:fields': [
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
