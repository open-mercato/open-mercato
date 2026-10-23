import type { EntityManager } from '@mikro-orm/postgresql'
import type { ReorderingEngine } from '../services/reorderingEngine'

export const metadata = {
  event: 'sales.order.confirmed',
  persistent: true,
  id: 'purchases:sales-order-confirmed-mto',
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

type SalesOrderConfirmedPayload = {
  orderId?: string | null
  tenantId?: string | null
  organizationId?: string | null
}

export default async function handle(
  payload: SalesOrderConfirmedPayload,
  ctx: SubscriberContext
) {
  if (!payload.tenantId || !payload.organizationId) {
    return
  }

  try {
    const reorderingEngine = ctx.resolve<ReorderingEngine>('reorderingEngine')
    if (reorderingEngine) {
      await reorderingEngine.runReplenishment({
        organizationId: payload.organizationId,
        tenantId: payload.tenantId,
      })
    }
  } catch (err) {
    // Subscriber should not crash if reordering is skipped or fails
    console.error('[purchases:sales-order-confirmed-mto] Error triggering replenishment:', err)
  }
}
