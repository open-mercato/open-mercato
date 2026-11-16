import { randomUUID } from 'node:crypto'
import subscriber, { metadata } from '../mfa-verification-locked-notification'

const createBatchMock = jest.fn(async () => [])
const findUserMock = jest.fn()
jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({ createBatch: createBatchMock }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findUserMock(...args),
}))

const context = { resolve: jest.fn(() => ({ fork: () => ({}) })) } as never

describe('MFA verification lock notification', () => {
  beforeEach(() => jest.clearAllMocks())

  test('creates an idempotent scoped notification without proof data', async () => {
    const userId = randomUUID()
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const lockedUntil = new Date(Date.now() + 600000).toISOString()
    findUserMock.mockResolvedValue({ id: userId, tenantId, organizationId })
    await subscriber({ userId, tenantId, lockedUntil }, context)
    expect(metadata.persistent).toBe(true)
    expect(findUserMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      id: userId, tenantId, deletedAt: null,
    }, undefined, { tenantId })
    expect(createBatchMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'security.mfa.verification_locked',
      recipientUserIds: [userId],
      groupKey: `security:mfa-verification-locked:${userId}:${lockedUntil}`,
      channels: ['in_app', 'email'],
      bodyVariables: undefined,
    }), { tenantId, organizationId }, { skipExistingGroup: true })
  })

  test('unknown or cross-tenant users do not receive a notification', async () => {
    findUserMock.mockResolvedValue(null)
    await subscriber({ userId: randomUUID(), tenantId: randomUUID(), lockedUntil: new Date().toISOString() }, context)
    expect(createBatchMock).not.toHaveBeenCalled()
  })

  test('invalid event payloads do not query users', async () => {
    await subscriber({ userId: 'untrusted', tenantId: null }, context)
    expect(findUserMock).not.toHaveBeenCalled()
    expect(createBatchMock).not.toHaveBeenCalled()
  })
})
