import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import { Notification } from '../data/entities'
import type { CreateNotificationInput, CreateBatchNotificationInput, CreateRoleNotificationInput, CreateFeatureNotificationInput, ExecuteActionInput } from '../data/validators'
import type { NotificationDto, NotificationPollData } from '@open-mercato/shared/modules/notifications/types'
import { NOTIFICATION_EVENTS } from './events'

function getKnex(em: EntityManager): Knex {
  return em.getConnection().getKnex()
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

export interface NotificationServiceContext {
  tenantId: string
  organizationId?: string | null
  userId?: string | null
}

export interface NotificationService {
  create(input: CreateNotificationInput, ctx: NotificationServiceContext): Promise<Notification>
  createBatch(input: CreateBatchNotificationInput, ctx: NotificationServiceContext): Promise<Notification[]>
  createForRole(input: CreateRoleNotificationInput, ctx: NotificationServiceContext): Promise<Notification[]>
  createForFeature(input: CreateFeatureNotificationInput, ctx: NotificationServiceContext): Promise<Notification[]>
  markAsRead(notificationId: string, ctx: NotificationServiceContext): Promise<Notification>
  markAllAsRead(ctx: NotificationServiceContext): Promise<number>
  dismiss(notificationId: string, ctx: NotificationServiceContext): Promise<Notification>
  executeAction(
    notificationId: string,
    input: ExecuteActionInput,
    ctx: NotificationServiceContext
  ): Promise<{ notification: Notification; result: unknown }>
  getUnreadCount(ctx: NotificationServiceContext): Promise<number>
  getPollData(ctx: NotificationServiceContext, since?: string): Promise<NotificationPollData>
  cleanupExpired(): Promise<number>
  deleteBySource(
    sourceEntityType: string,
    sourceEntityId: string,
    ctx: NotificationServiceContext
  ): Promise<number>
}

export interface NotificationServiceDeps {
  em: EntityManager
  eventBus: { emit: (event: string, payload: unknown) => Promise<void> }
  commandBus?: { execute: (commandId: string, payload: unknown) => Promise<{ result: unknown }> }
}

function toDto(notification: Notification): NotificationDto {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    icon: notification.icon,
    severity: notification.severity,
    status: notification.status,
    actions: notification.actionData?.actions?.map((action) => ({
      id: action.id,
      label: action.label,
      variant: action.variant,
      icon: action.icon,
    })) ?? [],
    primaryActionId: notification.actionData?.primaryActionId,
    sourceModule: notification.sourceModule,
    sourceEntityType: notification.sourceEntityType,
    sourceEntityId: notification.sourceEntityId,
    linkHref: notification.linkHref,
    createdAt: notification.createdAt.toISOString(),
    readAt: notification.readAt?.toISOString() ?? null,
    actionTaken: notification.actionTaken,
  }
}

