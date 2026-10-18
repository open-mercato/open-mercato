import { Notification } from '@open-mercato/core/modules/notifications/data/entities'
import type { CreateBatchNotificationInput } from '@open-mercato/core/modules/notifications/data/validators'
import emergencyBypassSubscriber, { metadata } from '../mfa-emergency-bypass-notification'

type Scope = { tenantId: string; organizationId: string }
type ScopeOverrides = { tenantId?: string | null; organizationId?: string | null }
type StoredNotification = Scope & { type: string; groupKey: string; status: string }

const findOneWithDecryptionMock = jest.fn()
const getRecipientUserIdsForFeatureMock = jest.fn()
const getScopedNotificationRecipientUserIdsMock = jest.fn()
const createBatchMock = jest.fn()
const resolveNotificationServiceMock = jest.fn()
const executeAdvisoryLockMock = jest.fn()
const sqlMock = jest.fn((_strings: TemplateStringsArray, ..._parameters: unknown[]) => ({
  execute: executeAdvisoryLockMock,
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))
jest.mock('@open-mercato/core/modules/notifications/lib/notificationRecipients', () => ({
  getRecipientUserIdsForFeature: (...args: unknown[]) => getRecipientUserIdsForFeatureMock(...args),
  getScopedNotificationRecipientUserIds: (...args: unknown[]) => getScopedNotificationRecipientUserIdsMock(...args),
}))
jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: (...args: unknown[]) => resolveNotificationServiceMock(...args),
}))
jest.mock('kysely', () => ({
  sql: (strings: TemplateStringsArray, ...parameters: unknown[]) => sqlMock(strings, ...parameters),
}))

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const payload = { ...scope, observedAt: '2026-10-18T23:59:00.000Z' }
const dailyGroupKey = 'security.mfa.emergency_bypass_active:2026-10-18'

function createContext(scopeOverrides: ScopeOverrides = {}) {
  const database = { connection: Symbol('transaction connection') }
  const transaction = { getKysely: jest.fn(() => database) }
  const transactional = jest.fn(async (work: (manager: typeof transaction) => Promise<void>) => work(transaction))
  const fork = jest.fn(() => ({ transactional }))
  const userHasAllFeatures = jest.fn(async (_userId: string, _features: string[], _scope: Scope) => true)
  const resolve = jest.fn((name: string): unknown => {
    if (name === 'em') return { fork }
    if (name === 'rbacService') return { userHasAllFeatures }
    return undefined
  })
  const ctx = {
    ...scope,
    ...scopeOverrides,
    resolve: <T = unknown>(name: string): T => resolve(name) as T,
  }
  return { ctx, database, transaction, transactional, fork, resolve, userHasAllFeatures }
}

