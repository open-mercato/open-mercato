import { dataTableExtensionHost, defineModuleExtensionPoints } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'webhooks',
  hosts: {
    webhooksTable: dataTableExtensionHost({ tableId: 'webhooks.list', source: 'backend/webhooks/page.tsx' }),
    deliveriesTable: dataTableExtensionHost({ tableId: 'webhooks.deliveries', source: 'backend/webhooks/[id]/page.tsx' }),
    integrationDeliveriesTable: dataTableExtensionHost({ tableId: 'webhooks.integration-deliveries', source: 'widgets/injection/integration-deliveries/widget.client.tsx' }),
  },
})

export default extensionPoints
