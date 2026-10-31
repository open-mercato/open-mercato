import type { EntityManager } from '@mikro-orm/postgresql'
import { Notification } from '@open-mercato/core/modules/notifications/data/entities'
import { buildBatchNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { getRecipientUserIdsForFeature, getScopedNotificationRecipientUserIds } from '@open-mercato/core/modules/notifications/lib/notificationRecipients'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { notificationTypes } from '../notifications'
import { mfaEmergencyBypassEventSchema } from '../data/validators'

export const metadata = {
  event: 'security.mfa.emergency_bypass_detected',
  persistent: true,
  id: 'security:mfa-emergency-bypass-notification',
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
  tenantId?: string | null
  organizationId?: string | null
}

type RbacServiceLike = {
  userHasAllFeatures: (
    userId: string,
    features: string[],
    scope: { tenantId: string; organizationId: string },
  ) => Promise<boolean>
}

export default async function mfaEmergencyBypassNotification(payload: unknown, ctx: ResolverContext) {
  const parsed = mfaEmergencyBypassEventSchema.safeParse(payload)
  if (!parsed.success) return
  const { tenantId, organizationId, observedAt } = parsed.data
  if (ctx.tenantId !== tenantId || ctx.organizationId !== organizationId) return

  const typeDef = notificationTypes.find((type) => type.type === metadata.event)
  if (!typeDef) return
  const scope = { tenantId, organizationId }
  const groupKey = `${metadata.event}:${observedAt.slice(0, 10)}`
  const em = ctx.resolve<EntityManager>('em').fork()

  const existing = await findOneWithDecryption(em, Notification, {
    ...scope,
    type: metadata.event,
    groupKey,
  }, undefined, scope)
  if (existing) return

  const candidates = await getRecipientUserIdsForFeature(em.getKysely(), tenantId, 'security.mfa.manage')
  if (candidates.length === 0) return
  const scopedCandidates = await getScopedNotificationRecipientUserIds(em.getKysely(), tenantId, organizationId, candidates)
  const rbac = ctx.resolve<RbacServiceLike>('rbacService')
  const recipientUserIds: string[] = []
  for (let offset = 0; offset < scopedCandidates.length; offset += 10) {
    const allowed = await Promise.all(scopedCandidates.slice(offset, offset + 10).map(async (userId) => ({
      userId,
      allowed: await rbac.userHasAllFeatures(userId, ['security.mfa.manage'], scope),
    })))
    recipientUserIds.push(...allowed.filter((candidate) => candidate.allowed).map((candidate) => candidate.userId))
  }
  if (recipientUserIds.length === 0) return

  await resolveNotificationService(ctx).createBatch(
    { ...buildBatchNotificationFromType(typeDef, { recipientUserIds, groupKey }), channels: ['in_app'] },
    scope,
    { skipExistingGroup: true },
  )
}
