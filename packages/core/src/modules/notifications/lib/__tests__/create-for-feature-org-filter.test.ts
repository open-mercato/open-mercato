import { createNotificationService } from '../notificationService'
import { getRecipientUserIdsForFeature } from '../notificationRecipients'

jest.mock('../notificationRecipients', () => ({
  getRecipientUserIdsForFeature: jest.fn(),
  getRecipientUserIdsForRole: jest.fn(),
  getScopedNotificationRecipientUserIds: jest.fn(),
}))

const getRecipientsMock = getRecipientUserIdsForFeature as jest.MockedFunction<
  typeof getRecipientUserIdsForFeature
>

const tenantId = '7f4c85ef-f8f7-4e53-9df1-42e95bd8d48e'
const organizationId = '09a2c9be-4a41-47a5-a67c-4ebf6d318024'
const requiredFeature = 'eudr.statements.manage'

type MockEntityManager = {
  fork: jest.Mock
  transactional: jest.Mock
  create: jest.Mock
  flush: jest.Mock
  findOne: jest.Mock
  getKysely: jest.Mock
}

function buildEntityManager(): MockEntityManager {
  const entityManager: MockEntityManager = {
    fork: jest.fn(),
    transactional: jest.fn(),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
      id: `notification-${String(data.recipientUserId)}`,
      createdAt: new Date('2026-07-22T12:00:00.000Z'),
      status: 'unread',
      ...data,
    })),
    flush: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn().mockResolvedValue(null),
    getKysely: jest.fn().mockReturnValue({}),
  }
  entityManager.fork.mockReturnValue(entityManager)
  entityManager.transactional.mockImplementation(
    async (callback: (tx: MockEntityManager) => Promise<unknown>) => callback(entityManager),
  )
  return entityManager
}

function buildInput(restrictRecipientsToOrganization = true) {
  return {
    type: 'eudr.statement.submitted',
    title: 'eudr.notifications.statement.submitted.title',
    requiredFeature,
    restrictRecipientsToOrganization,
  }
}

describe('notification service createForFeature organization filtering', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('creates notifications only for candidates authorized in the target organization', async () => {
    const entityManager = buildEntityManager()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const userHasAllFeatures = jest.fn(async (userId: string) => userId === 'user-allowed')
    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'rbacService') return { userHasAllFeatures }
        throw new Error(`Unexpected service: ${name}`)
      }),
    }
    getRecipientsMock.mockResolvedValue(['user-allowed', 'user-denied'])

    const service = createNotificationService({
      em: entityManager as never,
      eventBus,
      container,
    })
    const result = await service.createForFeature(buildInput(), { tenantId, organizationId })

    expect(result).toHaveLength(1)
    expect(userHasAllFeatures).toHaveBeenCalledTimes(2)
    expect(userHasAllFeatures).toHaveBeenCalledWith(
      'user-allowed',
      [requiredFeature],
      { tenantId, organizationId },
    )
    expect(entityManager.create).toHaveBeenCalledTimes(1)
    expect(entityManager.create.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      recipientUserId: 'user-allowed',
      tenantId,
      organizationId,
    }))
    expect(entityManager.create.mock.calls[0]?.[1]).not.toHaveProperty('requiredFeature')
    expect(entityManager.create.mock.calls[0]?.[1]).not.toHaveProperty('restrictRecipientsToOrganization')
  })

  it('fails closed when the RBAC service cannot be resolved', async () => {
    const entityManager = buildEntityManager()
    getRecipientsMock.mockResolvedValue(['user-1'])
    const service = createNotificationService({
      em: entityManager as never,
      eventBus: { emit: jest.fn().mockResolvedValue(undefined) },
      container: { resolve: jest.fn(() => { throw new Error('rbac unavailable') }) },
    })

    await expect(service.createForFeature(buildInput(), { tenantId, organizationId })).resolves.toEqual([])
    expect(entityManager.create).not.toHaveBeenCalled()
    expect(entityManager.transactional).not.toHaveBeenCalled()
  })

  it('fails closed when the service was constructed without a container', async () => {
    const entityManager = buildEntityManager()
    getRecipientsMock.mockResolvedValue(['user-1'])
    const service = createNotificationService({
      em: entityManager as never,
      eventBus: { emit: jest.fn().mockResolvedValue(undefined) },
    })

    await expect(service.createForFeature(buildInput(), { tenantId, organizationId })).resolves.toEqual([])
    expect(entityManager.create).not.toHaveBeenCalled()
  })

  it('fails closed when organization context is null', async () => {
    const entityManager = buildEntityManager()
    const container = { resolve: jest.fn() }
    getRecipientsMock.mockResolvedValue(['user-1'])
    const service = createNotificationService({
      em: entityManager as never,
      eventBus: { emit: jest.fn().mockResolvedValue(undefined) },
      container,
    })

    await expect(service.createForFeature(buildInput(), { tenantId, organizationId: null })).resolves.toEqual([])
    expect(container.resolve).not.toHaveBeenCalled()
    expect(entityManager.create).not.toHaveBeenCalled()
  })

  it('fails closed when the candidate cap is exceeded', async () => {
    const entityManager = buildEntityManager()
    const container = { resolve: jest.fn() }
    getRecipientsMock.mockResolvedValue(Array.from({ length: 201 }, (_, index) => `user-${index}`))
    const service = createNotificationService({
      em: entityManager as never,
      eventBus: { emit: jest.fn().mockResolvedValue(undefined) },
      container,
    })

    await expect(service.createForFeature(buildInput(), { tenantId, organizationId })).resolves.toEqual([])
    expect(container.resolve).not.toHaveBeenCalled()
    expect(entityManager.create).not.toHaveBeenCalled()
  })

  it('checks organization access concurrently in chunks of ten', async () => {
    const entityManager = buildEntityManager()
    let activeChecks = 0
    let maxActiveChecks = 0
    const userHasAllFeatures = jest.fn(async () => {
      activeChecks += 1
      maxActiveChecks = Math.max(maxActiveChecks, activeChecks)
      await new Promise((resolve) => setTimeout(resolve, 0))
      activeChecks -= 1
      return true
    })
    const container = {
      resolve: jest.fn(() => ({ userHasAllFeatures })),
    }
    getRecipientsMock.mockResolvedValue(Array.from({ length: 12 }, (_, index) => `user-${index}`))
    const service = createNotificationService({
      em: entityManager as never,
      eventBus: { emit: jest.fn().mockResolvedValue(undefined) },
      container,
    })

    const result = await service.createForFeature(buildInput(), { tenantId, organizationId })

    expect(result).toHaveLength(12)
    expect(userHasAllFeatures).toHaveBeenCalledTimes(12)
    expect(maxActiveChecks).toBe(10)
  })

  it('preserves tenant-wide fan-out when organization filtering is not requested', async () => {
    const entityManager = buildEntityManager()
    getRecipientsMock.mockResolvedValue(['user-1', 'user-2'])
    const service = createNotificationService({
      em: entityManager as never,
      eventBus: { emit: jest.fn().mockResolvedValue(undefined) },
    })

    const result = await service.createForFeature(buildInput(false), { tenantId, organizationId })

    expect(result).toHaveLength(2)
    expect(entityManager.create).toHaveBeenCalledTimes(2)
    expect(entityManager.create.mock.calls.map((call) => call[1]?.recipientUserId)).toEqual([
      'user-1',
      'user-2',
    ])
  })
})
