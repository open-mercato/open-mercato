import type { EntityManager } from '@mikro-orm/postgresql'
import { type Kysely, sql } from 'kysely'
import { CrudHttpError, conflict } from '@open-mercato/shared/lib/crud/errors'
import { Notification, type NotificationStatus } from '../data/entities'
import type { CreateNotificationInput, CreateBatchNotificationInput, CreateRoleNotificationInput, CreateFeatureNotificationInput, ExecuteActionInput } from '../data/validators'
import type { NotificationPollData } from '@open-mercato/shared/modules/notifications/types'
import { NOTIFICATION_EVENTS, NOTIFICATION_SSE_EVENTS } from './events'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  buildNotificationEntity,
  emitNotificationCreated,
  emitNotificationCreatedBatch,
  type NotificationContentInput,
  type NotificationTenantContext,
} from './notificationFactory'
import { toNotificationDto } from './notificationMapper'
import {
  getRecipientUserIdsForFeature,
  getRecipientUserIdsForRole,
  getScopedNotificationRecipientUserIds,
} from './notificationRecipients'
import { assertSafeNotificationHref, sanitizeNotificationActions } from './safeHref'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getNotificationType } from './notification-type-registry'
import { getNotificationTypeOverrides, type NotificationTypeOverrides } from './typeOverrides'
import { getNotificationDeliveryStrategies } from './deliveryStrategies'
import { resolveEffectiveChannels } from './shouldDeliver'
import {
  createNotificationPreferenceService,
  type NotificationPreferenceService,
} from './notificationPreferenceService'
import { inAppVisibleFilter, inAppVisibleSql, isInAppVisible } from './notificationVisibility'

const logger = createLogger('notifications').child({ component: 'service' })

function debug(message: string, ...details: unknown[]): void {
  logger.debug(message, details.length ? { details } : undefined)
}

function getDb(em: EntityManager): Kysely<any> {
  return em.getKysely<any>()
}

const UNIQUE_NOTIFICATION_ACTIVE_STATUSES: NotificationStatus[] = ['unread', 'read', 'actioned']

function normalizeOrgScope(organizationId: string | null | undefined): string | null {
  return organizationId ?? null
}

async function assertNotificationRecipientsInScope(
  em: EntityManager,
  recipientUserIds: string[],
  ctx: NotificationServiceContext,
): Promise<void> {
  const scopedRecipientUserIds = await getScopedNotificationRecipientUserIds(
    getDb(em),
    ctx.tenantId,
    normalizeOrgScope(ctx.organizationId),
    recipientUserIds,
  )

  if (scopedRecipientUserIds.length !== recipientUserIds.length) {
    throw new CrudHttpError(404, { error: 'Notification recipient not found' })
  }
}

function applyNotificationContent(
  notification: Notification,
  input: NotificationContentInput,
  recipientUserId: string,
  ctx: NotificationTenantContext,
  channels: string[] | null,
) {
  const actions = sanitizeNotificationActions(input.actions)
  const linkHref = assertSafeNotificationHref(input.linkHref)

  notification.recipientUserId = recipientUserId
  notification.type = input.type
  notification.titleKey = input.titleKey
  notification.bodyKey = input.bodyKey
  notification.titleVariables = input.titleVariables
  notification.bodyVariables = input.bodyVariables
  notification.title = input.title || input.titleKey || ''
  notification.body = input.body
  notification.icon = input.icon
  notification.severity = input.severity ?? 'info'
  notification.actionData = actions
    ? {
        actions,
        primaryActionId: input.primaryActionId,
      }
    : null
  notification.sourceModule = input.sourceModule
  notification.sourceEntityType = input.sourceEntityType
  notification.sourceEntityId = input.sourceEntityId
  notification.linkHref = linkHref
  notification.groupKey = input.groupKey
  notification.channels = channels
  notification.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
  notification.tenantId = ctx.tenantId
  notification.organizationId = normalizeOrgScope(ctx.organizationId)
  notification.status = 'unread'
  notification.readAt = null
  notification.actionedAt = null
  notification.dismissedAt = null
  notification.actionTaken = null
  notification.actionResult = null
  notification.createdAt = new Date()
}

