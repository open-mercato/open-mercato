import {
  CRUD_FORM_EXTENSION_SURFACES,
  CRUD_FORM_LIFECYCLE_PHASES,
  CRUD_FORM_OPERATIONS,
  DATA_TABLE_EXTENSION_SURFACES,
  crudFormExtensionHost,
  crudFormExtensionSpotId,
  dataTableExtensionHost,
  dataTableExtensionSpotId,
  defineModuleExtensionPoints,
  extensionSpotChildId,
  injectionExtensionHost,
  resolveExtensionPointPattern,
} from '@open-mercato/shared/modules/widgets/extension-points'

describe('module extension point declarations', () => {
  it('preserves exact ids and immutable declarations', () => {
    const extensionPoints = defineModuleExtensionPoints({
      moduleId: 'catalog',
      hosts: {
        products: dataTableExtensionHost({
          baseSpotId: 'data-table:catalog.products',
          tableId: 'catalog.products.list',
          source: 'components/products/ProductsDataTable.tsx',
        }),
        productForm: crudFormExtensionHost({
          entityId: 'catalog.product',
          spotId: 'crud-form:catalog.product',
          source: 'backend/catalog/products/[id]/page.tsx',
        }),
      },
    })

    expect(extensionPoints.moduleId).toBe('catalog')
    expect(extensionPoints.hosts.products.tableId).toBe('catalog.products.list')
    expect(Object.isFrozen(extensionPoints)).toBe(true)
    expect(Object.isFrozen(extensionPoints.hosts)).toBe(true)
  })

  it('requires named parameters for dynamic patterns', () => {
    // @ts-expect-error patterned declarations require named parameters
    expect(() => injectionExtensionHost({
      family: 'integration',
      pattern: 'integrations.detail:{integrationId}',
      supported: ['render-widget'],
      source: 'backend/integrations/[id]/page.tsx',
    })).toThrow('patterned injection extension hosts require named parameters')
  })

  it('describes only the surfaces bound by DataTable and CrudForm', () => {
    expect(DATA_TABLE_EXTENSION_SURFACES.filter((surface) => surface.bound).map((surface) => surface.key)).toEqual([
      'header',
      'footer',
      'toolbar',
      'searchTrailing',
      'columns',
      'rowActions',
      'bulkActions',
      'filters',
      'replacement',
    ])
    expect(DATA_TABLE_EXTENSION_SURFACES.find((surface) => surface.key === 'emptyState')?.bound).toBe(false)
    expect(CRUD_FORM_EXTENSION_SURFACES.filter((surface) => !surface.bound).map((surface) => surface.key)).toEqual([
      'beforeFields',
      'afterFields',
      'footer',
      'sidebar',
      'group',
      'fieldBefore',
      'fieldAfter',
    ])
    expect(CRUD_FORM_LIFECYCLE_PHASES).toEqual([
      'transformValidation',
      'transformDisplayData',
      'onBeforeNavigate',
      'onAppEvent',
      'onVisibilityChange',
      'onBeforeDelete',
      'onDelete',
      'onAfterDelete',
      'onDeleteError',
      'onFieldChange',
      'transformFormData',
      'onBeforeSave',
      'onSave',
      'onAfterSave',
    ])
    expect(CRUD_FORM_OPERATIONS).toEqual(['create', 'update', 'delete'])
  })

  it('builds standard family ids without changing punctuation', () => {
    expect(dataTableExtensionSpotId('catalog.products.list', 'columns')).toBe(
      'data-table:catalog.products.list:columns',
    )
    expect(crudFormExtensionSpotId('catalog.product', 'fields')).toBe('crud-form:catalog.product:fields')
    expect(extensionSpotChildId('legacy:custom-host', 'header')).toBe('legacy:custom-host:header')
    expect(resolveExtensionPointPattern('integrations.detail:{integrationId}', {
      integrationId: 'stripe',
    })).toBe('integrations.detail:stripe')
  })
})
