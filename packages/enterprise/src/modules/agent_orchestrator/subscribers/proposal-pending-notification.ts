import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { AgentProposal } from '../data/entities'
import {
  AGENT_PROPOSAL_PENDING_NOTIFICATION,
  AGENT_PROPOSAL_SOURCE_ENTITY_TYPE,
  notificationTypes,
} from '../notifications'

const logger = createLogger('agent_orchestrator')

/**
 * Tell the people who can actually decide that a proposal is waiting on them (F7).
 *
 * Addressed by `agent_orchestrator.proposals.dispose`, never `proposals.view` —
 * a read-only auditor cannot clear the queue and must not be paged for it.
 *
 * Auto-approval is the reason this re-reads the row instead of trusting the
 * event: `DispositionServiceImpl` disposes INLINE right after the run, so a
 * proposal that a rule is about to approve is still `pending` in the emitted
 * payload. By the time this persistent subscriber runs the verdict has normally
 * landed, and the row is the only honest source. The narrow remaining race —
 * subscriber ahead of the inline verdict — is closed on the other side by
 * `proposal-disposed-notification-clear`, which removes the notification when
 * any verdict arrives.
 */
export const metadata = {
  event: 'agent_orchestrator.proposal.created',
  persistent: true,
  id: 'agent_orchestrator:proposal-pending-notification',
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
  const proposalId = readString(record, 'id') ?? readString(record, 'proposalId')
  const tenantId = ctx.tenantId ?? readString(record, 'tenantId')
  const organizationId = ctx.organizationId ?? readString(record, 'organizationId')
  if (!proposalId || !tenantId || !organizationId) return

  // An eval replay records what an agent proposed; it is not somebody's work.
  // Mirrors the caseload's own `source: 'runtime'` filter.
  if ((readString(record, 'source') ?? 'runtime') !== 'runtime') return

  try {
    const em = (ctx.resolve('em') as EntityManager).fork()
    const proposal = await em.findOne(AgentProposal, { id: proposalId, tenantId, organizationId })
    // Gone, already decided, or terminal at creation (`none_proposed`) — nothing
    // is waiting on a human, so nothing should land in anyone's bell.
    if (!proposal || proposal.disposition !== 'pending') return

    const notificationService = resolveNotificationService(ctx.container ?? { resolve: ctx.resolve })
    const typeDef = notificationTypes.find((type) => type.type === AGENT_PROPOSAL_PENDING_NOTIFICATION)
    if (!typeDef) return

    const notificationInput = buildFeatureNotificationFromType(typeDef, {
      requiredFeature: 'agent_orchestrator.proposals.dispose',
      bodyVariables: { agent: proposal.agentId },
      sourceEntityType: AGENT_PROPOSAL_SOURCE_ENTITY_TYPE,
      sourceEntityId: proposalId,
      linkHref: `/backend/caseload/${proposalId}`,
      // Keyed on the proposal, so a redelivered event refreshes the existing
      // notification instead of stacking a second one.
      groupKey: `${AGENT_PROPOSAL_PENDING_NOTIFICATION}:${proposalId}`,
    })

    await notificationService.createForFeature(notificationInput, { tenantId, organizationId })
  } catch (err) {
    logger.warn('[agent_orchestrator:proposal-pending-notification] create failed', { err })
  }
}