async function findScopedNotificationOrThrow(
  em: EntityManager,
  notificationId: string,
  ctx: NotificationServiceContext,
): Promise<Notification> {
  const notification = await findOneWithDecryption(
    em,
    Notification,
    {
      id: notificationId,
      recipientUserId: ctx.userId,
      tenantId: ctx.tenantId,
    },
    undefined,
    {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId ?? null,
    },
  )
  if (!notification) {
    throw new CrudHttpError(404, { error: 'Notification not found' })
  }
  return notification
}

async function emitNotificationSseEvents(
  eventBus: { emit: (event: string, payload: unknown) => Promise<void> },
  notifications: Notification[],
  ctx: NotificationServiceContext,
): Promise<void> {
  // Live bell updates only for notifications actually delivered to the in-app channel; the others
  // exist as records but must not bump anyone's badge/inbox.
  const visible = notifications.filter((notification) => isInAppVisible(notification.channels))
  if (visible.length === 0) return

  const visibleRecipientUserIds = Array.from(new Set(visible.map((n) => n.recipientUserId)))
  await eventBus.emit(NOTIFICATION_SSE_EVENTS.BATCH_CREATED, {
    tenantId: ctx.tenantId,
    organizationId: normalizeOrgScope(ctx.organizationId),
    recipientUserIds: visibleRecipientUserIds,
    count: visible.length,
  })

  for (const notification of visible) {
    await eventBus.emit(NOTIFICATION_SSE_EVENTS.CREATED, {
      tenantId: notification.tenantId,
      organizationId: notification.organizationId ?? null,
      recipientUserId: notification.recipientUserId,
      notification: toNotificationDto(notification),
    })
  }
}

