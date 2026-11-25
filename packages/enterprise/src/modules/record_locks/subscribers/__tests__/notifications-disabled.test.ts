jest.mock('@open-mercato/core/modules/notifications/lib/notificationBuilder', () => ({
  buildNotificationFromType: jest.fn((_type: unknown, input: unknown) => input),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/notifications/data/entities', () => ({
  Notification: class Notification {},
}))

jest.mock('../../lib/notificationHelpers', () => ({
  resolveRecordLockNotificationType: jest.fn((type: string) => ({ type })),
  resolveRecordResourceLink: jest.fn(() => '/backend/customers/people/person-1'),
}))

import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { Notification } from '@open-mercato/core/modules/notifications/data/entities'
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

type Context = { resolve: <T = unknown>(name: string) => T }

function contextWithNotifications(enabled: boolean): Context {
  const em = { getMetadata: () => ({ find: (entity: unknown) => enabled && entity === Notification }) }
  const services: Record<string, unknown> = {
    em,
    recordLockService: { canReadTarget: jest.fn().mockResolvedValue(true) },
  }
  return { resolve: <Value,>(name: string) => services[name] as Value }
}

const cases: Array<[string, (payload: typeof basePayload, context: Context) => Promise<void>]> = [
  ['incoming-changes-notification', incomingChanges],
  ['participant-joined-notification', participantJoined],
  ['participant-left-notification', participantLeft],
  ['record-deleted-notification', recordDeleted],
]

describe('record_locks notification subscribers and the optional notifications module (#9205)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test.each(cases)('%s skips delivery when the notifications module is disabled', async (_name, handle) => {
    const create = jest.fn()
    jest.mocked(resolveNotificationService).mockReturnValue({ create } as never)

    await expect(handle(basePayload, contextWithNotifications(false))).resolves.toBeUndefined()

    expect(resolveNotificationService).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  test.each(cases)('%s propagates a delivery failure when notifications is enabled so the event is retried', async (_name, handle) => {
    const create = jest.fn().mockRejectedValue(new Error('connection reset'))
    jest.mocked(resolveNotificationService).mockReturnValue({ create } as never)

    await expect(handle(basePayload, contextWithNotifications(true))).rejects.toThrow('connection reset')
  })

  test.each(cases)('%s creates the notification when notifications is enabled', async (_name, handle) => {
    const create = jest.fn().mockResolvedValue(undefined)
    jest.mocked(resolveNotificationService).mockReturnValue({ create } as never)

    await handle(basePayload, contextWithNotifications(true))

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: 'user-2' }),
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })
})
