import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { SalesOrder } from '../../data/entities'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { buildDocumentCrudOptions, buildDocumentOpenApi } from '../documents/factory'

const crud = makeCrudRoute(
  buildDocumentCrudOptions({
    kind: 'order',
    entity: SalesOrder,
    entityId: E.sales.sales_order,
    numberField: 'orderNumber',
    createCommandId: 'sales.orders.create',
    updateCommandId: 'sales.orders.update',
    deleteCommandId: 'sales.orders.delete',
    manageFeature: 'sales.orders.manage',
    viewFeature: 'sales.orders.view',
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
  createCommandId: 'sales.orders.create',
  updateCommandId: 'sales.orders.update',
  deleteCommandId: 'sales.orders.delete',
  manageFeature: 'sales.orders.manage',
  viewFeature: 'sales.orders.view',
})
