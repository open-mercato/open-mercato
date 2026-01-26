import type { EntityManager } from '@mikro-orm/core'
import type { Knex } from 'knex'
import { Notification } from '../data/entities'
import type { CreateNotificationInput, CreateRoleNotificationInput, CreateFeatureNotificationInput } from '../data/validators'
import { NOTIFICATION_EVENTS } from '../lib/events'

function getKnex(em: EntityManager): Knex {
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
}

/**
 * Check if a user has a specific feature based on their features list
 * Supports wildcard matching (e.g., "staff.*" matches "staff.leave_requests.accept")
 */
function hasFeature(features: string[], requiredFeature: string): boolean {
  for (const feature of features) {
    // Exact match
    if (feature === requiredFeature) {
      return true
    }

    // Wildcard match (e.g., "staff.*" matches "staff.leave_requests.accept")
    if (feature.endsWith('.*')) {
      const prefix = feature.slice(0, -2)
      if (requiredFeature.startsWith(prefix + '.')) {
        return true
      }
    }
  }

  return false
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

export type CreateFeatureNotificationJob = {
  type: 'create-feature'
  input: CreateFeatureNotificationInput
  tenantId: string
  organizationId?: string | null
}

export type CleanupExpiredJob = {
  type: 'cleanup-expired'
}

export type NotificationJob = CreateNotificationJob | CreateRoleNotificationJob | CreateFeatureNotificationJob | CleanupExpiredJob

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
      titleKey: input.titleKey,
      bodyKey: input.bodyKey,
      titleVariables: input.titleVariables,
      bodyVariables: input.bodyVariables,
      title: input.title || input.titleKey || '',
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
        titleKey: input.titleKey,
        bodyKey: input.bodyKey,
        titleVariables: input.titleVariables,
        bodyVariables: input.bodyVariables,
        title: input.title || input.titleKey || '',
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
  } else if (payload.type === 'create-feature') {
    const em = (ctx.resolve('em') as EntityManager).fork()
    const eventBus = ctx.resolve('eventBus') as { emit: (event: string, payload: unknown) => Promise<void> }
    const { input, tenantId, organizationId } = payload

    const knex = getKnex(em)

    // Find all users with the required feature
    const userIdsSet = new Set<string>()

    // Query 1: Users with direct user ACL
    const userAcls = await knex('user_acls')
      .join('users', 'user_acls.user_id', 'users.id')
      .where('user_acls.tenant_id', tenantId)
      .whereNull('user_acls.deleted_at')
      .whereNull('users.deleted_at')
      .where('users.tenant_id', tenantId)
      .select('users.id as user_id', 'user_acls.features_json', 'user_acls.is_super_admin')

    for (const row of userAcls) {
      if (row.is_super_admin) {
        userIdsSet.add(row.user_id)
      } else if (row.features_json && Array.isArray(row.features_json)) {
        if (hasFeature(row.features_json, input.requiredFeature)) {
          userIdsSet.add(row.user_id)
        }
      }
    }

    // Query 2: Users with role ACL
    const roleAcls = await knex('role_acls')
      .join('user_roles', 'role_acls.role_id', 'user_roles.role_id')
      .join('users', 'user_roles.user_id', 'users.id')
      .where('role_acls.tenant_id', tenantId)
      .whereNull('role_acls.deleted_at')
      .whereNull('user_roles.deleted_at')
      .whereNull('users.deleted_at')
      .where('users.tenant_id', tenantId)
      .select('users.id as user_id', 'role_acls.features_json', 'role_acls.is_super_admin')

    for (const row of roleAcls) {
      if (row.is_super_admin) {
        userIdsSet.add(row.user_id)
      } else if (row.features_json && Array.isArray(row.features_json)) {
        if (hasFeature(row.features_json, input.requiredFeature)) {
          userIdsSet.add(row.user_id)
        }
      }
    }

    const recipientUserIds = Array.from(userIdsSet)

    if (recipientUserIds.length === 0) {
      return
    }

    const notifications: Notification[] = []
    for (const recipientUserId of recipientUserIds) {
      const notification = em.create(Notification, {
        recipientUserId,
        type: input.type,
        titleKey: input.titleKey,
        bodyKey: input.bodyKey,
        titleVariables: input.titleVariables,
        bodyVariables: input.bodyVariables,
        title: input.title || input.titleKey || '',
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
