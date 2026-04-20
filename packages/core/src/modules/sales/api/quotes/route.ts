import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { SalesQuote } from '../../data/entities'
import { E } from '#generated/entities.ids.generated'
import { buildDocumentCrudOptions, buildDocumentOpenApi } from '../documents/factory'

const crud = makeCrudRoute(
  buildDocumentCrudOptions({
    kind: 'quote',
    entity: SalesQuote,
    entityId: E.sales.sales_quote,
    numberField: 'quoteNumber',
    createCommandId: 'sales.quote.create',
    updateCommandId: 'sales.quote.update',
    deleteCommandId: 'sales.quote.delete',
    manageFeature: 'sales.quote.manage',
    viewFeature: 'sales.quote.view',
  }),
)

export const metadata = crud.metadata
export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
export const openApi = buildDocumentOpenApi({
  kind: 'quote',
  entity: SalesQuote,
  entityId: E.sales.sales_quote,
  numberField: 'quoteNumber',
  createCommandId: 'sales.quote.create',
  updateCommandId: 'sales.quote.update',
  deleteCommandId: 'sales.quote.delete',
  manageFeature: 'sales.quote.manage',
  viewFeature: 'sales.quote.view',
})