describe('MFA emergency bypass notification subscriber', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    findOneWithDecryptionMock.mockResolvedValue(null)
    getRecipientUserIdsForFeatureMock.mockResolvedValue(['admin-1'])
    getScopedNotificationRecipientUserIdsMock.mockResolvedValue(['admin-1'])
    createBatchMock.mockResolvedValue([])
    executeAdvisoryLockMock.mockResolvedValue(undefined)
    resolveNotificationServiceMock.mockReturnValue({ createBatch: createBatchMock })
  })

  it('registers persistent delivery and creates an in-app warning for the trusted scope', async () => {
    const { ctx, database, transaction, transactional, userHasAllFeatures } = createContext()

    await emergencyBypassSubscriber(payload, ctx)

    expect(metadata).toEqual({
      event: 'security.mfa.emergency_bypass_active',
      persistent: true,
      id: 'security:mfa-emergency-bypass-notification',
    })
    expect(transactional).toHaveBeenCalledTimes(1)
    expect(executeAdvisoryLockMock).toHaveBeenCalledWith(database)
    expect(sqlMock.mock.calls[0][0].join('?')).toContain('pg_advisory_xact_lock(hashtext(?))')
    expect(sqlMock.mock.calls[0].slice(1)).toEqual([`${scope.tenantId}:${scope.organizationId}:${dailyGroupKey}`])
    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(transaction, Notification, {
      ...scope,
      type: metadata.event,
      groupKey: dailyGroupKey,
    }, undefined, scope)
    expect(getRecipientUserIdsForFeatureMock).toHaveBeenCalledWith(database, scope.tenantId, 'security.mfa.manage')
    expect(getScopedNotificationRecipientUserIdsMock).toHaveBeenCalledWith(database, scope.tenantId, scope.organizationId, ['admin-1'])
    expect(userHasAllFeatures).toHaveBeenCalledWith('admin-1', ['security.mfa.manage'], scope)
    expect(createBatchMock).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserIds: ['admin-1'],
      type: metadata.event,
      titleKey: 'security.notifications.mfaEmergencyBypass.title',
      bodyKey: 'security.notifications.mfaEmergencyBypass.body',
      severity: 'warning',
      groupKey: dailyGroupKey,
    }), scope)
  })

  it.each<[string, ScopeOverrides]>([
    ['a different tenant', { tenantId: '33333333-3333-4333-8333-333333333333' }],
    ['a different organization', { organizationId: '33333333-3333-4333-8333-333333333333' }],
    ['a missing tenant', { tenantId: undefined }],
    ['a missing organization', { organizationId: undefined }],
    ['a null tenant', { tenantId: null }],
    ['a null organization', { organizationId: null }],
  ])('ignores payloads when the trusted context has %s', async (_description, overrides) => {
    const { ctx, resolve } = createContext(overrides)

    await emergencyBypassSubscriber(payload, ctx)

    expect(resolve).not.toHaveBeenCalled()
    expect(createBatchMock).not.toHaveBeenCalled()
  })

  it.each([
    null,
    {},
    { ...payload, tenantId: 'invalid' },
    { ...payload, organizationId: null },
    { ...payload, observedAt: '2026-10-18' },
    { ...payload, observedAt: undefined },
  ])('ignores malformed event payloads: %j', async (invalidPayload) => {
    const { ctx, resolve } = createContext()

    await emergencyBypassSubscriber(invalidPayload, ctx)

    expect(resolve).not.toHaveBeenCalled()
    expect(createBatchMock).not.toHaveBeenCalled()
  })

  it.each(['unread', 'read', 'actioned', 'dismissed'])('suppresses the daily duplicate when its stored status is %s', async (status) => {
    const { ctx } = createContext()
    findOneWithDecryptionMock.mockResolvedValue({ ...scope, type: metadata.event, groupKey: dailyGroupKey, status })

    await emergencyBypassSubscriber(payload, ctx)

    expect(findOneWithDecryptionMock.mock.calls[0][2]).not.toHaveProperty('status')
    expect(getRecipientUserIdsForFeatureMock).not.toHaveBeenCalled()
    expect(createBatchMock).not.toHaveBeenCalled()
  })

  it('delivers again on the next UTC day', async () => {
    const { ctx } = createContext()
    const notifications = new Map<string, StoredNotification>()
    findOneWithDecryptionMock.mockImplementation(async (_manager: unknown, _entity: unknown, query: { groupKey: string }) => notifications.get(query.groupKey) ?? null)
    createBatchMock.mockImplementation(async (input: CreateBatchNotificationInput, notificationScope: Scope) => {
      if (input.groupKey) notifications.set(input.groupKey, { ...notificationScope, type: input.type, groupKey: input.groupKey, status: 'unread' })
      return []
    })

    await emergencyBypassSubscriber(payload, ctx)
    await emergencyBypassSubscriber({ ...payload, observedAt: '2026-10-18T23:59:59.999Z' }, ctx)
    await emergencyBypassSubscriber({ ...payload, observedAt: '2026-10-19T00:00:00.000Z' }, ctx)

    expect(createBatchMock).toHaveBeenCalledTimes(2)
    expect(createBatchMock.mock.calls.map(([input]) => (input as CreateBatchNotificationInput).groupKey)).toEqual([
      dailyGroupKey,
      'security.mfa.emergency_bypass_active:2026-10-19',
    ])
  })

  it('waits for the database lock before checking the daily delivery marker', async () => {
    const { ctx } = createContext()
    let releaseLock: (() => void) | undefined
    executeAdvisoryLockMock.mockImplementation(() => new Promise<void>((resolve) => { releaseLock = resolve }))

    const delivery = emergencyBypassSubscriber(payload, ctx)

    expect(executeAdvisoryLockMock).toHaveBeenCalledTimes(1)
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
    releaseLock?.()
    await delivery
    expect(createBatchMock).toHaveBeenCalledTimes(1)
  })

  it('serializes concurrent events before looking up a notification and only delivers one batch', async () => {
    const { ctx, transactional, transaction } = createContext()
    let lockTail = Promise.resolve()
    let notification: StoredNotification | null = null
    transactional.mockImplementation((work) => {
      const running = lockTail.then(() => work(transaction))
      lockTail = running.catch(() => undefined)
      return running
    })
    findOneWithDecryptionMock.mockImplementation(async () => notification)
    createBatchMock.mockImplementation(async (input: CreateBatchNotificationInput) => {
      notification = { ...scope, type: input.type, groupKey: input.groupKey ?? '', status: 'unread' }
      return []
    })

    await Promise.all(Array.from({ length: 5 }, () => emergencyBypassSubscriber(payload, ctx)))

    expect(executeAdvisoryLockMock).toHaveBeenCalledTimes(5)
    expect(findOneWithDecryptionMock).toHaveBeenCalledTimes(5)
    expect(createBatchMock).toHaveBeenCalledTimes(1)
  })

  it('only checks scoped candidates and honors canonical RBAC denial of a role-derived candidate', async () => {
    const { ctx, userHasAllFeatures } = createContext()
    getRecipientUserIdsForFeatureMock.mockResolvedValue(['allowed-admin', 'user-override-denied', 'other-organization-admin'])
    getScopedNotificationRecipientUserIdsMock.mockResolvedValue(['allowed-admin', 'user-override-denied'])
    userHasAllFeatures.mockImplementation(async (userId) => userId === 'allowed-admin')

    await emergencyBypassSubscriber(payload, ctx)

    expect(userHasAllFeatures.mock.calls.map(([userId]) => userId)).toEqual(['allowed-admin', 'user-override-denied'])
    expect(createBatchMock).toHaveBeenCalledWith(expect.objectContaining({ recipientUserIds: ['allowed-admin'] }), scope)
  })

  it.each(['no scoped candidates', 'no authorized candidates'])('does not resolve delivery services for %s', async (reason) => {
    const { ctx, userHasAllFeatures } = createContext()
    if (reason === 'no scoped candidates') getScopedNotificationRecipientUserIdsMock.mockResolvedValue([])
    else userHasAllFeatures.mockResolvedValue(false)

    await emergencyBypassSubscriber(payload, ctx)

    expect(resolveNotificationServiceMock).not.toHaveBeenCalled()
    expect(createBatchMock).not.toHaveBeenCalled()
  })

  it('delivers to every authorized candidate when the audience exceeds 200 users', async () => {
    const { ctx, userHasAllFeatures } = createContext()
    const candidates = Array.from({ length: 235 }, (_, index) => `admin-${index}`)
    let activeChecks = 0
    let peakChecks = 0
    getRecipientUserIdsForFeatureMock.mockResolvedValue(candidates)
    getScopedNotificationRecipientUserIdsMock.mockResolvedValue(candidates)
    userHasAllFeatures.mockImplementation(async () => {
      activeChecks += 1
      peakChecks = Math.max(peakChecks, activeChecks)
      await Promise.resolve()
      activeChecks -= 1
      return true
    })

    await emergencyBypassSubscriber(payload, ctx)

    expect(userHasAllFeatures).toHaveBeenCalledTimes(235)
    expect(peakChecks).toBeLessThanOrEqual(10)
    expect(createBatchMock).toHaveBeenCalledWith(expect.objectContaining({ recipientUserIds: candidates }), scope)
  })

  it('propagates failed batch delivery and retries without marking the day as delivered', async () => {
    const { ctx } = createContext()
    const failure = new Error('Delivery unavailable')
    createBatchMock.mockRejectedValueOnce(failure)

    await expect(emergencyBypassSubscriber(payload, ctx)).rejects.toBe(failure)
    await emergencyBypassSubscriber(payload, ctx)

    expect(findOneWithDecryptionMock).toHaveBeenCalledTimes(2)
    expect(createBatchMock).toHaveBeenCalledTimes(2)
    expect(createBatchMock.mock.calls.map(([input]) => (input as CreateBatchNotificationInput).groupKey)).toEqual([dailyGroupKey, dailyGroupKey])
  })

  it('propagates audience resolution errors so persistent delivery can retry', async () => {
    const { ctx } = createContext()
    const failure = new Error('ACL lookup unavailable')
    getRecipientUserIdsForFeatureMock.mockRejectedValueOnce(failure)

    await expect(emergencyBypassSubscriber(payload, ctx)).rejects.toBe(failure)

    expect(createBatchMock).not.toHaveBeenCalled()
  })
})
