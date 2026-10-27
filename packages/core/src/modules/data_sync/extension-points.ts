import { dataTableExtensionHost, defineModuleExtensionPoints } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'data_sync',
  hosts: {
    runsTable: dataTableExtensionHost({ tableId: 'data_sync.runs', source: 'backend/data-sync/page.tsx' }),
  },
})

export default extensionPoints
