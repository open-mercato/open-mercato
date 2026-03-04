import { z } from 'zod'
import { SalesOrder } from '../../../../data/entities'
import { extractCustomerName } from '../helpers'
import { makeDashboardWidgetRoute } from '../../../../widgets/dashboard/makeDashboardWidgetRoute'

const orderItemSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.string(),
  status: z.string().nullable(),
  fulfillmentStatus: z.string().nullable(),
  paymentStatus: z.string().nullable(),
  customerName: z.string().nullable(),
  customerEntityId: z.string().uuid().nullable(),
  netAmount: z.string(),
  grossAmount: z.string(),
  currency: z.string().nullable(),
  createdAt: z.string(),
})

const { GET, metadata, openApi } = makeDashboardWidgetRoute({
  entity: SalesOrder,
  cacheId: 'sales:new-orders',
  cacheTags: ['widget-data:sales:orders'],
  feature: 'sales.widgets.new-orders',
  itemSchema: orderItemSchema,
  errorPrefix: 'sales.widgets.newOrders',
  openApi: {
    summary: 'New orders dashboard widget',
    description: 'Fetches recently created sales orders for the dashboard widget with a configurable date period.',
    getSummary: 'Fetch recently created sales orders',
    itemDescription: 'List of recent orders',
    errorFallback: 'Failed to load orders',
  },
  mapItem: (order) => ({
    id: order.id as string,
    orderNumber: order.orderNumber as string,
    status: (order.status as string) ?? null,
    fulfillmentStatus: (order.fulfillmentStatus as string) ?? null,
    paymentStatus: (order.paymentStatus as string) ?? null,
    customerName: extractCustomerName(order.customerSnapshot) ?? null,
    customerEntityId: (order.customerEntityId as string) ?? null,
    netAmount: (order.grandTotalNetAmount as string) ?? '0',
    grossAmount: (order.grandTotalGrossAmount as string) ?? '0',
    currency: (order.currencyCode as string) ?? null,
    createdAt: order.createdAt ? (order.createdAt as Date).toISOString() : new Date().toISOString(),
  }),
})

export { GET, metadata, openApi }
