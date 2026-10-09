import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { publishTicketReply, readEventScope } from '../lib/support/portalBroadcast'

const logger = createLogger('staff').child({ component: 'subscribers/support-portal-comment-updated' })

export const metadata = {
  event: 'staff.timesheets.time_task_comment.updated',
  persistent: true,
  id: 'staff:support-portal-comment-updated',
}

type ResolverContext = { resolve: <T = unknown>(name: string) => T }

type Payload = Record<string, unknown>

export default async function handle(payload: Payload, ctx: ResolverContext): Promise<void> {
  try {
    if (payload.portalVisible !== true) return
    const scope = readEventScope(payload)
    const commentId = typeof payload.id === 'string' ? payload.id : null
    if (!scope || !commentId) return
    await publishTicketReply((ctx.resolve('em') as EntityManager).fork(), commentId, scope)
  } catch (err) {
    logger.error('staff:support-portal-comment-updated failed', { err, id: payload?.id ?? null })
  }
}
