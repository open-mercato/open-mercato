import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { fanOutStatusColumn, readEventScope } from '../lib/support/portalBroadcast'

const logger = createLogger('staff').child({ component: 'subscribers/support-portal-status-column-updated' })

/**
 * Ephemeral on purpose: `portal_updated` is portal-only, and the event bus does not
 * relay portal-only events across processes (open issue #2973). Run inline in the web
 * process that executed the command, where the portal SSE stream lives. Make this
 * persistent again once #2973 lands.
 */
export const metadata = {
  event: 'staff.timesheets.time_task_status.updated',
  persistent: false,
  id: 'staff:support-portal-status-column-updated',
}

type ResolverContext = { resolve: <T = unknown>(name: string) => T }

type Payload = Record<string, unknown>

export default async function handle(payload: Payload, ctx: ResolverContext): Promise<void> {
  try {
    const scope = readEventScope(payload)
    const statusId = typeof payload.id === 'string' ? payload.id : null
    if (!scope || !statusId) return
    await fanOutStatusColumn((ctx.resolve('em') as EntityManager).fork(), statusId, scope)
  } catch (err) {
    logger.error('staff:support-portal-status-column-updated failed', { err, id: payload?.id ?? null })
  }
}
