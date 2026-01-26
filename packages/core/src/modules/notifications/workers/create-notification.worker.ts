import type { EntityManager } from '@mikro-orm/core'
import type { Knex } from 'knex'
import { Notification } from '../data/entities'
import type { CreateNotificationInput, CreateRoleNotificationInput } from '../data/validators'
import { NOTIFICATION_EVENTS } from '../lib/events'

function getKnex(em: EntityManager): Knex {
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
}

export const NOTIFICATIONS_QUEUE_NAME = 'notifications'

export type CreateNotificationJob = {
  type: 'create'
  input: CreateNotificationInput
  tenantId: string
  organizationId?: string | null
}

export type CreateRoleNotificationJob = {
  type: 'create-role'
  input: CreateRoleNotificationInput
  tenantId: string
  organizationId?: string | null
}

export type CleanupExpiredJob = {
  type: 'cleanup-expired'
}

export type NotificationJob = CreateNotificationJob | CreateRoleNotificationJob | CleanupExpiredJob

export const metadata = {
  queue: NOTIFICATIONS_QUEUE_NAME,
  id: 'notifications:create',
  concurrency: 5,
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(
  job: { payload: NotificationJob },
  ctx: HandlerContext
): Promise<void> {
  const { payload } = job

  if (payload.type === 'create') {
    const em = (ctx.resolve('em') as EntityManager).fork()
    const eventBus = ctx.resolve('eventBus') as { emit: (event: string, payload: unknown) => Promise<void> }
    const { input, tenantId, organizationId } = payload

    const notification = em.create(Notification, {
      recipientUserId: input.recipientUserId,
      type: input.type,
      title: input.title,
      body: input.body,
      icon: input.icon,
      severity: input.severity ?? 'info',
      actionData: input.actions
        ? {
            actions: input.actions,
            primaryActionId: input.primaryActionId,
          }
        : null,
      sourceModule: input.sourceModule,
      sourceEntityType: input.sourceEntityType,
      sourceEntityId: input.sourceEntityId,
      linkHref: input.linkHref,
      groupKey: input.groupKey,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      tenantId,
      organizationId,
    })

    await em.persistAndFlush(notification)

    await eventBus.emit(NOTIFICATION_EVENTS.CREATED, {
      notificationId: notification.id,
      recipientUserId: notification.recipientUserId,
      type: notification.type,
      title: notification.title,
      tenantId,
      organizationId,
    })
  } else if (payload.type === 'create-role') {
    const em = (ctx.resolve('em') as EntityManager).fork()
    const eventBus = ctx.resolve('eventBus') as { emit: (event: string, payload: unknown) => Promise<void> }
    const { input, tenantId, organizationId } = payload

    const knex = getKnex(em)
    const userRoles = await knex('user_roles')
      .join('users', 'user_roles.user_id', 'users.id')
      .where('user_roles.role_id', input.roleId)
      .whereNull('user_roles.deleted_at')
      .whereNull('users.deleted_at')
      .where('users.tenant_id', tenantId)
      .select('users.id as user_id')

    if (userRoles.length === 0) {
      return
    }

    const notifications: Notification[] = []
    for (const row of userRoles) {
      const notification = em.create(Notification, {
        recipientUserId: row.user_id,
        type: input.type,
        title: input.title,
        body: input.body,
        icon: input.icon,
        severity: input.severity ?? 'info',
        actionData: input.actions
          ? {
              actions: input.actions,
              primaryActionId: input.primaryActionId,
            }
          : null,
        sourceModule: input.sourceModule,
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId,
        linkHref: input.linkHref,
        groupKey: input.groupKey,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        tenantId,
        organizationId,
      })
      notifications.push(notification)
    }

    await em.persistAndFlush(notifications)

    for (const notification of notifications) {
      await eventBus.emit(NOTIFICATION_EVENTS.CREATED, {
        notificationId: notification.id,
        recipientUserId: notification.recipientUserId,
        type: notification.type,
        title: notification.title,
        tenantId,
        organizationId,
      })
    }
  } else if (payload.type === 'cleanup-expired') {
    const em = (ctx.resolve('em') as EntityManager).fork()
    const knex = getKnex(em)

    await knex('notifications')
      .where('expires_at', '<', knex.fn.now())
      .whereNotIn('status', ['actioned', 'dismissed'])
      .update({
        status: 'dismissed',
        dismissed_at: knex.fn.now(),
      })
  }
}
