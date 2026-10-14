import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { fanOutStatusColumn, readEventScope } from '../lib/support/portalBroadcast'

const logger = createLogger('staff').child({ component: 'subscribers/support-portal-status-column-updated' })

/**
 * Persistent, unlike the other support-portal subscribers: re-deriving every portal
 * ticket in a column is the one potentially expensive fan-out, so it runs on the
 * queue (retried on failure; `publishTaskPortalStatus` is compare-and-publish, so a
 * retry is idempotent) instead of inside the admin's request. Column flag edits are
 * rare, and until #2973 lands a `portal_updated` emitted from the worker may not
 * reach an open portal page live; the portal derives status on read, so the page is
 * correct on its next load.
 */
export const metadata = {
  event: 'staff.timesheets.time_task_status.updated',
  persistent: true,
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
    throw err
  }
}
