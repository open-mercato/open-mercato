import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import MfaEnrolledEmail from '../emails/mfa-enrolled'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'security.mfa.enrolled',
  persistent: true,
  id: 'security:mfa-enrolled-notification',
}

type MfaEnrolledPayload = {
  userId: string
  methodId: string
  methodType: string
  enrolledAt?: string
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

const METHOD_LABELS: Record<string, string> = {
  totp: 'Authenticator app',
  passkey: 'Passkey',
  otp_email: 'Email OTP',
}

function resolveMethodLabel(methodType: string): string {
  return METHOD_LABELS[methodType] ?? methodType
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

export default async function notificationSubscriber(
  payload: MfaEnrolledPayload,
  ctx: ResolverContext,
) {
  const typeDef = notificationTypes.find((type) => type.type === 'security.mfa.enrolled')
  if (!typeDef) return

  const em = ctx.resolve<EntityManager>('em').fork()
  const user = await resolveUserById(em, payload.userId)
  if (!user) return

  const notificationService = resolveNotificationService(ctx)
  const methodLabel = resolveMethodLabel(payload.methodType)
  const enrolledAtIso = payload.enrolledAt ?? new Date().toISOString()

  await notificationService.create(
    buildNotificationFromType(typeDef, {
      recipientUserId: user.id,
      bodyVariables: {
        method: methodLabel,
      },
      sourceEntityType: 'security:mfa_method',
      sourceEntityId: payload.methodId,
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
      subject: 'Multi-factor authentication enabled',
      react: MfaEnrolledEmail({
        methodLabel,
        enrolledAtIso,
      }),
    })
  }
}
