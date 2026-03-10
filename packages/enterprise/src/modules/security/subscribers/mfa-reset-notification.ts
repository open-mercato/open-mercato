import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import MfaResetEmail from '../emails/mfa-reset'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'security.mfa.reset',
  persistent: true,
  id: 'security:mfa-reset-notification',
}

type MfaResetPayload = {
  targetUserId: string
  reason: string
  resetAt?: string
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

type ResolvedUser = {
  id: string
  email: string | null
  tenantId: string
  organizationId: string | null
}

async function resolveUserById(em: EntityManager, userId: string): Promise<ResolvedUser | null> {
  const user = await em.findOne(User, { id: userId, deletedAt: null })
  if (!user?.tenantId) return null

  const decrypted = await findOneWithDecryption(
    em,
    User,
    {
      id: userId,
      tenantId: user.tenantId,
      organizationId: user.organizationId ?? null,
      deletedAt: null,
    },
    undefined,
    {
      tenantId: user.tenantId,
      organizationId: user.organizationId ?? null,
    },
  )
  if (!decrypted?.tenantId) return null

  return {
    id: decrypted.id,
    email: typeof decrypted.email === 'string' ? decrypted.email : null,
    tenantId: decrypted.tenantId,
    organizationId: decrypted.organizationId ?? null,
  }
}

export default async function mfaResetNotificationSubscriber(
  payload: MfaResetPayload,
  ctx: ResolverContext,
) {
  const typeDef = notificationTypes.find((type) => type.type === 'security.mfa.reset')
  if (!typeDef) return

  const em = ctx.resolve<EntityManager>('em').fork()
  const user = await resolveUserById(em, payload.targetUserId)
  if (!user) return

  const notificationService = resolveNotificationService(ctx)
  const resetAtIso = payload.resetAt ?? new Date().toISOString()
  const reason = payload.reason.trim() || 'No reason provided'

  await notificationService.create(
    buildNotificationFromType(typeDef, {
      recipientUserId: user.id,
      bodyVariables: {
        reason,
      },
      sourceEntityType: 'security:mfa_reset',
      sourceEntityId: user.id,
      linkHref: '/backend/profile/security/mfa',
    }),
    {
      tenantId: user.tenantId,
      organizationId: user.organizationId,
    },
  )

  if (user.email) {
    await sendEmail({
      to: user.email,
      subject: 'Your MFA methods were reset',
      react: MfaResetEmail({
        reason,
        resetAtIso,
      }),
    })
  }
}
