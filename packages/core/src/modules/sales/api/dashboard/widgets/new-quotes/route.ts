import { z } from 'zod'
import { SalesQuote } from '../../../../data/entities'
import { extractCustomerName } from '../helpers'
import { makeDashboardWidgetRoute } from '../../../../widgets/dashboard/makeDashboardWidgetRoute'

const quoteItemSchema = z.object({
  id: z.string().uuid(),
  quoteNumber: z.string(),
  status: z.string().nullable(),
  customerName: z.string().nullable(),
  customerEntityId: z.string().uuid().nullable(),
  validFrom: z.string().nullable(),
  validUntil: z.string().nullable(),
  netAmount: z.string(),
  grossAmount: z.string(),
  currency: z.string().nullable(),
  createdAt: z.string(),
  convertedOrderId: z.string().uuid().nullable(),
})

const { GET, metadata, openApi } = makeDashboardWidgetRoute({
  entity: SalesQuote,
  cacheId: 'sales:new-quotes',
  cacheTags: ['widget-data:sales:quotes'],
  feature: 'sales.widgets.new-quotes',
  itemSchema: quoteItemSchema,
  errorPrefix: 'sales.widgets.newQuotes',
  openApi: {
    summary: 'New quotes dashboard widget',
    description: 'Fetches recently created sales quotes for the dashboard widget with a configurable date period.',
    getSummary: 'Fetch recently created sales quotes',
    itemDescription: 'List of recent quotes',
    errorFallback: 'Failed to load quotes',
  },
  mapItem: (quote) => ({
    id: quote.id as string,
    quoteNumber: quote.quoteNumber as string,
    status: (quote.status as string) ?? null,
    customerName: extractCustomerName(quote.customerSnapshot) ?? null,
    customerEntityId: (quote.customerEntityId as string) ?? null,
    validFrom: quote.validFrom ? (quote.validFrom as Date).toISOString() : null,
    validUntil: quote.validUntil ? (quote.validUntil as Date).toISOString() : null,
    netAmount: (quote.grandTotalNetAmount as string) ?? '0',
    grossAmount: (quote.grandTotalGrossAmount as string) ?? '0',
    currency: (quote.currencyCode as string) ?? null,
    createdAt: quote.createdAt ? (quote.createdAt as Date).toISOString() : new Date().toISOString(),
    convertedOrderId: (quote.convertedOrderId as string) ?? null,
  }),
})

export { GET, metadata, openApi }
