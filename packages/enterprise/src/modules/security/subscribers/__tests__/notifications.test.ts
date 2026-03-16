import enrolledSubscriber from '../notification'
import mfaResetSubscriber from '../mfa-reset-notification'
import enforcementCreatedSubscriber from '../enforcement-deadline-notification'
import enforcementUpdatedSubscriber from '../enforcement-updated-notification'
import auditSubscriber from '../audit'

const createMock = jest.fn(async () => ({}))
const resolveNotificationServiceMock = jest.fn(() => ({ create: createMock }))
const sendEmailMock = jest.fn(async () => undefined)
const findOneWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: (...args: unknown[]) => resolveNotificationServiceMock(...args),
}))
jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

function createContext() {
  const emFork = {
    findOne: jest.fn(),
    find: jest.fn(),
  }
  const ctx = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') {
        return {
          fork: () => emFork,
        }
      }
      return undefined
    }),
  }
  return { emFork, ctx }
}

describe('security notification subscribers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useRealTimers()
  })

  test('creates notification and sends email when MFA is enrolled', async () => {
    const { emFork, ctx } = createContext()
    emFork.findOne.mockResolvedValue({
      id: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      deletedAt: null,
    })
    findOneWithDecryptionMock.mockResolvedValue({
      id: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      email: 'user@example.com',
      deletedAt: null,
    })

    await enrolledSubscriber({
      userId: 'user-1',
      methodId: 'method-1',
      methodType: 'totp',
      enrolledAt: '2026-03-09T10:00:00.000Z',
    }, ctx)

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'security.mfa.enrolled',
        recipientUserId: 'user-1',
      }),
      expect.objectContaining({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      }),
    )
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Multi-factor authentication enabled',
      }),
    )
  })

  test('creates notification when password change notification is requested', async () => {
    const { ctx } = createContext()

    await auditSubscriber({
      userId: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      changedAt: '2026-03-09T12:00:00.000Z',
    }, ctx)

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'security.password.changed',
        recipientUserId: 'user-1',
        sourceEntityType: 'security:profile_password',
        sourceEntityId: 'user-1',
      }),
      expect.objectContaining({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      }),
    )
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  test('creates notification and sends email when MFA is reset', async () => {
    const { emFork, ctx } = createContext()
    emFork.findOne.mockResolvedValue({
      id: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      deletedAt: null,
    })
    findOneWithDecryptionMock.mockResolvedValue({
      id: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      email: 'user@example.com',
      deletedAt: null,
    })

    await mfaResetSubscriber({
      targetUserId: 'user-1',
      reason: 'Security incident',
      resetAt: '2026-03-09T11:00:00.000Z',
    }, ctx)

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'security.mfa.reset',
        recipientUserId: 'user-1',
      }),
      expect.objectContaining({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      }),
    )
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Your MFA methods were reset',
      }),
    )
  })

  test('sends enforcement notification with a deadline note to unenrolled users on policy creation', async () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-03-09T00:00:00.000Z'))

    const { emFork, ctx } = createContext()
    emFork.findOne.mockResolvedValue({
      id: 'policy-1',
      tenantId: 'tenant-1',
      organizationId: null,
      isEnforced: true,
      allowedMethods: null,
      enforcementDeadline: new Date('2026-03-12T00:00:00.000Z'),
      deletedAt: null,
    })
    emFork.find.mockImplementation(async (_entity: unknown, query: Record<string, unknown>) => {
      if ('isActive' in query) {
        return [
          {
            id: 'method-1',
            userId: 'user-1',
            isActive: true,
            deletedAt: null,
          },
        ]
      }
      return [
        { id: 'user-1', tenantId: 'tenant-1', organizationId: null, deletedAt: null },
        { id: 'user-2', tenantId: 'tenant-1', organizationId: null, deletedAt: null },
      ]
    })
    findOneWithDecryptionMock
      .mockResolvedValueOnce({
        id: 'user-1',
        tenantId: 'tenant-1',
        organizationId: null,
        email: 'one@example.com',
        deletedAt: null,
      })
      .mockResolvedValueOnce({
        id: 'user-2',
        tenantId: 'tenant-1',
        organizationId: null,
        email: 'two@example.com',
        deletedAt: null,
      })

    await enforcementCreatedSubscriber({ policyId: 'policy-1' }, ctx)

    expect(createMock).toHaveBeenCalledTimes(1)
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'security.mfa.enforcement_deadline',
        recipientUserId: 'user-2',
        bodyKey: 'security.notifications.enforcementDeadline.bodyWithDeadline',
        bodyVariables: {
          days: '3',
          deadline: '2026-03-12',
        },
      }),
      expect.objectContaining({
        tenantId: 'tenant-1',
      }),
    )
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'two@example.com',
        subject: 'MFA enrollment required within 3 days',
      }),
    )
  })

  test('sends immediate enforcement notification when policy update has no deadline', async () => {
    const { emFork, ctx } = createContext()
    emFork.findOne.mockResolvedValue({
      id: 'policy-1',
      tenantId: 'tenant-1',
      organizationId: null,
      isEnforced: true,
      allowedMethods: null,
      enforcementDeadline: null,
      deletedAt: null,
    })
    emFork.find.mockImplementation(async (_entity: unknown, query: Record<string, unknown>) => {
      if ('isActive' in query) {
        return []
      }
      return [
        { id: 'user-1', tenantId: 'tenant-1', organizationId: null, deletedAt: null },
      ]
    })
    findOneWithDecryptionMock.mockResolvedValue({
      id: 'user-1',
      tenantId: 'tenant-1',
      organizationId: null,
      email: 'one@example.com',
      deletedAt: null,
    })

    await enforcementUpdatedSubscriber({ policyId: 'policy-1' }, ctx)

    expect(createMock).toHaveBeenCalledTimes(1)
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'security.mfa.enforcement_deadline',
        recipientUserId: 'user-1',
        bodyKey: 'security.notifications.enforcementDeadline.bodyImmediate',
        bodyVariables: undefined,
      }),
      expect.objectContaining({
        tenantId: 'tenant-1',
      }),
    )
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'one@example.com',
        subject: 'MFA enrollment required immediately',
      }),
    )
  })
})
