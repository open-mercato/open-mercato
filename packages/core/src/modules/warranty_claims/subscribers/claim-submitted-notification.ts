import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'warranty_claims.claim.submitted',
  persistent: true,
  id: 'warranty_claims:claim-submitted-notification',
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
  if (!claimId || !tenantId) return

  try {
    const notificationService = resolveNotificationService(ctx.container ?? { resolve: ctx.resolve })
    const typeDef = notificationTypes.find((type) => type.type === 'warranty_claims.claim.submitted')
    if (!typeDef) return
    const notificationInput = buildFeatureNotificationFromType(typeDef, {
      requiredFeature: 'warranty_claims.claim.manage',
      bodyVariables: { claimNumber },
      sourceEntityType: 'warranty_claims:warranty_claim',
      sourceEntityId: claimId,
      linkHref: `/backend/warranty_claims/${claimId}`,
      groupKey: `warranty_claims.claim.submitted:${claimId}`,
    })
    await notificationService.createForFeature(notificationInput, {
      tenantId,
      organizationId,
    })
  } catch (err) {
    console.warn('[warranty_claims:claim-submitted-notification] create failed', err)
  }
}
