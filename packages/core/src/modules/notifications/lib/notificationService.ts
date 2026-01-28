import type { EntityManager } from '@mikro-orm/core'
import type { Knex } from 'knex'
import { Notification } from '../data/entities'
import type { CreateNotificationInput, CreateBatchNotificationInput, CreateRoleNotificationInput, CreateFeatureNotificationInput, ExecuteActionInput } from '../data/validators'
import type { NotificationPollData } from '@open-mercato/shared/modules/notifications/types'
import { NOTIFICATION_EVENTS } from './events'
import { buildNotificationEntity, emitNotificationCreated, emitNotificationCreatedBatch } from './notificationFactory'
import { toNotificationDto } from './notificationMapper'
import { getRecipientUserIdsForFeature, getRecipientUserIdsForRole } from './notificationRecipients'

const DEBUG = process.env.NOTIFICATIONS_DEBUG === 'true'

function debug(...args: unknown[]): void {
  if (DEBUG) {
    console.log('[notifications]', ...args)
  }
}

function getKnex(em: EntityManager): Knex {
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
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
  restoreDismissed(
    notificationId: string,
    status: 'read' | 'unread' | undefined,
    ctx: NotificationServiceContext
  ): Promise<Notification>
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
  commandBus?: {
    execute: (
      commandId: string,
      options: { input: unknown; ctx: unknown; metadata?: unknown }
    ) => Promise<{ result: unknown }>
  }
  container?: { resolve: (name: string) => unknown }
}

export function createNotificationService(deps: NotificationServiceDeps): NotificationService {
  const { em: rootEm, eventBus, commandBus, container } = deps

  return {
    async create(input, ctx) {
      const em = rootEm.fork()
      const { recipientUserId, ...content } = input
      const notification = buildNotificationEntity(em, content, recipientUserId, ctx)

      await em.persistAndFlush(notification)

      await emitNotificationCreated(eventBus, notification, ctx)

      return notification
    },

    async createBatch(input, ctx) {
      const em = rootEm.fork()
      const { recipientUserIds, ...content } = input
      const notifications: Notification[] = []

      for (const recipientUserId of recipientUserIds) {
        const notification = buildNotificationEntity(em, content, recipientUserId, ctx)
        notifications.push(notification)
      }

      await em.persistAndFlush(notifications)

      await emitNotificationCreatedBatch(eventBus, notifications, ctx)

      return notifications
    },

    async createForRole(input, ctx) {
      const em = rootEm.fork()

      const knex = getKnex(em)
      const recipientUserIds = await getRecipientUserIdsForRole(knex, ctx.tenantId, input.roleId)
      if (recipientUserIds.length === 0) {
        return []
      }

      const { roleId: _roleId, ...content } = input
      const notifications: Notification[] = []

      for (const recipientUserId of recipientUserIds) {
        const notification = buildNotificationEntity(em, content, recipientUserId, ctx)
        notifications.push(notification)
      }

      await em.persistAndFlush(notifications)

      await emitNotificationCreatedBatch(eventBus, notifications, ctx)

      return notifications
    },

    async createForFeature(input, ctx) {
      const em = rootEm.fork()
      const knex = getKnex(em)
      const recipientUserIds = await getRecipientUserIdsForFeature(knex, ctx.tenantId, input.requiredFeature)

      if (recipientUserIds.length === 0) {
        debug('No users found with feature:', input.requiredFeature, 'in tenant:', ctx.tenantId)
        return []
      }

      debug('Creating notifications for', recipientUserIds.length, 'user(s) with feature:', input.requiredFeature)

      const { requiredFeature: _requiredFeature, ...content } = input
      const notifications: Notification[] = []

      for (const recipientUserId of recipientUserIds) {
        const notification = buildNotificationEntity(em, content, recipientUserId, ctx)
        notifications.push(notification)
      }

      await em.persistAndFlush(notifications)

      await emitNotificationCreatedBatch(eventBus, notifications, ctx)

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

    async restoreDismissed(notificationId, status, ctx) {
      const em = rootEm.fork()
      const notification = await em.findOneOrFail(Notification, {
        id: notificationId,
        recipientUserId: ctx.userId,
        tenantId: ctx.tenantId,
      })

      if (notification.status !== 'dismissed') {
        return notification
      }

      const targetStatus = status ?? 'read'
      notification.status = targetStatus
      notification.dismissedAt = null

      if (targetStatus === 'unread') {
        notification.readAt = null
      } else if (!notification.readAt) {
        notification.readAt = new Date()
      }

      await em.flush()

      await eventBus.emit(NOTIFICATION_EVENTS.RESTORED, {
        notificationId: notification.id,
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        status: targetStatus,
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

      if (action.commandId && commandBus && container) {
        const commandInput = {
          id: notification.sourceEntityId,
          ...input.payload,
        }

        // Build a CommandRuntimeContext from the notification service context
        const commandCtx = {
          container,
          auth: {
            sub: ctx.userId,
            tenantId: ctx.tenantId,
            orgId: ctx.organizationId,
          },
          organizationScope: null,
          selectedOrganizationId: ctx.organizationId ?? null,
          organizationIds: ctx.organizationId ? [ctx.organizationId] : null,
        }

        const commandResult = await commandBus.execute(action.commandId, {
          input: commandInput,
          ctx: commandCtx,
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

      const recent = notifications.map(toNotificationDto)
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

/**
 * Helper to create notification service from a DI container.
 * Use this in API routes and commands to avoid DI resolution issues.
 */
export function resolveNotificationService(container: {
  resolve: (name: string) => unknown
}): NotificationService {
  const em = container.resolve('em') as EntityManager
  const eventBus = container.resolve('eventBus') as { emit: (event: string, payload: unknown) => Promise<void> }

  // commandBus may not be registered in all contexts, so resolve it safely
  let commandBus: NotificationServiceDeps['commandBus']
  try {
    commandBus = container.resolve('commandBus') as typeof commandBus
  } catch {
    // commandBus not available - actions with commandId won't work
    commandBus = undefined
  }

  return createNotificationService({ em, eventBus, commandBus, container })
}
