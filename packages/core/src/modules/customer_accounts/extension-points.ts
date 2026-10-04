import { dataTableExtensionHost, defineModuleExtensionPoints } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'customer_accounts',
  hosts: {
    usersTable: dataTableExtensionHost({ tableId: 'customer_accounts.admin.users', source: 'backend/customer_accounts/users/PortalUsersPageClient.tsx' }),
    rolesTable: dataTableExtensionHost({ tableId: 'customer_accounts.admin.roles', source: 'backend/customer_accounts/roles/page.tsx' }),
  },
})

export default extensionPoints
