import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { publishTaskPortalStatus, readEventScope } from '../lib/support/portalBroadcast'

const logger = createLogger('staff').child({ component: 'subscribers/support-portal-task-updated' })

export const metadata = {
  event: 'staff.timesheets.time_task.updated',
  persistent: true,
  id: 'staff:support-portal-task-updated',
}

type ResolverContext = { resolve: <T = unknown>(name: string) => T }

type Payload = Record<string, unknown>

export default async function handle(payload: Payload, ctx: ResolverContext): Promise<void> {
  try {
    const scope = readEventScope(payload)
    const taskId = typeof payload.id === 'string' ? payload.id : null
    if (!scope || !taskId) return
    await publishTaskPortalStatus((ctx.resolve('em') as EntityManager).fork(), taskId, scope)
  } catch (err) {
    logger.error('staff:support-portal-task-updated failed', { err, id: payload?.id ?? null })
  }
}
