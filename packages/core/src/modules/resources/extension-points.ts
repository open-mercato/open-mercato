import { dataTableExtensionHost, defineModuleExtensionPoints } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'resources',
  hosts: {
    resourcesTable: dataTableExtensionHost({ tableId: 'resources.resources.list', source: 'backend/resources/resources/page.tsx' }),
    resourceTypesTable: dataTableExtensionHost({ tableId: 'resources.resource-types.list', source: 'backend/resources/resource-types/page.tsx' }),
  },
})

export default extensionPoints
