import { createLogger } from '@open-mercato/shared/lib/logger'
import { notifySupportTicket } from '../lib/support/notifications'

const logger = createLogger('staff').child({ component: 'subscribers/support-ticket-created-notification' })

export const metadata = {
  event: 'staff.support_ticket.created',
  persistent: true,
  id: 'staff:support-ticket-created-notification',
}

type ResolverContext = { resolve: <T = unknown>(name: string) => T }

type Payload = Record<string, unknown>

export default async function handle(payload: Payload, ctx: ResolverContext): Promise<void> {
  try {
    const taskId = typeof payload.taskId === 'string' ? payload.taskId : null
    const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null
    const organizationId = typeof payload.organizationId === 'string' ? payload.organizationId : null
    if (!taskId || !tenantId || !organizationId) return
    await notifySupportTicket(ctx, { taskId, tenantId, organizationId, kind: 'created' })
  } catch (err) {
    logger.error('staff:support-ticket-created-notification failed', { err, id: payload?.id ?? null })
    throw err
  }
}
