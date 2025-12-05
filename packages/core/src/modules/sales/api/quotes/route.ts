import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { SalesQuote } from '../../data/entities'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { buildDocumentCrudOptions, buildDocumentOpenApi } from '../documents/factory'

const crud = makeCrudRoute(
  buildDocumentCrudOptions({
    kind: 'quote',
    entity: SalesQuote,
    entityId: E.sales.sales_quote,
    numberField: 'quoteNumber',
    createCommandId: 'sales.quotes.create',
    updateCommandId: 'sales.quotes.update',
    deleteCommandId: 'sales.quotes.delete',
    manageFeature: 'sales.quotes.manage',
    viewFeature: 'sales.quotes.view',
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
  createCommandId: 'sales.quotes.create',
  updateCommandId: 'sales.quotes.update',
  deleteCommandId: 'sales.quotes.delete',
  manageFeature: 'sales.quotes.manage',
  viewFeature: 'sales.quotes.view',
})
