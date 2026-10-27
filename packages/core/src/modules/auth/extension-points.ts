import { dataTableExtensionHost, defineModuleExtensionPoints, injectionExtensionHost } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'auth',
  hosts: {
    loginForm: injectionExtensionHost({
      family: 'generic',
      spotId: 'auth.login:form',
      supported: ['render-widget'],
      contextContract: 'auth.login-form.v1',
      source: 'frontend/login.tsx',
    }),
    usersTable: dataTableExtensionHost({ tableId: 'auth.users.list', source: 'backend/users/page.tsx' }),
    rolesTable: dataTableExtensionHost({ tableId: 'auth.roles.list', source: 'backend/roles/page.tsx' }),
  },
})

export default extensionPoints
