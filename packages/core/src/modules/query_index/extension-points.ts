import { dataTableExtensionHost, defineModuleExtensionPoints } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'query_index',
  hosts: {
    statusTable: dataTableExtensionHost({ tableId: 'query_index.status.list', source: 'components/QueryIndexesTable.tsx' }),
  },
})

export default extensionPoints