async function createOrRefreshNotification(
  em: EntityManager,
  input: NotificationContentInput,
  recipientUserId: string,
  ctx: NotificationTenantContext,
  channels: string[] | null,
): Promise<Notification> {
  if (input.groupKey && input.groupKey.trim().length > 0) {
    const orgScope = normalizeOrgScope(ctx.organizationId) ?? 'global'
    const lockKey = `notifications:${ctx.tenantId}:${orgScope}:${recipientUserId}:${input.type}:${input.groupKey}`
    try {
      const db = getDb(em)
      await sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`.execute(db)
    } catch {
      // If advisory locks are unavailable, continue with best-effort dedupe.
    }

    const existing = await em.findOne(Notification, {
      recipientUserId,
      tenantId: ctx.tenantId,
      organizationId: normalizeOrgScope(ctx.organizationId),
      type: input.type,
      groupKey: input.groupKey,
      status: { $in: UNIQUE_NOTIFICATION_ACTIVE_STATUSES },
    }, {
      orderBy: { createdAt: 'desc' },
    })

    if (existing) {
      applyNotificationContent(existing, input, recipientUserId, ctx, channels)
      return existing
    }
  }

  return buildNotificationEntity(em, input, recipientUserId, ctx, channels)
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

  /**
   * Resolves the authoritative delivery-channel set for one recipient at create time — the single
   * gate that folds per-send target, per-type eligibility, registered strategies, and the
   * recipient's per-channel preferences (`nonOptOut` bypasses opt-out). Stored on the row and
   * replayed by the dispatcher; `in_app` membership also drives bell/inbox visibility.
   *
   * Returns `null` (⇒ "all channels", legacy behavior) when no delivery strategies are registered
   * (e.g. a minimal bootstrap/test), so notifications never become silently undeliverable/invisible
   * in an environment that simply hasn't wired the seam.
   */
  const resolveChannelsFor = async (
    content: NotificationContentInput,
    recipientUserId: string,
    scopeCtx: NotificationServiceContext,
    preferences: NotificationPreferenceService = createNotificationPreferenceService({ em: rootEm.fork() }),
    typeOverrides?: NotificationTypeOverrides | null,
  ): Promise<string[] | null> => {
    const registeredChannels = getNotificationDeliveryStrategies().map((strategy) => strategy.id)
    if (registeredChannels.length === 0) return null
    // Treat an empty target as "no restriction" (all channels) rather than "no deliverable channel":
    // a programmatic caller that computed an empty array should not silently black-hole the
    // notification. The HTTP layer rejects an empty `channels` outright (see validators.ts).
    const targetChannels = content.channels && content.channels.length > 0 ? content.channels : null
    const overrides = typeOverrides === undefined
      ? (await getNotificationTypeOverrides(rootEm.fork(), scopeCtx.tenantId, [content.type])).get(content.type) ?? null
      : typeOverrides
    return resolveEffectiveChannels({
      typeId: content.type,
      type: getNotificationType(content.type),
      scope: { tenantId: scopeCtx.tenantId, userId: recipientUserId },
      targetChannels,
      registeredChannels,
      preferences,
      channelsOverride: overrides?.channels ?? null,
      nonOptOutOverride: overrides?.nonOptOut ?? null,
    })
  }

  /**
   * Broadcast counterpart of {@link resolveChannelsFor}: resolves the channel set for every recipient
   * up front, BEFORE the write transaction opens, reusing a single forked EM / preference service
   * across the whole set. This keeps the preference reads out of the write transaction (matching
   * `create`, which resolves before its transaction) and avoids one EM fork per recipient on large
   * role/feature broadcasts.
   */
  const resolveChannelsForRecipients = async (
    content: NotificationContentInput,
    recipientUserIds: string[],
    scopeCtx: NotificationServiceContext,
  ): Promise<Array<{ recipientUserId: string; channels: string[] | null }>> => {
    const preferences = createNotificationPreferenceService({ em: rootEm.fork() })
    // Stored overrides are per-type (not per-recipient) — read once for the whole broadcast.
    const typeOverrides =
      (await getNotificationTypeOverrides(rootEm.fork(), scopeCtx.tenantId, [content.type])).get(content.type) ?? null
    const resolved: Array<{ recipientUserId: string; channels: string[] | null }> = []
    for (const recipientUserId of recipientUserIds) {
      resolved.push({
        recipientUserId,
        channels: await resolveChannelsFor(content, recipientUserId, scopeCtx, preferences, typeOverrides),
      })
    }
    return resolved
  }

  return {
    async create(input, ctx) {
      const { recipientUserId, ...content } = input
      const channels = await resolveChannelsFor(content, recipientUserId, ctx)
      const writeEm = rootEm.fork()
      const notification = await writeEm.transactional(async (tx) => {
        await assertNotificationRecipientsInScope(tx, [recipientUserId], ctx)
        const entity = await createOrRefreshNotification(tx, content, recipientUserId, ctx, channels)
        await tx.flush()
        return entity
      })

      // Always emit the domain event (drives the deliver subscriber → push/email/…). Only bump the
      // live in-app bell when this notification is actually visible in-app.
      await emitNotificationCreated(eventBus, notification, ctx)
      if (isInAppVisible(notification.channels)) {
        await eventBus.emit(NOTIFICATION_SSE_EVENTS.CREATED, {
          tenantId: notification.tenantId,
          organizationId: notification.organizationId ?? null,
          recipientUserId: notification.recipientUserId,
          notification: toNotificationDto(notification),
        })
      }

      return notification
    },

    async createBatch(input, ctx) {
      const recipientUserIds = Array.from(new Set(input.recipientUserIds))
      const { recipientUserIds: _recipientUserIds, ...content } = input
      const notifications: Notification[] = []
      const resolved = await resolveChannelsForRecipients(content, recipientUserIds, ctx)
      const writeEm = rootEm.fork()

      await writeEm.transactional(async (tx) => {
        await assertNotificationRecipientsInScope(tx, recipientUserIds, ctx)
        for (const { recipientUserId, channels } of resolved) {
          const notification = await createOrRefreshNotification(tx, content, recipientUserId, ctx, channels)
          notifications.push(notification)
        }
        await tx.flush()
      })

      await emitNotificationCreatedBatch(eventBus, notifications, ctx)
      await emitNotificationSseEvents(eventBus, notifications, ctx)

      return notifications
    },

    async createForRole(input, ctx) {
      const em = rootEm.fork()

      const db = getDb(em)
      const recipientUserIds = await getRecipientUserIdsForRole(db, ctx.tenantId, input.roleId)
      if (recipientUserIds.length === 0) {
        return []
      }

      const { roleId: _roleId, ...content } = input
      const notifications: Notification[] = []
      const uniqueRecipientUserIds = Array.from(new Set(recipientUserIds))
      const resolved = await resolveChannelsForRecipients(content, uniqueRecipientUserIds, ctx)
      const writeEm = rootEm.fork()

      await writeEm.transactional(async (tx) => {
        for (const { recipientUserId, channels } of resolved) {
          const notification = await createOrRefreshNotification(tx, content, recipientUserId, ctx, channels)
          notifications.push(notification)
        }
        await tx.flush()
      })

      await emitNotificationCreatedBatch(eventBus, notifications, ctx)
      await emitNotificationSseEvents(eventBus, notifications, ctx)

      return notifications
    },

    async createForFeature(input, ctx) {
      const em = rootEm.fork()
      const db = getDb(em)
      const recipientUserIds = await getRecipientUserIdsForFeature(db, ctx.tenantId, input.requiredFeature)

      if (recipientUserIds.length === 0) {
        debug('No users found with feature:', input.requiredFeature, 'in tenant:', ctx.tenantId)
        return []
      }

      debug('Creating notifications for', recipientUserIds.length, 'user(s) with feature:', input.requiredFeature)

      const { requiredFeature: _requiredFeature, ...content } = input
      const notifications: Notification[] = []
      const uniqueRecipientUserIds = Array.from(new Set(recipientUserIds))
      const resolved = await resolveChannelsForRecipients(content, uniqueRecipientUserIds, ctx)
      const writeEm = rootEm.fork()

      await writeEm.transactional(async (tx) => {
        for (const { recipientUserId, channels } of resolved) {
          const notification = await createOrRefreshNotification(tx, content, recipientUserId, ctx, channels)
          notifications.push(notification)
        }
        await tx.flush()
      })

      await emitNotificationCreatedBatch(eventBus, notifications, ctx)
      await emitNotificationSseEvents(eventBus, notifications, ctx)

      return notifications
    },

    async markAsRead(notificationId, ctx) {
      const em = rootEm.fork()
      const notification = await findScopedNotificationOrThrow(em, notificationId, ctx)

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
      const db = getDb(em)
      const applyScope = <QB extends { where: (...args: any[]) => QB }>(q: QB): QB => {
        let chain = q
          .where('recipient_user_id' as any, '=', ctx.userId as any)
          .where('tenant_id' as any, '=', ctx.tenantId)
          .where('status' as any, '=', 'unread')
          // Only in-app-visible rows count toward the badge (see getUnreadCount),
          // so "mark all as read" must scope to the SAME set — otherwise it flips
          // push/email-only rows the user never saw and SSE-broadcasts a read for
          // notifications that were never in the bell, inflating the returned
          // count past what the badge showed.
          .where(inAppVisibleSql() as any)
        if (ctx.organizationId) {
          chain = chain.where('organization_id' as any, '=', ctx.organizationId)
        }
        return chain
      }

      const targetRows = await applyScope(
        db
          .selectFrom('notifications' as any)
          .select([
            'id' as any,
            'organization_id' as any,
            'recipient_user_id' as any,
          ]),
      ).execute() as Array<{ id: string }>

      if (!targetRows.length) {
        return 0
      }

      const updateResult = await applyScope(
        db.updateTable('notifications' as any).set({
          status: 'read',
          read_at: sql`now()`,
        } as any) as any,
      ).executeTakeFirst() as { numUpdatedRows?: bigint | number } | undefined
      const result = Number(updateResult?.numUpdatedRows ?? targetRows.length)

      const notifications = await findWithDecryption(em, Notification, {
        id: { $in: targetRows.map((row) => row.id) },
      }, undefined, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
      })

      for (const notification of notifications) {
        await eventBus.emit(NOTIFICATION_EVENTS.READ, {
          notificationId: notification.id,
          userId: ctx.userId,
          tenantId: ctx.tenantId,
        })

        await eventBus.emit(NOTIFICATION_SSE_EVENTS.CREATED, {
          tenantId: notification.tenantId,
          organizationId: notification.organizationId ?? null,
          recipientUserId: notification.recipientUserId,
          notification: toNotificationDto(notification),
        })
      }

      return result
    },

    async dismiss(notificationId, ctx) {
      const em = rootEm.fork()
      const notification = await findScopedNotificationOrThrow(em, notificationId, ctx)

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
      const notification = await findScopedNotificationOrThrow(em, notificationId, ctx)

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
      const notification = await findScopedNotificationOrThrow(em, notificationId, ctx)

      const actionData = notification.actionData
      const action = actionData?.actions?.find((a) => a.id === input.actionId)

      if (!action) {
        throw new Error('Action not found')
      }

      // Reject an already-actioned notification before dispatching the command,
      // so a retry or double-click cannot re-run the side effect.
      if (notification.status === 'actioned') {
        throw conflict('Notification action already executed')
      }

      const actionedAt = new Date()
      const previousStatus = notification.status
      const previousActionedAt = notification.actionedAt ?? null
      const previousActionTaken = notification.actionTaken ?? null

      // Atomically claim the notification so only one concurrent request can run
      // the side-effecting command. The conditional UPDATE matches only while the
      // notification has not been actioned yet; a losing request updates 0 rows.
      const claimResult = (await getDb(em)
        .updateTable('notifications' as any)
        .set({
          status: 'actioned',
          actioned_at: actionedAt,
          action_taken: input.actionId,
        } as any)
        .where('id' as any, '=', notification.id)
        .where('recipient_user_id' as any, '=', ctx.userId as any)
        .where('tenant_id' as any, '=', ctx.tenantId)
        .where('status' as any, '!=', 'actioned')
        .executeTakeFirst()) as { numUpdatedRows?: bigint | number } | undefined

      if (Number(claimResult?.numUpdatedRows ?? 0) === 0) {
        throw conflict('Notification action already executed')
      }

      // The claim is provisional: if the side-effecting command fails, the action
      // never actually completed, so release the claim to its prior state. This
      // lets the user retry the action instead of the notification being locked as
      // `actioned` forever. Only release while we still own the claim
      // (status = 'actioned'), so a concurrent winner's state is never clobbered.
      const releaseClaim = async () => {
        await getDb(em)
          .updateTable('notifications' as any)
          .set({
            status: previousStatus,
            actioned_at: previousActionedAt,
            action_taken: previousActionTaken,
          } as any)
          .where('id' as any, '=', notification.id)
          .where('recipient_user_id' as any, '=', ctx.userId as any)
          .where('tenant_id' as any, '=', ctx.tenantId)
          .where('status' as any, '=', 'actioned')
          .executeTakeFirst()
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

        let commandResult: { result: unknown }
        try {
          commandResult = await commandBus.execute(action.commandId, {
            input: commandInput,
            ctx: commandCtx,
            metadata: {
              tenantId: ctx.tenantId,
              organizationId: ctx.organizationId,
              resourceKind: 'notifications',
            },
          })
        } catch (err) {
          // Never let a rollback failure mask the original command error — the
          // caller needs the real failure to decide whether to retry.
          try {
            await releaseClaim()
          } catch (releaseErr) {
            debug('failed to release notification action claim', releaseErr)
          }
          throw err
        }

        result = commandResult.result
      }

      notification.status = 'actioned'
      notification.actionedAt = actionedAt
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
        ...inAppVisibleFilter(),
      })
    },

    async getPollData(ctx, since) {
      const em = rootEm.fork()
      const filters: Record<string, unknown> = {
        recipientUserId: ctx.userId,
        tenantId: ctx.tenantId,
        ...inAppVisibleFilter(),
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
          ...inAppVisibleFilter(),
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
      const db = getDb(em)

      const updateResult = await db
        .updateTable('notifications' as any)
        .set({
          status: 'dismissed',
          dismissed_at: sql`now()`,
        } as any)
        .where('expires_at' as any, '<', sql`now()`)
        .where('status' as any, 'not in', ['actioned', 'dismissed'])
        .executeTakeFirst() as { numUpdatedRows?: bigint | number } | undefined

      return Number(updateResult?.numUpdatedRows ?? 0)
    },

    async deleteBySource(sourceEntityType, sourceEntityId, ctx) {
      const em = rootEm.fork()
      const db = getDb(em)

      const deleteResult = await db
        .deleteFrom('notifications' as any)
        .where('source_entity_type' as any, '=', sourceEntityType)
        .where('source_entity_id' as any, '=', sourceEntityId)
        .where('tenant_id' as any, '=', ctx.tenantId)
        .executeTakeFirst() as { numDeletedRows?: bigint | number } | undefined

      return Number(deleteResult?.numDeletedRows ?? 0)
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
