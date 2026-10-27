import { dataTableExtensionHost, defineModuleExtensionPoints, injectionExtensionHost } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'entities',
  hosts: {
    systemEntitiesTable: dataTableExtensionHost({ tableId: 'entities.system.list', source: 'components/SystemEntitiesTable.tsx' }),
    userEntitiesTable: dataTableExtensionHost({ tableId: 'entities.user.list', source: 'components/UserEntitiesTable.tsx' }),
    userRecordsTable: injectionExtensionHost({
      family: 'entity',
      pattern: 'data-table:entities.user.records.{entityId}',
      parameters: { entityId: { source: 'route.params.entityId' } },
      supported: ['render-widget', 'headless-widget', 'column-widget', 'row-action', 'bulk-action', 'filter-widget'],
      source: 'backend/entities/user/[entityId]/records/page.tsx',
    }),
  },
})

export default extensionPoints
