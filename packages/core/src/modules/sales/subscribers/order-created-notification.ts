import type { NotificationService } from '../../notifications/lib/notificationService'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const metadata = {
  event: 'sales.order.created',
  id: 'sales:order-created-notification',
  persistent: true,
}

interface OrderCreatedPayload {
  orderId: string
  orderNumber: string
  tenantId: string
  organizationId?: string | null
  customerId?: string | null
  grandTotalGross?: string | null
  currencyCode?: string | null
}

export default async function handle(
  payload: OrderCreatedPayload,
  ctx: { resolve: <T = unknown>(name: string) => T }
): Promise<void> {
  const { orderId, orderNumber, tenantId, organizationId, grandTotalGross, currencyCode } = payload

  if (!tenantId) {
    return
  }

  let notificationService: NotificationService
  try {
    notificationService = ctx.resolve<NotificationService>('notificationService')
  } catch {
    return
  }

  const { t } = await resolveTranslations()

  const totalDisplay = grandTotalGross && currencyCode
    ? ` (${grandTotalGross} ${currencyCode})`
    : ''

  await notificationService.createForFeature(
    {
      requiredFeature: 'sales.orders.manage',
      type: 'sales.order.created',
      title: t('sales.notifications.order.created.title', 'New Sales Order'),
      body: t('sales.notifications.order.created.body', 'Sales order {orderNumber} has been created{total}', {
        orderNumber,
        total: totalDisplay,
      }),
      icon: 'shopping-cart',
      severity: 'info',
      sourceModule: 'sales',
      sourceEntityType: 'sales:order',
      sourceEntityId: orderId,
      linkHref: `/backend/sales/orders/${orderId}`,
    },
    {
      tenantId,
      organizationId: organizationId ?? null,
    }
  )
}
