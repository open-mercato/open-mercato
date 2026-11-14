import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'

// #8268 review Major 7. Shared by the two orphaned refusal events
// (`promotions.code.exhausted`, `promotions.promotion.budget_exhausted`) so a code-cap
// refusal and a promotion-budget refusal surface the identical actionable notification —
// no account-manager routing (unlike `customer_groups`'s credit notification) since there
// is no single natural owner for a promotion/code; `promotions.usage.manage` is the gate.
export type ResolverContainer = {
  resolve: <T = unknown>(name: string) => T
}

export type UsageReinstateBlockedNotificationInput = {
  tenantId: string
  organizationId: string
  orderId: string
  reason: 'code_exhausted' | 'budget_exhausted'
}

export async function createUsageReinstateBlockedNotification(
  container: ResolverContainer,
  input: UsageReinstateBlockedNotificationInput,
): Promise<void> {
  const typeDef = notificationTypes.find((type) => type.type === 'promotions.usage.reinstate_blocked')
  if (!typeDef) return

  const notificationService = resolveNotificationService(container)
  await notificationService.createForFeature(
    buildFeatureNotificationFromType(typeDef, {
      requiredFeature: 'promotions.usage.manage',
      bodyVariables: { orderId: input.orderId },
      sourceEntityType: 'sales:sales_order',
      sourceEntityId: input.orderId,
      linkHref: `/backend/sales/orders/${input.orderId}`,
      groupKey: `promotions.usage.reinstate_blocked:${input.orderId}:${input.reason}`,
    }),
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
}
