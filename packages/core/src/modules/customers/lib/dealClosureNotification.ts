import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'

export type DealClosurePayload = {
  id: string
  tenantId: string | null
  organizationId: string | null
  ownerUserId: string | null
  title: string
  valueAmount: string | null
  valueCurrency: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
  container?: { resolve<T = unknown>(name: string): T }
}

export type DealClosureNotificationType = 'customers.deal.won' | 'customers.deal.lost'

export async function deliverDealClosureNotification(
  payload: DealClosurePayload,
  ctx: ResolverContext,
  notificationType: DealClosureNotificationType,
): Promise<void> {
  if (!payload?.ownerUserId || !payload.tenantId) return

  const typeDef = notificationTypes.find((type) => type.type === notificationType)
  if (!typeDef) return

  const container = ctx.container ?? { resolve: ctx.resolve }
  let notificationService: ReturnType<typeof resolveNotificationService> | null
  try {
    notificationService = resolveNotificationService(container)
  } catch (err) {
    console.warn('[customers.dealClosureNotification] notificationService resolve failed', err)
    return
  }

  const valueDisplay = payload.valueAmount && payload.valueCurrency
    ? `${payload.valueCurrency} ${payload.valueAmount}`
    : ''

  const notificationInput = buildNotificationFromType(typeDef, {
    recipientUserId: payload.ownerUserId,
    bodyVariables: {
      dealTitle: payload.title,
      dealValue: valueDisplay,
    },
    sourceEntityType: 'customers:customer_deal',
    sourceEntityId: payload.id,
    linkHref: `/backend/customers/deals/${payload.id}`,
  })

  try {
    await notificationService.create(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (err) {
    console.warn('[customers.dealClosureNotification] create failed', notificationType, err)
  }
}
