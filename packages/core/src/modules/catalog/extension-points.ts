import {
  crudFormExtensionHost,
  dataTableExtensionHost,
  defineModuleExtensionPoints,
} from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'catalog',
  hosts: {
    productForm: crudFormExtensionHost({
      entityId: 'catalog.product',
      spotId: 'crud-form:catalog.product',
      source: 'backend/catalog/products/[id]/page.tsx',
    }),
    productsTable: dataTableExtensionHost({
      baseSpotId: 'data-table:catalog.products',
      tableId: 'catalog.products.list',
      source: 'components/products/ProductsDataTable.tsx',
    }),
    categoriesTable: dataTableExtensionHost({ tableId: 'catalog.categories.list', source: 'components/categories/CategoriesDataTable.tsx' }),
  },
})

export default extensionPoints
