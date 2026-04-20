import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { SalesOrder } from '../../data/entities'
import { E } from '#generated/entities.ids.generated'
import { buildDocumentCrudOptions, buildDocumentOpenApi } from '../documents/factory'

const crud = makeCrudRoute(
  buildDocumentCrudOptions({
    kind: 'order',
    entity: SalesOrder,
    entityId: E.sales.sales_order,
    numberField: 'orderNumber',
    createCommandId: 'sales.order.create',
    updateCommandId: 'sales.order.update',
    deleteCommandId: 'sales.order.delete',
    manageFeature: 'sales.order.manage',
    viewFeature: 'sales.order.view',
  }),
)

export const metadata = crud.metadata
export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
export const openApi = buildDocumentOpenApi({
  kind: 'order',
  entity: SalesOrder,
  entityId: E.sales.sales_order,
  numberField: 'orderNumber',
  createCommandId: 'sales.order.create',
  updateCommandId: 'sales.order.update',
  deleteCommandId: 'sales.order.delete',
  manageFeature: 'sales.order.manage',
  viewFeature: 'sales.order.view',
})
