import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { publishTaskPortalStatus, readEventScope } from '../lib/support/portalBroadcast'

const logger = createLogger('staff').child({ component: 'subscribers/support-portal-task-updated' })

/**
 * Ephemeral on purpose: `portal_updated` is portal-only, and the event bus does not
 * relay portal-only events across processes (open issue #2973). Run inline in the web
 * process that executed the command, where the portal SSE stream lives. Make this
 * persistent again once #2973 lands.
 */
export const metadata = {
  event: 'staff.timesheets.time_task.updated',
  persistent: false,
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
    getTelemetryRuntime()?.reportError(err, { module: 'staff', code: 'staff.support_portal_task_updated_failed' })
  }
}
