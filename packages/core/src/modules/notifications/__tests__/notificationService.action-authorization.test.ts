import { createNotificationService } from '../lib/notificationService'
import { registerNotificationTypes } from '../lib/notification-type-registry'
import type { Notification } from '../data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { NOTIFICATION_ACTION_FORBIDDEN_ERROR_CODE } from '@open-mercato/shared/modules/notifications/types'
import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  invalidateCrudCache: jest.fn().mockResolvedValue(undefined),
}))

const ctx = {
  tenantId: '7f4c85ef-f8f7-4e53-9df1-42e95bd8d48e',
  organizationId: '0b7c3a9e-61c5-4a4b-9b62-9d8f0f2a1c11',
  userId: '2d4a4c33-9c4b-4e39-8e15-0a3cd9a7f432',
}

const sourceEntityId = '1f9d8d1c-319f-48d4-b803-77665b6b2510'

const guardedType: NotificationTypeDefinition = {
  type: 'tests.guarded.pending',
  module: 'tests',
  titleKey: 'tests.guarded.title',
  icon: 'bell',
  severity: 'info',
  actions: [
    {
      id: 'approve',
      labelKey: 'tests.guarded.approve',
      commandId: 'tests.guarded.approve',
      requiredFeatures: ['tests.guarded.manage'],
    },
    {
      id: 'view',
      labelKey: 'common.view',
      href: '/backend/tests/{sourceEntityId}',
    },
  ],
}

const optionalType: NotificationTypeDefinition = {
  type: 'tests.optional.assigned',
  module: 'tests',
  titleKey: 'tests.optional.title',
  icon: 'bell',
  severity: 'info',
  actions: [{ id: 'view', labelKey: 'common.view', href: '/backend/tests/{sourceEntityId}' }],
  optionalActions: [
    {
      id: 'complete',
      labelKey: 'tests.optional.complete',
      commandId: 'tests.optional.complete',
      requiredFeatures: ['tests.optional.complete'],
    },
  ],
}

