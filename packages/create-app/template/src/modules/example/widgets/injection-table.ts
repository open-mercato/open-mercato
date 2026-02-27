import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

const exampleInjectionWidgetsEnabled = parseBooleanWithDefault(
  process.env.NEXT_PUBLIC_OM_EXAMPLE_INJECTION_WIDGETS_ENABLED,
  false,
)

const alwaysEnabledInjectionTable: ModuleInjectionTable = {
  // Keep example module demo surfaces always available
  'crud-form:example.todo': 'example.injection.crud-validation',
  'example:phase-c-handlers': 'example.injection.crud-validation',
  'menu:sidebar:main': {
    widgetId: 'example.injection.example-menus',
    priority: 50,
  },
  'menu:topbar:profile-dropdown': {
    widgetId: 'example.injection.example-profile-menu',
    priority: 50,
  },
  // Backward-compatible aliasing: support both legacy and current customer form spot ids.
  'crud-form:customers.person:fields': {
    widgetId: 'example.injection.customer-priority-field',
    priority: 40,
  },
  'crud-form:customers.customer_entity:fields': {
    widgetId: 'example.injection.customer-priority-field',
    priority: 40,
  },
  // Backward-compatible aliasing: support both legacy and current people table ids.
  'data-table:customers.people:columns': {
    widgetId: 'example.injection.customer-priority-column',
    priority: 30,
  },
  'data-table:customers.people.list:columns': {
    widgetId: 'example.injection.customer-priority-column',
    priority: 30,
  },
  'data-table:customers.people:filters': {
    widgetId: 'example.injection.customer-priority-filter',
    priority: 30,
  },
  'data-table:customers.people.list:filters': {
    widgetId: 'example.injection.customer-priority-filter',
    priority: 30,
  },
  'data-table:customers.people:row-actions': {
    widgetId: 'example.injection.customer-priority-row-action',
    priority: 30,
  },
  'data-table:customers.people.list:row-actions': {
    widgetId: 'example.injection.customer-priority-row-action',
    priority: 30,
  },
  'data-table:customers.people:bulk-actions': {
    widgetId: 'example.injection.customer-priority-bulk-actions',
    priority: 30,
  },
  'data-table:customers.people.list:bulk-actions': {
    widgetId: 'example.injection.customer-priority-bulk-actions',
    priority: 30,
  },
}

const optionalCrossModuleInjectionTable: ModuleInjectionTable = {
  // Inject the validation widget into catalog CRUD forms when enabled
  'crud-form:catalog.product': 'example.injection.crud-validation',
  'crud-form:catalog.catalog_product': 'example.injection.crud-validation',
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
}

/**
 * Example module injection table
 * Maps injection spot IDs to widget IDs for automatic widget injection
 */
export const injectionTable: ModuleInjectionTable = exampleInjectionWidgetsEnabled
  ? { ...alwaysEnabledInjectionTable, ...optionalCrossModuleInjectionTable }
  : alwaysEnabledInjectionTable

export default injectionTable
