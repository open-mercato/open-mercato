import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import EnforcementDeadlineEmail from '../emails/enforcement-deadline'
import { MfaEnforcementPolicy, UserMfaMethod } from '../data/entities'
import { notificationTypes } from '../notifications'

const DAY_MS = 24 * 60 * 60 * 1000
const REMINDER_WINDOWS = new Set([1, 3, 7])

export const metadata = {
  event: 'security.enforcement.deadline_reminder_requested',
  persistent: true,
  id: 'security:enforcement-deadline-notification',
}

type EnforcementDeadlinePayload = {
  policyId: string
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

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function resolveSetupUrl(): string {
  const appUrl = process.env.APP_URL?.trim()
  if (!appUrl) return '/backend/profile/security/mfa'
  return `${appUrl.replace(/\/$/, '')}/backend/profile/security/mfa`
}

async function resolveScopedUsers(
  em: EntityManager,
  policy: MfaEnforcementPolicy,
): Promise<ResolvedUser[]> {
  const users = await em.find(User, {
    deletedAt: null,
    ...(policy.tenantId ? { tenantId: policy.tenantId } : {}),
    ...(policy.organizationId ? { organizationId: policy.organizationId } : {}),
  })

  const resolvedUsers: ResolvedUser[] = []
  for (const user of users) {
    if (!user.tenantId) continue
    const decrypted = await findOneWithDecryption(
      em,
      User,
      {
        id: user.id,
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
    if (!decrypted?.tenantId) continue
    resolvedUsers.push({
      id: decrypted.id,
      email: typeof decrypted.email === 'string' ? decrypted.email : null,
      tenantId: decrypted.tenantId,
      organizationId: decrypted.organizationId ?? null,
    })
  }

  return resolvedUsers
}

export default async function enforcementDeadlineNotificationSubscriber(
  payload: EnforcementDeadlinePayload,
  ctx: ResolverContext,
) {
  const typeDef = notificationTypes.find((type) => type.type === 'security.mfa.enforcement_deadline')
  if (!typeDef) return

  const em = ctx.resolve<EntityManager>('em').fork()
  const notificationService = resolveNotificationService(ctx)
  const policy = await em.findOne(MfaEnforcementPolicy, {
    id: payload.policyId,
    deletedAt: null,
  })
  if (!policy?.isEnforced || !policy.enforcementDeadline) return

  const daysRemaining = Math.ceil((policy.enforcementDeadline.getTime() - Date.now()) / DAY_MS)
  if (!REMINDER_WINDOWS.has(daysRemaining)) return

  const users = await resolveScopedUsers(em, policy)
  if (users.length === 0) return

  const methods = await em.find(UserMfaMethod, {
    userId: { $in: users.map((user) => user.id) },
    isActive: true,
    deletedAt: null,
    ...(policy.allowedMethods && policy.allowedMethods.length > 0
      ? { type: { $in: policy.allowedMethods } }
      : {}),
  })
  const enrolledUserIds = new Set(methods.map((method) => method.userId))

  const deadlineIsoDate = toIsoDate(policy.enforcementDeadline)
  const setupUrl = resolveSetupUrl()
  for (const user of users) {
    if (enrolledUserIds.has(user.id)) continue

    await notificationService.create(
      buildNotificationFromType(typeDef, {
        recipientUserId: user.id,
        bodyVariables: {
          days: String(daysRemaining),
          deadline: deadlineIsoDate,
        },
        sourceEntityType: 'security:mfa_enforcement_policy',
        sourceEntityId: policy.id,
        linkHref: '/backend/profile/security/mfa',
        groupKey: `security.mfa.enforcement_deadline:${policy.id}:${daysRemaining}`,
      }),
      {
        tenantId: user.tenantId,
        organizationId: user.organizationId,
      },
    )

    if (user.email) {
      await sendEmail({
        to: user.email,
        subject: `MFA enrollment deadline in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`,
        react: EnforcementDeadlineEmail({
          daysRemaining,
          deadlineIsoDate,
          setupUrl,
        }),
      })
    }
  }
}
