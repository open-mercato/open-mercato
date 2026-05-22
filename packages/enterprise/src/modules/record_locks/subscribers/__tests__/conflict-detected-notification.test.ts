const mockCreateNotification = jest.fn()

jest.mock('@open-mercato/core/modules/notifications/lib/notificationBuilder', () => ({
  buildNotificationFromType: jest.fn((_type: unknown, input: unknown) => input),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: jest.fn(() => ({
    create: mockCreateNotification,
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../../lib/notificationHelpers', () => ({
  isConflictNotificationEnabled: jest.fn(async () => true),
  resolveRecordLockNotificationType: jest.fn(() => ({ id: 'record_locks.conflict.detected' })),
  resolveRecordResourceLink: jest.fn(() => '/backend/customers/companies/company-1'),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import handle from '../conflict-detected-notification'

describe('record_locks conflict detected notification subscriber', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('uses changed fields from decrypted stringified action log changes', async () => {
    jest.mocked(findOneWithDecryption).mockResolvedValue({
      changesJson: JSON.stringify({
        'entity.displayName': { from: 'Acme Before', to: 'Acme Incoming' },
      }),
    } as never)

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
      {
        resolve: jest.fn(() => ({
          fork: jest.fn(() => ({})),
        })),
      },
    )

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
})
