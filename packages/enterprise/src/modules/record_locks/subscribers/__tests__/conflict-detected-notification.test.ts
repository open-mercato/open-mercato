const mockCreateNotification = jest.fn()

jest.mock('@open-mercato/core/modules/notifications/lib/notificationBuilder', () => ({
  buildNotificationFromType: jest.fn((_type: unknown, input: unknown) => input),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: jest.fn(() => ({
    create: mockCreateNotification,
  })),
}))

jest.mock('../../lib/notificationHelpers', () => ({
  isConflictNotificationEnabled: jest.fn(async () => true),
  resolveRecordLockNotificationType: jest.fn(() => ({ id: 'record_locks.conflict.detected' })),
  resolveRecordResourceLink: jest.fn(() => '/backend/customers/companies/company-1'),
}))

import handle from '../conflict-detected-notification'

describe('record_locks conflict detected notification subscriber', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('uses changed fields from the exact resource scope', async () => {
    const findResourceHistoryById = jest.fn().mockResolvedValue({
      changesJson: {
        'entity.displayName': { from: 'Acme Before', to: 'Acme Incoming' },
      },
    })
    const resolve = jest.fn(() => ({ findResourceHistoryById }))

    await handle(
      {
        conflictId: 'conflict-1',
        resourceKind: 'customers.company',
        resourceId: 'company-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        conflictActorUserId: 'owner-1',
        incomingActionLogId: 'log-1',
      },
      { resolve },
    )

    expect(resolve).toHaveBeenCalledWith('actionLogHistoryService', { allowUnregistered: true })
    expect(findResourceHistoryById).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      resourceKind: 'customers.company',
      resourceId: 'company-1',
      organization: { mode: 'exact', organizationId: 'org-1' },
    }, 'log-1')

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: 'owner-1',
        bodyVariables: expect.objectContaining({
          changedFields: 'Display Name',
        }),
      }),
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  test('delivers the existing notification with empty history when the provider is absent', async () => {
    await handle({
      conflictId: 'conflict-1',
      resourceKind: 'customers.company',
      resourceId: 'company-1',
      tenantId: 'tenant-1',
      organizationId: null,
      conflictActorUserId: 'owner-1',
      incomingActionLogId: 'log-1',
    }, { resolve: jest.fn() })

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: 'owner-1',
        bodyVariables: { resourceKind: 'customers.company', changedFields: '-' },
      }),
      { tenantId: 'tenant-1', organizationId: null },
    )
  })
})
