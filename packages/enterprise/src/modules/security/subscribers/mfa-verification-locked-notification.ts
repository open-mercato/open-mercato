import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { buildBatchNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'security.mfa.verification_locked',
  persistent: true,
  id: 'security:mfa-verification-locked-notification',
}

const lockedPayloadSchema = z.object({
  userId: z.string().uuid(),
  tenantId: z.string().uuid(),
  lockedUntil: z.string().datetime(),
})

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function mfaVerificationLockedNotification(payload: unknown, ctx: ResolverContext) {
  const parsed = lockedPayloadSchema.safeParse(payload)
  if (!parsed.success) return
  const { userId, tenantId, lockedUntil } = parsed.data
  const typeDef = notificationTypes.find((type) => type.type === metadata.event)
  if (!typeDef) return
  const em = ctx.resolve<EntityManager>('em').fork()
  const user = await findOneWithDecryption(em, User, {
    id: userId,
    tenantId,
    deletedAt: null,
  }, undefined, { tenantId })
  if (!user?.tenantId) return
  await resolveNotificationService(ctx).createBatch(
    { ...buildBatchNotificationFromType(typeDef, {
      recipientUserIds: [user.id],
      sourceEntityType: 'security:mfa_verification',
      sourceEntityId: user.id,
      groupKey: `security:mfa-verification-locked:${user.id}:${lockedUntil}`,
    }), channels: ['in_app', 'email'] },
    { tenantId: user.tenantId, organizationId: user.organizationId ?? null },
    { skipExistingGroup: true },
  )
}