const buildEm = () => {
  const claimUpdates: unknown[] = []
  const em = {
    fork: jest.fn(),
    flush: jest.fn(),
    getKysely: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  em.getKysely.mockReturnValue({
    updateTable: () => ({
      set: (values: unknown) => {
        claimUpdates.push(values)
        const chain: { where: () => typeof chain; executeTakeFirst: () => Promise<{ numUpdatedRows: bigint }> } = {
          where: () => chain,
          executeTakeFirst: async () => ({ numUpdatedRows: BigInt(1) }),
        }
        return chain
      },
    }),
  })
  return { em, claimUpdates }
}

const buildNotification = (type: string, actions: Array<Record<string, unknown>>): Notification =>
  ({
    id: 'note-guarded',
    type,
    recipientUserId: ctx.userId,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    status: 'unread',
    readAt: null,
    actionedAt: null,
    sourceEntityId,
    actionData: { actions },
  }) as unknown as Notification

const buildContainer = (userHasAllFeatures: jest.Mock | null) => ({
  resolve: jest.fn((name: string) => {
    if (name === 'rbacService' && userHasAllFeatures) return { userHasAllFeatures }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
})

describe('notification action authorization', () => {
  beforeAll(() => {
    registerNotificationTypes([guardedType, optionalType])
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('refuses a declared action when the clicker lacks its required features, before claiming the row', async () => {
    const { em, claimUpdates } = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const commandBus = { execute: jest.fn().mockResolvedValue({ result: { ok: true } }) }
    const userHasAllFeatures = jest.fn().mockResolvedValue(false)
    const service = createNotificationService({ em: em as never, eventBus, commandBus, container: buildContainer(userHasAllFeatures) })
    const notification = buildNotification(guardedType.type, [
      { id: 'approve', label: 'Approve', commandId: 'tests.guarded.approve' },
    ])
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(notification)

    await expect(service.executeAction(notification.id, { actionId: 'approve' }, ctx)).rejects.toMatchObject({
      status: 403,
      body: expect.objectContaining({ code: NOTIFICATION_ACTION_FORBIDDEN_ERROR_CODE }),
    })

    expect(userHasAllFeatures).toHaveBeenCalledWith(ctx.userId, ['tests.guarded.manage'], {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(claimUpdates).toHaveLength(0)
    expect(notification.status).toBe('unread')
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('fails closed when no rbac service can be resolved for a guarded action', async () => {
    const { em } = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const commandBus = { execute: jest.fn().mockResolvedValue({ result: { ok: true } }) }
    const service = createNotificationService({ em: em as never, eventBus, commandBus, container: buildContainer(null) })
    const notification = buildNotification(guardedType.type, [
      { id: 'approve', label: 'Approve', commandId: 'tests.guarded.approve' },
    ])
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(notification)

    await expect(service.executeAction(notification.id, { actionId: 'approve' }, ctx)).rejects.toMatchObject({
      status: 403,
    })
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('runs a declared action for a clicker holding its required features', async () => {
    const { em } = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const commandBus = { execute: jest.fn().mockResolvedValue({ result: { ok: true } }) }
    const userHasAllFeatures = jest.fn().mockResolvedValue(true)
    const service = createNotificationService({ em: em as never, eventBus, commandBus, container: buildContainer(userHasAllFeatures) })
    const notification = buildNotification(guardedType.type, [
      { id: 'approve', label: 'Approve', commandId: 'tests.guarded.approve' },
    ])
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(notification)

    const result = await service.executeAction(notification.id, { actionId: 'approve' }, ctx)

    expect(commandBus.execute).toHaveBeenCalledWith(
      'tests.guarded.approve',
      expect.objectContaining({ input: expect.objectContaining({ id: sourceEntityId }) }),
    )
    expect(result.result).toEqual({ ok: true })
    expect(notification.status).toBe('actioned')
  })

  it('refuses a stored command that differs from the command the type declares for that action', async () => {
    const { em, claimUpdates } = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const commandBus = { execute: jest.fn().mockResolvedValue({ result: { ok: true } }) }
    const userHasAllFeatures = jest.fn().mockResolvedValue(true)
    const service = createNotificationService({ em: em as never, eventBus, commandBus, container: buildContainer(userHasAllFeatures) })
    const notification = buildNotification(guardedType.type, [
      { id: 'approve', label: 'Approve', commandId: 'wms.locations.delete' },
    ])
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(notification)

    await expect(service.executeAction(notification.id, { actionId: 'approve' }, ctx)).rejects.toMatchObject({
      status: 403,
      body: expect.objectContaining({ code: NOTIFICATION_ACTION_FORBIDDEN_ERROR_CODE }),
    })

    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(claimUpdates).toHaveLength(0)
  })

  it('refuses a stored command on an action the type declares as a link', async () => {
    const { em, claimUpdates } = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const commandBus = { execute: jest.fn().mockResolvedValue({ result: { ok: true } }) }
    const service = createNotificationService({ em: em as never, eventBus, commandBus, container: buildContainer(jest.fn()) })
    const notification = buildNotification(guardedType.type, [
      { id: 'view', label: 'View', commandId: 'wms.locations.delete' },
    ])
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(notification)

    await expect(service.executeAction(notification.id, { actionId: 'view' }, ctx)).rejects.toMatchObject({
      status: 403,
    })

    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(claimUpdates).toHaveLength(0)
    expect(notification.status).toBe('unread')
  })

  it('refuses a stored command on an action id its type does not declare', async () => {
    const { em, claimUpdates } = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const commandBus = { execute: jest.fn().mockResolvedValue({ result: { ok: true } }) }
    const service = createNotificationService({ em: em as never, eventBus, commandBus, container: buildContainer(null) })
    const notification = buildNotification(guardedType.type, [
      { id: 'complete', label: 'Complete', commandId: 'tests.guarded.complete' },
    ])
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(notification)

    await expect(service.executeAction(notification.id, { actionId: 'complete' }, ctx)).rejects.toMatchObject({
      status: 403,
    })

    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(claimUpdates).toHaveLength(0)
  })

  it('refuses a stored command on a notification whose type is not registered', async () => {
    const { em, claimUpdates } = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const commandBus = { execute: jest.fn().mockResolvedValue({ result: { ok: true } }) }
    const service = createNotificationService({ em: em as never, eventBus, commandBus, container: buildContainer(jest.fn()) })
    const notification = buildNotification('system.custom', [
      { id: 'approve', label: 'Approve', commandId: 'tests.guarded.approve' },
    ])
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(notification)

    await expect(service.executeAction(notification.id, { actionId: 'approve' }, ctx)).rejects.toMatchObject({
      status: 403,
      body: expect.objectContaining({ code: NOTIFICATION_ACTION_FORBIDDEN_ERROR_CODE }),
    })

    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(claimUpdates).toHaveLength(0)
  })

  it('never runs the declared command for a stored action that carries no command', async () => {
    const { em } = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const commandBus = { execute: jest.fn().mockResolvedValue({ result: { ok: true } }) }
    const userHasAllFeatures = jest.fn().mockResolvedValue(true)
    const service = createNotificationService({ em: em as never, eventBus, commandBus, container: buildContainer(userHasAllFeatures) })
    const notification = buildNotification(guardedType.type, [{ id: 'approve', label: 'Approve' }])
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(notification)

    await service.executeAction(notification.id, { actionId: 'approve' }, ctx)

    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(notification.status).toBe('actioned')
  })

  it('dispatches a command declared in optionalActions after checking its required features', async () => {
    const { em } = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const commandBus = { execute: jest.fn().mockResolvedValue({ result: { ok: true } }) }
    const userHasAllFeatures = jest.fn().mockResolvedValue(true)
    const service = createNotificationService({ em: em as never, eventBus, commandBus, container: buildContainer(userHasAllFeatures) })
    const notification = buildNotification(optionalType.type, [
      { id: 'complete', label: 'Complete', commandId: 'tests.optional.complete' },
    ])
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(notification)

    await service.executeAction(notification.id, { actionId: 'complete' }, ctx)

    expect(userHasAllFeatures).toHaveBeenCalledWith(ctx.userId, ['tests.optional.complete'], {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
    expect(commandBus.execute).toHaveBeenCalledWith('tests.optional.complete', expect.anything())
  })

  it('fails closed when the feature check throws', async () => {
    const { em, claimUpdates } = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const commandBus = { execute: jest.fn().mockResolvedValue({ result: { ok: true } }) }
    const userHasAllFeatures = jest.fn().mockRejectedValue(new Error('rbac down'))
    const service = createNotificationService({ em: em as never, eventBus, commandBus, container: buildContainer(userHasAllFeatures) })
    const notification = buildNotification(guardedType.type, [
      { id: 'approve', label: 'Approve', commandId: 'tests.guarded.approve' },
    ])
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(notification)

    await expect(service.executeAction(notification.id, { actionId: 'approve' }, ctx)).rejects.toMatchObject({
      status: 403,
    })

    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(claimUpdates).toHaveLength(0)
  })

  it('fails closed for a guarded action when the caller has no user id', async () => {
    const { em } = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const commandBus = { execute: jest.fn().mockResolvedValue({ result: { ok: true } }) }
    const userHasAllFeatures = jest.fn().mockResolvedValue(true)
    const service = createNotificationService({ em: em as never, eventBus, commandBus, container: buildContainer(userHasAllFeatures) })
    const notification = buildNotification(guardedType.type, [
      { id: 'approve', label: 'Approve', commandId: 'tests.guarded.approve' },
    ])
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(notification)

    await expect(
      service.executeAction(notification.id, { actionId: 'approve' }, { ...ctx, userId: null }),
    ).rejects.toMatchObject({ status: 403 })

    expect(userHasAllFeatures).not.toHaveBeenCalled()
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('always targets the notification source entity, whatever id the payload carries', async () => {
    const { em } = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const commandBus = { execute: jest.fn().mockResolvedValue({ result: { ok: true } }) }
    const userHasAllFeatures = jest.fn().mockResolvedValue(true)
    const service = createNotificationService({ em: em as never, eventBus, commandBus, container: buildContainer(userHasAllFeatures) })
    const notification = buildNotification(guardedType.type, [
      { id: 'approve', label: 'Approve', commandId: 'tests.guarded.approve' },
    ])
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(notification)

    await service.executeAction(
      notification.id,
      { actionId: 'approve', payload: { id: '99999999-9999-4999-8999-999999999999', note: 'ok' } },
      ctx,
    )

    expect(commandBus.execute).toHaveBeenCalledWith(
      'tests.guarded.approve',
      expect.objectContaining({ input: { id: sourceEntityId, note: 'ok' } }),
    )
  })
})
