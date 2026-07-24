import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { WarrantyClaim } from '../data/entities'
import { notificationTypes } from '../notifications'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('warranty_claims')

export const metadata = {
  event: 'warranty_claims.claim.comment_added',
  persistent: true,
  id: 'warranty_claims:claim-customer-reply-notification',
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
  container?: { resolve<T = unknown>(name: string): T }
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export default async function handle(payload: unknown, ctx: ResolverContext): Promise<void> {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const actorCustomerId = readString(record, 'actorCustomerId')
  if (!actorCustomerId) return
  const claimId = readString(record, 'claimId') ?? readString(record, 'id')
  const tenantId = readString(record, 'tenantId')
  const organizationId = readString(record, 'organizationId')
  if (!claimId || !tenantId || !organizationId) return

  try {
    const em = (ctx.resolve('em') as EntityManager).fork()
    const scope = { tenantId, organizationId }
    const claim = await findOneWithDecryption(
      em,
      WarrantyClaim,
      { id: claimId, tenantId, organizationId, deletedAt: null },
      {},
      scope,
    )
    const assigneeUserId = claim?.assigneeUserId ?? null
    if (!claim || !assigneeUserId) return
    const notificationService = resolveNotificationService(ctx.container ?? { resolve: ctx.resolve })
    const typeDef = notificationTypes.find((type) => type.type === 'warranty_claims.claim.customer_replied')
    if (!typeDef) return
    const notificationInput = buildNotificationFromType(typeDef, {
      recipientUserId: assigneeUserId,
      bodyVariables: { claimNumber: claim.claimNumber },
      sourceEntityType: 'warranty_claims:warranty_claim',
      sourceEntityId: claim.id,
      linkHref: `/backend/warranty_claims/${claim.id}`,
      groupKey: `warranty_claims.claim.customer_replied:${claim.id}:${assigneeUserId}`,
    })
    await notificationService.create(notificationInput, {
      tenantId,
      organizationId,
    })
  } catch (err) {
    logger.warn('[warranty_claims:claim-customer-reply-notification] create failed', { err })
  }
}
