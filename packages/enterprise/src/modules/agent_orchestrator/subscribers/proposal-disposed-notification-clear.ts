import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { AGENT_PROPOSAL_SOURCE_ENTITY_TYPE } from '../notifications'

const logger = createLogger('agent_orchestrator')

/**
 * A decided proposal is nobody's pending work, so its "waiting on you"
 * notification goes away — whether the verdict came from an operator or from an
 * auto-approval rule (F7).
 *
 * This is also what makes the create-side race harmless: if the pending
 * notification was written a beat before an inline auto-approval committed, the
 * `proposal.disposed` that follows removes it.
 */
export const metadata = {
  event: 'agent_orchestrator.proposal.disposed',
  persistent: true,
  id: 'agent_orchestrator:proposal-disposed-notification-clear',
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
  container?: { resolve<T = unknown>(name: string): T }
  tenantId?: string | null
  organizationId?: string | null
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export default async function handle(payload: unknown, ctx: ResolverContext): Promise<void> {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const proposalId = readString(record, 'proposalId') ?? readString(record, 'id')
  const tenantId = ctx.tenantId ?? readString(record, 'tenantId')
  const organizationId = ctx.organizationId ?? readString(record, 'organizationId')
  if (!proposalId || !tenantId) return

  try {
    const notificationService = resolveNotificationService(ctx.container ?? { resolve: ctx.resolve })
    await notificationService.deleteBySource(AGENT_PROPOSAL_SOURCE_ENTITY_TYPE, proposalId, {
      tenantId,
      organizationId: organizationId ?? null,
    })
  } catch (err) {
    logger.warn('[agent_orchestrator:proposal-disposed-notification-clear] clear failed', { err })
  }
}
