import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'crud-form:catalog.product': [
    {
      widgetId: 'translations.injection.translation-manager',
      kind: 'group',
      column: 2,
      groupLabel: 'translations.widgets.translationManager.groupLabel',
      groupDescription: 'translations.widgets.translationManager.groupDescription',
      priority: 40,
    },
  ],
  'crud-form:catalog.catalog_product': 'translations.injection.translation-manager',
  'crud-form:catalog.catalog_offer': [
    {
      widgetId: 'translations.injection.translation-manager',
      kind: 'group',
      column: 2,
      groupLabel: 'translations.widgets.translationManager.groupLabel',
      groupDescription: 'translations.widgets.translationManager.groupDescription',
      priority: 40,
    },
  ],
  'crud-form:catalog.catalog_product_variant': 'translations.injection.translation-manager',
}

export default injectionTable
