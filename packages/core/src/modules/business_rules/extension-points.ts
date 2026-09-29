import { dataTableExtensionHost, defineModuleExtensionPoints } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'business_rules',
  hosts: {
    rulesTable: dataTableExtensionHost({ tableId: 'business-rules.rules.list', source: 'backend/rules/page.tsx' }),
  },
})

export default extensionPoints
