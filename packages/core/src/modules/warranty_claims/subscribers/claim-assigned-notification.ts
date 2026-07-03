import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'warranty_claims.claim.assigned',
  persistent: true,
  id: 'warranty_claims:claim-assigned-notification',
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
  const claimId = readString(record, 'claimId') ?? readString(record, 'id')
  const claimNumber = readString(record, 'claimNumber') ?? ''
  const tenantId = readString(record, 'tenantId')
  const organizationId = readString(record, 'organizationId')
  const assigneeUserId = readString(record, 'assigneeUserId')
  if (!claimId || !tenantId || !assigneeUserId) return

  try {
    const notificationService = resolveNotificationService(ctx.container ?? { resolve: ctx.resolve })
    const typeDef = notificationTypes.find((type) => type.type === 'warranty_claims.claim.assigned')
    if (!typeDef) return
    const notificationInput = buildNotificationFromType(typeDef, {
      recipientUserId: assigneeUserId,
      bodyVariables: { claimNumber },
      sourceEntityType: 'warranty_claims:warranty_claim',
      sourceEntityId: claimId,
      linkHref: `/backend/warranty_claims/${claimId}`,
      groupKey: `warranty_claims.claim.assigned:${claimId}:${assigneeUserId}`,
    })
    await notificationService.create(notificationInput, {
      tenantId,
      organizationId,
    })
  } catch (err) {
    console.warn('[warranty_claims:claim-assigned-notification] create failed', err)
  }
}
