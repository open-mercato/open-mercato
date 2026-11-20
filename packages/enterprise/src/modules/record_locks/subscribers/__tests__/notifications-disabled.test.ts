const mockWarn = jest.fn()
const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = { warn: (...args: unknown[]) => mockWarn(...args), error: jest.fn(), info: jest.fn(), debug: jest.fn() }
  return { createLogger: () => ({ ...logger, child: () => logger }) }
})

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationBuilder', () => ({
  buildNotificationFromType: jest.fn((_type: unknown, input: unknown) => input),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: jest.fn(),
}))

jest.mock('../../lib/notificationHelpers', () => ({
  resolveRecordLockNotificationType: jest.fn((type: string) => ({ type })),
  resolveRecordResourceLink: jest.fn(() => '/backend/customers/people/person-1'),
}))

import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import incomingChanges from '../incoming-changes-notification'
import participantJoined from '../participant-joined-notification'
import participantLeft from '../participant-left-notification'
import recordDeleted from '../record-deleted-notification'

const basePayload = {
  lockId: 'lock-1',
  resourceKind: 'customers.person',
  resourceId: 'person-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  recipientUserIds: ['user-2'],
  joinedUserId: 'user-1',
  leftUserId: 'user-1',
  deletedByUserId: 'user-1',
  incomingActionLogId: 'log-1',
}

const ctx = { resolve: jest.fn() }

const cases: Array<[string, (payload: typeof basePayload, context: typeof ctx) => Promise<void>]> = [
  ['incoming-changes-notification', incomingChanges],
  ['participant-joined-notification', participantJoined],
  ['participant-left-notification', participantLeft],
  ['record-deleted-notification', recordDeleted],
]

describe('record_locks notification subscribers without the notifications module (#9205)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test.each(cases)('%s logs a warning instead of throwing when the service cannot be resolved', async (_name, handle) => {
    jest.mocked(resolveNotificationService).mockImplementation(() => {
      throw new Error("Could not resolve 'notificationService'")
    })

    await expect(handle(basePayload, ctx)).resolves.toBeUndefined()

    expect(mockWarn).toHaveBeenCalledTimes(1)
    expect(mockReportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ module: 'record_locks', code: 'record_locks.notification_failed' }),
    )
  })

  test.each(cases)('%s swallows a throwing create', async (_name, handle) => {
    const create = jest.fn().mockRejectedValue(new Error('Metadata for entity Notification not found'))
    jest.mocked(resolveNotificationService).mockReturnValue({ create } as never)

    await expect(handle(basePayload, ctx)).resolves.toBeUndefined()

    expect(create).toHaveBeenCalledTimes(1)
    expect(mockWarn).toHaveBeenCalledTimes(1)
  })

  test.each(cases)('%s still creates the notification when the service works', async (_name, handle) => {
    const create = jest.fn().mockResolvedValue(undefined)
    jest.mocked(resolveNotificationService).mockReturnValue({ create } as never)

    await handle(basePayload, ctx)

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: 'user-2' }),
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(mockWarn).not.toHaveBeenCalled()
  })
})
