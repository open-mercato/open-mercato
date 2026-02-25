import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Example module injection table
 * Maps injection spot IDs to widget IDs for automatic widget injection
 */
export const injectionTable: ModuleInjectionTable = {
  // Inject the validation widget into the catalog product CRUD form
  'crud-form:catalog.product': 'example.injection.crud-validation',
  'crud-form:catalog.catalog_product': 'example.injection.crud-validation',

  // Can also inject into variant form
  'crud-form:catalog.variant': 'example.injection.crud-validation',
  'crud-form:catalog.catalog_variant': 'example.injection.crud-validation',

  // Add example todos tab to sales quote/order detail pages
  'sales.document.detail.quote:tabs': [
    {
      widgetId: 'example.injection.sales-todos',
      kind: 'tab',
      groupLabel: 'example.salesTodos.tabLabel',
      priority: -10,
    },
  ],
  'sales.document.detail.order:tabs': [
    {
      widgetId: 'example.injection.sales-todos',
      kind: 'tab',
      groupLabel: 'example.salesTodos.tabLabel',
      priority: -10,
    },
  ],

  // Catalog products table header: quick SEO health report
  'data-table:catalog.products:header': {
    widgetId: 'example.injection.catalog-seo-report',
    kind: 'stack',
    priority: 5,
  },
  'menu:sidebar:main': {
    widgetId: 'example.injection.example-menus',
    priority: 50,
  },
  'menu:topbar:actions': {
    widgetId: 'example.injection.example-menus',
    priority: 50,
  },
  'menu:topbar:profile-dropdown': {
    widgetId: 'example.injection.example-menus',
    priority: 50,
  },
}

export default injectionTable
