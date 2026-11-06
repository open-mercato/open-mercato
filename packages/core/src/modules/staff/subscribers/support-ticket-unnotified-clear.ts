import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { clearSupportTicketUnnotified } from '../lib/support/notifications'

const logger = createLogger('staff').child({ component: 'subscribers/support-ticket-unnotified-clear' })

export const metadata = {
  event: 'staff.timesheets.time_task.assignee_changed',
  persistent: true,
  id: 'staff:support-ticket-unnotified-clear',
}

type ResolverContext = { resolve: <T = unknown>(name: string) => T }

type Payload = Record<string, unknown>

export default async function handle(payload: Payload, ctx: ResolverContext): Promise<void> {
  try {
    const taskId = typeof payload.id === 'string' ? payload.id : null
    const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null
    const organizationId = typeof payload.organizationId === 'string' ? payload.organizationId : null
    if (!taskId || !tenantId || !organizationId || !payload.assigneeStaffMemberId) return
    const em = (ctx.resolve('em') as EntityManager).fork()
    await clearSupportTicketUnnotified(em, { taskId, tenantId, organizationId })
  } catch (err) {
    logger.error('staff:support-ticket-unnotified-clear failed', { err, id: payload?.id ?? null })
    throw err
  }
}
