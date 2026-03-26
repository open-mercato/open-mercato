import type { NotificationHandlerContext } from '@open-mercato/shared/modules/notifications/handler'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'
import {
  notificationHandlers,
  RECORD_LOCKS_FORCE_RELEASED_EVENT,
  RECORD_LOCKS_INCOMING_CHANGES_EVENT,
  RECORD_LOCKS_LOCK_CONTENDED_EVENT,
  RECORD_LOCKS_RECORD_DELETED_EVENT,
} from '../notifications.handlers'

function createContext(): jest.Mocked<NotificationHandlerContext> {
  return {
    userId: 'user-1',
    features: ['record_locks.view'],
    currentPath: '/backend/customers/companies/edit?id=company-1',
    toast: jest.fn(),
    popup: jest.fn(),
    emitEvent: jest.fn(),
    refreshNotifications: jest.fn(),
    navigate: jest.fn(),
    markAsRead: jest.fn(async () => {}),
    dismiss: jest.fn(async () => {}),
  }
}

function createNotification(input: Partial<NotificationDto>): NotificationDto {
  return {
    id: 'notif-1',
    type: 'record_locks.lock.contended',
    title: 'title',
    body: 'body',
    severity: 'warning',
    status: 'unread',
    actions: [],
    createdAt: new Date().toISOString(),
    ...input,
  }
}

describe('record_locks notification handlers', () => {
  test('emits lock contention event payload', async () => {
    const context = createContext()
    const handler = notificationHandlers.find((entry) => entry.id === 'record_locks.lock-contended-event')
    if (!handler) throw new Error('handler not found')

    await handler.handle(createNotification({
      type: 'record_locks.lock.contended',
      sourceEntityId: 'lock-1',
      bodyVariables: { resourceKind: 'customers.company' },
    }), context)

    expect(context.emitEvent).toHaveBeenCalledWith(RECORD_LOCKS_LOCK_CONTENDED_EVENT, {
      notificationId: 'notif-1',
      sourceEntityId: 'lock-1',
      resourceKind: 'customers.company',
    })
  })

  test('emits record deleted payload with resource scope', async () => {
    const context = createContext()
    const handler = notificationHandlers.find((entry) => entry.id === 'record_locks.record-deleted-event')
    if (!handler) throw new Error('handler not found')

    await handler.handle(createNotification({
      type: 'record_locks.record.deleted',
      sourceEntityId: 'company-1',
      bodyVariables: { resourceKind: 'customers.company' },
    }), context)

    expect(context.emitEvent).toHaveBeenCalledWith(RECORD_LOCKS_RECORD_DELETED_EVENT, {
      notificationId: 'notif-1',
      resourceId: 'company-1',
      resourceKind: 'customers.company',
    })
  })

  test('emits incoming changes event', async () => {
    const context = createContext()
    const handler = notificationHandlers.find((entry) => entry.id === 'record_locks.incoming-changes-event')
    if (!handler) throw new Error('handler not found')

    await handler.handle(createNotification({
      type: 'record_locks.incoming_changes.available',
      sourceEntityId: 'log-1',
      bodyVariables: { resourceKind: 'customers.company' },
    }), context)

    expect(context.emitEvent).toHaveBeenCalledWith(RECORD_LOCKS_INCOMING_CHANGES_EVENT, {
      notificationId: 'notif-1',
      sourceEntityId: 'log-1',
      resourceId: null,
      resourceKind: 'customers.company',
    })
  })

  test('shows force release toast and emits event', async () => {
    const context = createContext()
    const handler = notificationHandlers.find((entry) => entry.id === 'record_locks.force-released-toast')
    if (!handler) throw new Error('handler not found')

    await handler.handle(createNotification({
      type: 'record_locks.lock.force_released',
      title: 'Lock released',
      body: 'Another user took over',
      sourceEntityId: 'lock-1',
    }), context)

    expect(context.toast).toHaveBeenCalledWith({
      title: 'Lock released',
      body: 'Another user took over',
      severity: 'warning',
    })
    expect(context.emitEvent).toHaveBeenCalledWith(RECORD_LOCKS_FORCE_RELEASED_EVENT, {
      notificationId: 'notif-1',
      sourceEntityId: 'lock-1',
      resourceId: null,
      resourceKind: null,
    })
  })
})
