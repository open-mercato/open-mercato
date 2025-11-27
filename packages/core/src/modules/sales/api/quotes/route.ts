import { SalesQuote } from '../../data/entities'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { createDocumentCrudRoute } from '../documents/factory'

const route = createDocumentCrudRoute({
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

export const metadata = route.metadata
export const GET = route.GET
export const POST = route.POST
export const PUT = route.PUT
export const DELETE = route.DELETE
export const openApi = route.openApi
