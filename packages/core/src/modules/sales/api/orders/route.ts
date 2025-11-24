import { SalesOrder } from '../../data/entities'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { createDocumentCrudRoute } from '../documents/factory'

const route = createDocumentCrudRoute({
  kind: 'order',
  entity: SalesOrder,
  entityId: E.sales.sales_order,
  numberField: 'orderNumber',
  createCommandId: 'sales.orders.create',
  deleteCommandId: 'sales.orders.delete',
  manageFeature: 'sales.orders.manage',
  viewFeature: 'sales.orders.view',
})

export const metadata = route.metadata
export const GET = route.GET
export const POST = route.POST
export const DELETE = route.DELETE
export const openApi = route.openApi

