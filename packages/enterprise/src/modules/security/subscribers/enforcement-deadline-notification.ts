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
const ENFORCEMENT_BODY_KEYS = {
  withDeadline: 'security.notifications.enforcementDeadline.bodyWithDeadline',
  immediate: 'security.notifications.enforcementDeadline.bodyImmediate',
  overdue: 'security.notifications.enforcementDeadline.bodyOverdue',
} as const

export const metadata = {
  event: 'security.enforcement.created',
  persistent: true,
  id: 'security:enforcement-deadline-notification',
}

type EnforcementLifecyclePayload = {
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

type EnforcementMessage = {
  bodyKey: string
  bodyVariables: Record<string, string> | undefined
  deadlineIsoDate: string | null
  daysRemaining: number | null
  emailMode: 'deadline' | 'immediate' | 'overdue'
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

function resolveEnforcementMessage(deadline?: Date | null): EnforcementMessage {
  if (!(deadline instanceof Date) || Number.isNaN(deadline.getTime())) {
    return {
      bodyKey: ENFORCEMENT_BODY_KEYS.immediate,
      bodyVariables: undefined,
      deadlineIsoDate: null,
      daysRemaining: null,
      emailMode: 'immediate',
    }
  }

  const daysRemaining = Math.ceil((deadline.getTime() - Date.now()) / DAY_MS)
  const deadlineIsoDate = toIsoDate(deadline)
  if (daysRemaining <= 0) {
    return {
      bodyKey: ENFORCEMENT_BODY_KEYS.overdue,
      bodyVariables: {
        deadline: deadlineIsoDate,
      },
      deadlineIsoDate,
      daysRemaining: null,
      emailMode: 'overdue',
    }
  }

  return {
    bodyKey: ENFORCEMENT_BODY_KEYS.withDeadline,
    bodyVariables: {
      days: String(daysRemaining),
      deadline: deadlineIsoDate,
    },
    deadlineIsoDate,
    daysRemaining,
    emailMode: 'deadline',
  }
}

function resolveEmailSubject(message: EnforcementMessage): string {
  if (message.emailMode === 'deadline' && message.daysRemaining !== null) {
    return `MFA enrollment required within ${message.daysRemaining} day${message.daysRemaining === 1 ? '' : 's'}`
  }
  if (message.emailMode === 'overdue') {
    return 'MFA enrollment deadline has passed'
  }
  return 'MFA enrollment required immediately'
}

export async function notifyEnforcementPolicyChange(
  payload: EnforcementLifecyclePayload,
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
  if (!policy?.isEnforced) return

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

  const message = resolveEnforcementMessage(policy.enforcementDeadline)
  const setupUrl = resolveSetupUrl()
  for (const user of users) {
    if (enrolledUserIds.has(user.id)) continue

    const notificationInput = buildNotificationFromType(typeDef, {
      recipientUserId: user.id,
      bodyVariables: message.bodyVariables,
      sourceEntityType: 'security:mfa_enforcement_policy',
      sourceEntityId: policy.id,
      linkHref: '/backend/profile/security/mfa',
      groupKey: `security.mfa.enforcement_deadline:${policy.id}`,
    })

    await notificationService.create(
      {
        ...notificationInput,
        bodyKey: message.bodyKey,
        body: message.bodyKey,
      },
      {
        tenantId: user.tenantId,
        organizationId: user.organizationId,
      },
    )

    if (user.email) {
      await sendEmail({
        to: user.email,
        subject: resolveEmailSubject(message),
        react: EnforcementDeadlineEmail({
          daysRemaining: message.daysRemaining,
          deadlineIsoDate: message.deadlineIsoDate,
          setupUrl,
        }),
      })
    }
  }
}

export default async function enforcementDeadlineNotificationSubscriber(
  payload: EnforcementLifecyclePayload,
  ctx: ResolverContext,
) {
  await notifyEnforcementPolicyChange(payload, ctx)
}
