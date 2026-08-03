import { dataTableExtensionHost, defineModuleExtensionPoints, injectionExtensionHost } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'security',
  hosts: {
    profileSidebar: injectionExtensionHost({ family: 'detail', spotId: 'security.profile.sidebar', supported: ['render-widget'], source: 'backend/profile/security/page.tsx' }),
    profileSections: injectionExtensionHost({ family: 'detail', spotId: 'security.profile.sections', supported: ['render-widget'], source: 'backend/profile/security/page.tsx' }),
    enforcementTable: dataTableExtensionHost({ tableId: 'security.enforcement.list', source: 'backend/security/enforcement/page.tsx' }),
    sudoTable: dataTableExtensionHost({ tableId: 'security.sudo.list', source: 'backend/security/sudo/page.tsx' }),
    usersTable: dataTableExtensionHost({ tableId: 'security.users.list', source: 'backend/security/users/page.tsx' }),
  },
})

export default extensionPoints
