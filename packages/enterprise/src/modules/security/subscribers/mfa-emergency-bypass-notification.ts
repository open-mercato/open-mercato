import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { z } from 'zod'
import { Notification } from '@open-mercato/core/modules/notifications/data/entities'
import { buildBatchNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { getRecipientUserIdsForFeature, getScopedNotificationRecipientUserIds } from '@open-mercato/core/modules/notifications/lib/notificationRecipients'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'security.mfa.emergency_bypass_active',
  persistent: true,
  id: 'security:mfa-emergency-bypass-notification',
}

const payloadSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  observedAt: z.string().datetime(),
})

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
  const parsed = payloadSchema.safeParse(payload)
  if (!parsed.success) return
  const { tenantId, organizationId, observedAt } = parsed.data
  if (ctx.tenantId !== tenantId || ctx.organizationId !== organizationId) return

  const typeDef = notificationTypes.find((type) => type.type === metadata.event)
  if (!typeDef) return
  const scope = { tenantId, organizationId }
  const groupKey = `${metadata.event}:${observedAt.slice(0, 10)}`
  const em = ctx.resolve<EntityManager>('em').fork()

  await em.transactional(async (transaction) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`${tenantId}:${organizationId}:${groupKey}`}))`
      .execute(transaction.getKysely())
    const existing = await findOneWithDecryption(transaction, Notification, {
      ...scope,
      type: metadata.event,
      groupKey,
    }, undefined, scope)
    if (existing) return

    const candidates = await getRecipientUserIdsForFeature(transaction.getKysely(), tenantId, 'security.mfa.manage')
    const scopedCandidates = await getScopedNotificationRecipientUserIds(transaction.getKysely(), tenantId, organizationId, candidates)
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
      buildBatchNotificationFromType(typeDef, { recipientUserIds, groupKey }),
      scope,
    )
  })
}