export function createNotificationService(deps: NotificationServiceDeps): NotificationService {
  const { em: rootEm, eventBus, commandBus } = deps

  return {
    async create(input, ctx) {
      const em = rootEm.fork()
      const notification = em.create(Notification, {
        recipientUserId: input.recipientUserId,
        type: input.type,
        // i18n-first: store keys and variables for translation at display time
        titleKey: input.titleKey,
        bodyKey: input.bodyKey,
        titleVariables: input.titleVariables,
        bodyVariables: input.bodyVariables,
        // Fallback text (required for backward compatibility)
        title: input.title || input.titleKey || '',
        body: input.body,
        icon: input.icon,
        severity: input.severity ?? 'info',
        actionData: input.actions ? {
          actions: input.actions,
          primaryActionId: input.primaryActionId,
        } : null,
        sourceModule: input.sourceModule,
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId,
        linkHref: input.linkHref,
        groupKey: input.groupKey,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })

      await em.persistAndFlush(notification)

      await eventBus.emit(NOTIFICATION_EVENTS.CREATED, {
        notificationId: notification.id,
        recipientUserId: notification.recipientUserId,
        type: notification.type,
        title: notification.title,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })

      return notification
    },

    async createBatch(input, ctx) {
      const em = rootEm.fork()
      const notifications: Notification[] = []

      for (const recipientUserId of input.recipientUserIds) {
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
          actionData: input.actions ? {
            actions: input.actions,
            primaryActionId: input.primaryActionId,
          } : null,
          sourceModule: input.sourceModule,
          sourceEntityType: input.sourceEntityType,
          sourceEntityId: input.sourceEntityId,
          linkHref: input.linkHref,
          groupKey: input.groupKey,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
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
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
        })
      }

      return notifications
    },

    async createForRole(input, ctx) {
      const em = rootEm.fork()

      const knex = getKnex(em)
      const userRoles = await knex('user_roles')
        .join('users', 'user_roles.user_id', 'users.id')
        .where('user_roles.role_id', input.roleId)
        .whereNull('user_roles.deleted_at')
        .whereNull('users.deleted_at')
        .where('users.tenant_id', ctx.tenantId)
        .select('users.id as user_id')

      if (userRoles.length === 0) {
        return []
      }

      const recipientUserIds = userRoles.map((row: { user_id: string }) => row.user_id)
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
          actionData: input.actions ? {
            actions: input.actions,
            primaryActionId: input.primaryActionId,
          } : null,
          sourceModule: input.sourceModule,
          sourceEntityType: input.sourceEntityType,
          sourceEntityId: input.sourceEntityId,
          linkHref: input.linkHref,
          groupKey: input.groupKey,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
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
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
        })
      }

      return notifications
    },

    async createForFeature(input, ctx) {
      const em = rootEm.fork()
      const knex = getKnex(em)

      // Find all users with the required feature
      // This includes:
      // 1. Users with direct user ACL granting the feature or is_super_admin
      // 2. Users with roles that have the feature or is_super_admin
      const userIdsSet = new Set<string>()

      // Query 1: Users with direct user ACL
      const userAcls = await knex('user_acls')
        .join('users', 'user_acls.user_id', 'users.id')
        .where('user_acls.tenant_id', ctx.tenantId)
        .whereNull('user_acls.deleted_at')
        .whereNull('users.deleted_at')
        .where('users.tenant_id', ctx.tenantId)
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
        .where('role_acls.tenant_id', ctx.tenantId)
        .whereNull('role_acls.deleted_at')
        .whereNull('user_roles.deleted_at')
        .whereNull('users.deleted_at')
        .where('users.tenant_id', ctx.tenantId)
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
        return []
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
          actionData: input.actions ? {
            actions: input.actions,
            primaryActionId: input.primaryActionId,
          } : null,
          sourceModule: input.sourceModule,
          sourceEntityType: input.sourceEntityType,
          sourceEntityId: input.sourceEntityId,
          linkHref: input.linkHref,
          groupKey: input.groupKey,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
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
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
        })
      }

      return notifications
    },

    async markAsRead(notificationId, ctx) {
      const em = rootEm.fork()
      const notification = await em.findOneOrFail(Notification, {
        id: notificationId,
        recipientUserId: ctx.userId,
        tenantId: ctx.tenantId,
      })

      if (notification.status === 'unread') {
        notification.status = 'read'
        notification.readAt = new Date()
        await em.flush()

        await eventBus.emit(NOTIFICATION_EVENTS.READ, {
          notificationId: notification.id,
          userId: ctx.userId,
          tenantId: ctx.tenantId,
        })
      }

      return notification
    },

    async markAllAsRead(ctx) {
      const em = rootEm.fork()
      const knex = getKnex(em)

      const result = await knex('notifications')
        .where({
          recipient_user_id: ctx.userId,
          tenant_id: ctx.tenantId,
          status: 'unread',
        })
        .update({
          status: 'read',
          read_at: knex.fn.now(),
        })

      return result
    },

    async dismiss(notificationId, ctx) {
      const em = rootEm.fork()
      const notification = await em.findOneOrFail(Notification, {
        id: notificationId,
        recipientUserId: ctx.userId,
        tenantId: ctx.tenantId,
      })

      notification.status = 'dismissed'
      notification.dismissedAt = new Date()
      await em.flush()

      await eventBus.emit(NOTIFICATION_EVENTS.DISMISSED, {
        notificationId: notification.id,
        userId: ctx.userId,
        tenantId: ctx.tenantId,
      })

      return notification
    },

    async executeAction(notificationId, input, ctx) {
      const em = rootEm.fork()
      const notification = await em.findOneOrFail(Notification, {
        id: notificationId,
        recipientUserId: ctx.userId,
        tenantId: ctx.tenantId,
      })

      const actionData = notification.actionData
      const action = actionData?.actions?.find((a) => a.id === input.actionId)

      if (!action) {
        throw new Error('Action not found')
      }

      let result: unknown = null

      if (action.commandId && commandBus) {
        const commandInput = {
          id: notification.sourceEntityId,
          ...input.payload,
        }

        const commandResult = await commandBus.execute(action.commandId, {
          input: commandInput,
          metadata: {
            tenantId: ctx.tenantId,
            organizationId: ctx.organizationId,
            resourceKind: 'notifications',
          },
        })

        result = commandResult.result
      }

      notification.status = 'actioned'
      notification.actionedAt = new Date()
      notification.actionTaken = input.actionId
      notification.actionResult = result as Record<string, unknown>

      if (!notification.readAt) {
        notification.readAt = new Date()
      }

      await em.flush()

      await eventBus.emit(NOTIFICATION_EVENTS.ACTIONED, {
        notificationId: notification.id,
        actionId: input.actionId,
        userId: ctx.userId,
        tenantId: ctx.tenantId,
      })

      return { notification, result }
    },

    async getUnreadCount(ctx) {
      const em = rootEm.fork()
      return em.count(Notification, {
        recipientUserId: ctx.userId,
        tenantId: ctx.tenantId,
        status: 'unread',
      })
    },

    async getPollData(ctx, since) {
      const em = rootEm.fork()
      const filters: Record<string, unknown> = {
        recipientUserId: ctx.userId,
        tenantId: ctx.tenantId,
      }

      if (since) {
        filters.createdAt = { $gt: new Date(since) }
      }

      const [notifications, unreadCount] = await Promise.all([
        em.find(Notification, filters, {
          orderBy: { createdAt: 'desc' },
          limit: 50,
        }),
        em.count(Notification, {
          recipientUserId: ctx.userId,
          tenantId: ctx.tenantId,
          status: 'unread',
        }),
      ])

      const recent = notifications.map(toDto)
      const hasNew = since ? recent.length > 0 : false

      return {
        unreadCount,
        recent,
        hasNew,
        lastId: recent[0]?.id,
      }
    },

    async cleanupExpired() {
      const em = rootEm.fork()
      const knex = getKnex(em)

      const result = await knex('notifications')
        .where('expires_at', '<', knex.fn.now())
        .whereNotIn('status', ['actioned', 'dismissed'])
        .update({
          status: 'dismissed',
          dismissed_at: knex.fn.now(),
        })

      return result
    },

    async deleteBySource(sourceEntityType, sourceEntityId, ctx) {
      const em = rootEm.fork()
      const knex = getKnex(em)

      const result = await knex('notifications')
        .where({
          source_entity_type: sourceEntityType,
          source_entity_id: sourceEntityId,
          tenant_id: ctx.tenantId,
        })
        .delete()

      return result
    },
  }
}
