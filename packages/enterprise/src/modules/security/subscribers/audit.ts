import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'security.password.notification_requested',
  persistent: true,
  id: 'security:password-change-notification',
}

type PasswordNotificationPayload = {
  userId: string
  tenantId?: string | null
  organizationId?: string | null
  changedAt?: string
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function auditSubscriber(
  payload: PasswordNotificationPayload,
  ctx: ResolverContext,
) {
  if (!payload.tenantId) return

  const typeDef = notificationTypes.find((type) => type.type === 'security.password.changed')
  if (!typeDef) return

  const notificationService = resolveNotificationService(ctx)
  await notificationService.create(
    buildNotificationFromType(typeDef, {
      recipientUserId: payload.userId,
      sourceEntityType: 'security:profile_password',
      sourceEntityId: payload.userId,
      linkHref: '/backend/profile/security',
    }),
    {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    },
  )
}
