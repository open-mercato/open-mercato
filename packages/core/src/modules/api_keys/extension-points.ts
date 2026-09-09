import { dataTableExtensionHost, defineModuleExtensionPoints } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'api_keys',
  hosts: {
    apiKeysTable: dataTableExtensionHost({
      tableId: 'api_keys.list',
      source: 'backend/api-keys/page.tsx',
    }),
  },
})

export default extensionPoints
