import { createNotificationService } from '../lib/notificationService'
import { NOTIFICATION_EVENTS, NOTIFICATION_SSE_EVENTS } from '../lib/events'
import type { Notification } from '../data/entities'
import { getRecipientUserIdsForFeature } from '../lib/notificationRecipients'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

jest.mock('../lib/notificationRecipients', () => ({
  getRecipientUserIdsForRole: jest.fn(),
  getRecipientUserIdsForFeature: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

const baseNotificationInput = {
  type: 'system',
  title: 'Hello',
  recipientUserId: '2d4a4c33-9c4b-4e39-8e15-0a3cd9a7f432',
} as const

const baseCtx = {
  tenantId: '7f4c85ef-f8f7-4e53-9df1-42e95bd8d48e',
  organizationId: null,
  userId: '2d4a4c33-9c4b-4e39-8e15-0a3cd9a7f432',
}

const buildEm = () => {
  const em = {
    fork: jest.fn(),
    transactional: jest.fn(),
    create: jest.fn(),
    persistAndFlush: jest.fn(),
    flush: jest.fn(),
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    count: jest.fn(),
    find: jest.fn(),
    getConnection: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(async (cb: (tx: typeof em) => Promise<unknown>) => cb(em))
  em.getConnection.mockReturnValue({
    getKnex: () => ({}),
  })
  return em
}

describe('notification service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('creates a notification and emits event', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    em.create.mockImplementation((_entity, data: Notification) => ({
      id: 'note-1',
      ...data,
    }))

    const service = createNotificationService({ em, eventBus })

    const notification = await service.create(baseNotificationInput, baseCtx)

    expect(notification.id).toBe('note-1')
    expect(em.flush).toHaveBeenCalled()
    expect(eventBus.emit).toHaveBeenCalledWith(
      NOTIFICATION_EVENTS.CREATED,
      expect.objectContaining({
        notificationId: notification.id,
        recipientUserId: baseNotificationInput.recipientUserId,
        tenantId: baseCtx.tenantId,
      })
    )
  })

  it('reuses grouped notification instead of creating duplicates', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const existing = {
      id: 'note-existing',
      recipientUserId: baseNotificationInput.recipientUserId,
      tenantId: baseCtx.tenantId,
      organizationId: null,
      type: 'system',
      groupKey: 'system:record:1',
      status: 'read',
      createdAt: new Date('2026-02-21T09:00:00.000Z'),
    } as Notification

    em.findOne.mockResolvedValue(existing)

    const service = createNotificationService({ em, eventBus })

    const notification = await service.create({
      ...baseNotificationInput,
      body: 'Updated body',
      groupKey: 'system:record:1',
    }, baseCtx)

    expect(notification.id).toBe('note-existing')
    expect(em.create).not.toHaveBeenCalled()
    expect(notification.status).toBe('unread')
    expect(notification.body).toBe('Updated body')
    expect(em.flush).toHaveBeenCalled()
    expect(eventBus.emit).toHaveBeenCalledWith(
      NOTIFICATION_EVENTS.CREATED,
      expect.objectContaining({
        notificationId: 'note-existing',
      }),
    )
  })

  it('creates batch notifications and emits events for each', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    em.create.mockImplementation((_entity, data: Notification) => ({
      id: `note-${data.recipientUserId}`,
      ...data,
    }))

    const service = createNotificationService({ em, eventBus })

    const notifications = await service.createBatch(
      {
        type: 'system',
        title: 'Hello',
        recipientUserIds: ['e2c9ac54-ecdb-4d79-8d73-8328ca0f16f0', 'e2d9e79c-3f2f-4b8c-9455-6c19b671dc5c'],
      },
      baseCtx
    )

    expect(notifications).toHaveLength(2)
    expect(em.flush).toHaveBeenCalled()
    expect(eventBus.emit).toHaveBeenCalledTimes(5)
    expect(eventBus.emit).toHaveBeenCalledWith(
      NOTIFICATION_SSE_EVENTS.BATCH_CREATED,
      expect.objectContaining({
        tenantId: baseCtx.tenantId,
        organizationId: baseCtx.organizationId,
        recipientUserIds: ['e2c9ac54-ecdb-4d79-8d73-8328ca0f16f0', 'e2d9e79c-3f2f-4b8c-9455-6c19b671dc5c'],
        count: 2,
      }),
    )
  })

  it('returns empty list when no recipients match feature', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const service = createNotificationService({ em, eventBus })

    ;(getRecipientUserIdsForFeature as jest.Mock).mockResolvedValue([])

    const result = await service.createForFeature(
      {
        type: 'system',
        title: 'Hello',
        requiredFeature: 'notifications.view',
      },
      baseCtx
    )

    expect(result).toEqual([])
    expect(em.flush).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('marks a notification as read and emits event', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const service = createNotificationService({ em, eventBus })

    const notification: Notification = {
      id: 'note-2',
      recipientUserId: baseCtx.userId ?? null,
      tenantId: baseCtx.tenantId,
      status: 'unread',
      readAt: null,
    } as Notification

    em.findOneOrFail.mockResolvedValue(notification)

    const result = await service.markAsRead(notification.id, baseCtx)

    expect(result.status).toBe('read')
    expect(result.readAt).toBeInstanceOf(Date)
    expect(em.flush).toHaveBeenCalled()
    expect(eventBus.emit).toHaveBeenCalledWith(
      NOTIFICATION_EVENTS.READ,
      expect.objectContaining({
        notificationId: notification.id,
        userId: baseCtx.userId,
        tenantId: baseCtx.tenantId,
      })
    )
  })

  it('marks all as read, scopes by org, and emits events per notification', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const notifications = [
      {
        id: 'note-11',
        recipientUserId: baseCtx.userId,
        tenantId: baseCtx.tenantId,
        organizationId: 'org-1',
        status: 'read',
        readAt: new Date('2026-03-01T00:00:00Z'),
        createdAt: new Date('2026-02-28T00:00:00Z'),
        type: 'system',
        title: 'Hello',
      },
      {
        id: 'note-12',
        recipientUserId: baseCtx.userId,
        tenantId: baseCtx.tenantId,
        organizationId: 'org-1',
        status: 'read',
        readAt: new Date('2026-03-01T00:00:01Z'),
        createdAt: new Date('2026-02-28T00:00:01Z'),
        type: 'system',
        title: 'Hi again',
      },
    ] as Notification[]

    ;(findWithDecryption as jest.Mock).mockResolvedValue(notifications)

    const knexUpdate = jest.fn().mockResolvedValue(notifications.length)
    const knexSelect = jest.fn().mockResolvedValue(
      notifications.map((n) => ({
        id: n.id,
        organization_id: n.organizationId,
        recipient_user_id: n.recipientUserId,
      }))
    )

    const knexBuilder: any = {
      where: jest.fn().mockReturnThis(),
      whereNull: jest.fn().mockReturnThis(),
      select: knexSelect,
      update: knexUpdate,
      clone: jest.fn(function clone() {
        return this
      }),
      fn: { now: jest.fn(() => 'now') },
    }

    const knexMock = Object.assign(
      jest.fn().mockReturnValue(knexBuilder),
      { fn: knexBuilder.fn },
    )

    em.getConnection.mockReturnValue({
      getKnex: () => knexMock,
    })

    const service = createNotificationService({ em, eventBus })

    const count = await service.markAllAsRead({ ...baseCtx, organizationId: 'org-1' })

    expect(count).toBe(2)
    expect(knexBuilder.where).toHaveBeenCalledWith({
      recipient_user_id: baseCtx.userId,
      tenant_id: baseCtx.tenantId,
      status: 'unread',
    })
    expect(knexBuilder.where).toHaveBeenCalledWith('organization_id', 'org-1')
    expect(findWithDecryption).toHaveBeenCalledWith(
      em,
      expect.anything(),
      { id: { $in: ['note-11', 'note-12'] } },
      undefined,
      { tenantId: baseCtx.tenantId, organizationId: 'org-1' },
    )
    expect(eventBus.emit).toHaveBeenCalledTimes(4)
    for (const note of notifications) {
      expect(eventBus.emit).toHaveBeenCalledWith(
        NOTIFICATION_EVENTS.READ,
        expect.objectContaining({ notificationId: note.id, userId: baseCtx.userId, tenantId: baseCtx.tenantId })
      )
      expect(eventBus.emit).toHaveBeenCalledWith(
        NOTIFICATION_SSE_EVENTS.CREATED,
        expect.objectContaining({
          tenantId: note.tenantId,
          organizationId: note.organizationId,
          recipientUserId: note.recipientUserId,
          notification: expect.objectContaining({ id: note.id, status: 'read' }),
        })
      )
    }
  })

  it('executes notification action via command bus', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const commandBus = { execute: jest.fn().mockResolvedValue({ result: { ok: true } }) }
    const container = { resolve: jest.fn() }
    const service = createNotificationService({ em, eventBus, commandBus, container })

    const notification: Notification = {
      id: 'note-3',
      recipientUserId: baseCtx.userId ?? null,
      tenantId: baseCtx.tenantId,
      status: 'unread',
      readAt: null,
      sourceEntityId: '1f9d8d1c-319f-48d4-b803-77665b6b2510',
      actionData: {
        actions: [
          {
            id: 'approve',
            label: 'Approve',
            commandId: 'sales.approve',
          },
        ],
        primaryActionId: 'approve',
      },
    } as Notification

    em.findOneOrFail.mockResolvedValue(notification)

    const result = await service.executeAction(
      notification.id,
      { actionId: 'approve', payload: { note: 'ok' } },
      baseCtx
    )

    expect(commandBus.execute).toHaveBeenCalledWith(
      'sales.approve',
      expect.objectContaining({
        input: expect.objectContaining({
          id: notification.sourceEntityId,
          note: 'ok',
        }),
        metadata: expect.objectContaining({
          tenantId: baseCtx.tenantId,
          organizationId: baseCtx.organizationId,
          resourceKind: 'notifications',
        }),
      })
    )
    expect(result.result).toEqual({ ok: true })
    expect(notification.status).toBe('actioned')
    expect(notification.actionTaken).toBe('approve')
    expect(eventBus.emit).toHaveBeenCalledWith(
      NOTIFICATION_EVENTS.ACTIONED,
      expect.objectContaining({
        notificationId: notification.id,
        actionId: 'approve',
        userId: baseCtx.userId,
        tenantId: baseCtx.tenantId,
      })
    )
  })
})
