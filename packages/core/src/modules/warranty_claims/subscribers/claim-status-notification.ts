import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildBatchNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { WarrantyClaim, WarrantyClaimEvent } from '../data/entities'
import { notificationTypes } from '../notifications'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('warranty_claims')

export const metadata = {
  event: 'warranty_claims.claim.status_changed',
  persistent: true,
  id: 'warranty_claims:claim-status-notification',
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
  container?: { resolve<T = unknown>(name: string): T }
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readEventPayload(event: WarrantyClaimEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? event.payload
    : {}
}

async function resolveCreatorUserId(
  em: EntityManager,
  claimId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<string | null> {
  const events = await findWithDecryption(
    em,
    WarrantyClaimEvent,
    { claim: claimId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { orderBy: { createdAt: 'asc' }, limit: 25 },
    scope,
  )
  for (const event of events) {
    const payload = readEventPayload(event)
    if (event.kind === 'system' && payload.action === 'created' && event.actorUserId) {
      return event.actorUserId
    }
  }
  return null
}

export default async function handle(payload: unknown, ctx: ResolverContext): Promise<void> {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const claimId = readString(record, 'claimId') ?? readString(record, 'id')
  const claimNumber = readString(record, 'claimNumber') ?? ''
  const tenantId = readString(record, 'tenantId')
  const organizationId = readString(record, 'organizationId')
  const fromStatus = readString(record, 'fromStatus') ?? ''
  const toStatus = readString(record, 'toStatus') ?? readString(record, 'status') ?? ''
  if (!claimId || !tenantId || !organizationId) return

  try {
    const container = ctx.container ?? { resolve: ctx.resolve }
    const em = container.resolve<EntityManager>('em').fork()
    const scope = { tenantId, organizationId }
    const claim = await findOneWithDecryption(em, WarrantyClaim, { id: claimId, tenantId, organizationId, deletedAt: null }, {}, scope)
    if (!claim) return
    const creatorUserId = await resolveCreatorUserId(em, claimId, scope)
    const recipientUserIds = Array.from(
      new Set([creatorUserId, claim.assigneeUserId ?? null].filter((value): value is string => typeof value === 'string' && value.length > 0)),
    )
    if (!recipientUserIds.length) return

    const notificationService = resolveNotificationService(container)
    const typeDef = notificationTypes.find((type) => type.type === 'warranty_claims.claim.status_changed')
    if (!typeDef) return
    const notificationInput = buildBatchNotificationFromType(typeDef, {
      recipientUserIds,
      bodyVariables: {
        claimNumber,
        fromStatus,
        toStatus,
      },
      sourceEntityType: 'warranty_claims:warranty_claim',
      sourceEntityId: claimId,
      linkHref: `/backend/warranty_claims/${claimId}`,
      groupKey: `warranty_claims.claim.status_changed:${claimId}:${toStatus}`,
    })
    await notificationService.createBatch(notificationInput, {
      tenantId,
      organizationId,
    })
  } catch (err) {
    logger.warn('[warranty_claims:claim-status-notification] create failed', { err })
  }
}
