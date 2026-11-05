import { dataTableExtensionHost, defineModuleExtensionPoints } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'directory',
  hosts: {
    organizationsTable: dataTableExtensionHost({ tableId: 'directory.organizations.list', source: 'backend/directory/organizations/page.tsx' }),
    tenantsTable: dataTableExtensionHost({ tableId: 'directory.tenants.list', source: 'backend/directory/tenants/page.tsx' }),
  },
})

export default extensionPoints
