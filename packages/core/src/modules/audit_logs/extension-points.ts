import { dataTableExtensionHost, defineModuleExtensionPoints } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'audit_logs',
  hosts: {
    accessLogsTable: dataTableExtensionHost({ tableId: 'audit_logs.access.list', source: 'components/AccessLogsTable.tsx' }),
    actionsTable: dataTableExtensionHost({ tableId: 'audit_logs.actions.list', source: 'components/AuditLogsActions.tsx' }),
  },
})

export default extensionPoints
