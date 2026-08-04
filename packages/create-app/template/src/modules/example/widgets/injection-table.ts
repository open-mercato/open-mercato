import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Example module injection table
 * Maps injection spot IDs to widget IDs for automatic widget injection
 *
 * Declared as ONE object literal with no env-flag branching on purpose: the
 * fact extractor (`packages/cli/src/lib/generators/module-extension-facts.ts`
 * → `readRootObject` → `staticValue`) can only fold a statically known value,
 * so an export built by a ternary published ZERO contributions and every
 * scaffolded app read this canonical module as contributing nothing.
 *
 * Cross-module entries (customers / catalog / sales) are therefore always
 * present. They are inert when their host module is absent, because each one is
 * keyed on a spot id only that module renders. Gate behavior inside the widget,
 * or with `metadata.requiredModules` on the widget — never by branching the
 * exported table value.
 */
export const injectionTable: ModuleInjectionTable = {
  // Portal dashboard widgets — showcase widget injection for customer portal
  'portal:dashboard:sections': [
    { widgetId: 'example.injection.portal-stats', priority: 5 },
    { widgetId: 'example.injection.portal-recent-activity', priority: 10 },
    { widgetId: 'example.injection.portal-quick-links', priority: 20 },
  ],

  // Example module demo surfaces
  'crud-form:example.todo': 'example.injection.crud-validation',
  'widget:example.injection.crud-validation:addon': {
    widgetId: 'example.injection.crud-validation-addon',
    priority: 50,
  },
  'example:phase-c-handlers': 'example.injection.crud-validation',
  'menu:sidebar:main': {
    widgetId: 'example.injection.example-menus',
    priority: 50,
  },
  'menu:topbar:profile-dropdown': {
    widgetId: 'example.injection.example-profile-menu',
    priority: 50,
  },

  // Customer page injections.
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
  'customers.person.detail:details': {
    widgetId: 'example.injection.customer-priority-detail',
    priority: 30,
  },

  // Inject the validation widget into catalog CRUD forms
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

export default injectionTable
