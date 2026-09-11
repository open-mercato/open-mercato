import { dataTableExtensionHost, defineModuleExtensionPoints } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'workflows',
  hosts: {
    definitionsTable: dataTableExtensionHost({ tableId: 'workflows.definitions.list', source: 'backend/definitions/page.tsx' }),
    instancesTable: dataTableExtensionHost({ tableId: 'workflows.instances.list', source: 'backend/instances/page.tsx' }),
    tasksTable: dataTableExtensionHost({ tableId: 'workflows.tasks.list', source: 'backend/work-inbox/page.tsx' }),
  },
})

export default extensionPoints
