import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'inbox_ops.proposal.created',
  persistent: true,
  id: 'inbox_ops:proposal-notifier',
}

interface ProposalCreatedPayload {
  proposalId: string
  emailId: string
  tenantId: string
  organizationId: string | null
  actionCount: number
  discrepancyCount: number
  confidence: string
  summary: string
}

interface ResolverContext {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: ProposalCreatedPayload, ctx: ResolverContext) {
  try {
    const notificationService = resolveNotificationService(ctx as any)
    const typeDef = notificationTypes.find((t) => t.type === 'inbox_ops.proposal.created')
    if (!typeDef) return

    const notificationInput = buildFeatureNotificationFromType(typeDef, {
      requiredFeature: 'inbox_ops.proposals.view',
      bodyVariables: {
        actionCount: String(payload.actionCount),
      },
      sourceEntityType: 'inbox_ops:proposal',
      sourceEntityId: payload.proposalId,
      linkHref: `/backend/inbox-ops/proposals/${payload.proposalId}`,
    })

    await notificationService.createForFeature(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (err) {
    console.error('[inbox_ops:proposal-notifier] Failed to create notification:', err)
  }
}
