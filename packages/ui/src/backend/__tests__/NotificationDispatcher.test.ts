import { registerNotificationHandlers } from '@open-mercato/shared/lib/notifications/handler-registry'
import type { NotificationHandler } from '@open-mercato/shared/modules/notifications/handler'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'
import {
  __resetNotificationDispatcherForTests,
  dispatchNotificationHandlers,
  getRequiredNotificationHandlerFeatures,
  subscribeNotificationEffects,
} from '@open-mercato/ui/backend/notifications/NotificationDispatcher'

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

function makeNotification(
  id: string,
  type: string,
): NotificationDto {
  return {
    id,
    type,
    title: `title-${id}`,
    severity: 'info',
    status: 'unread',
    actions: [],
    createdAt: new Date().toISOString(),
  }
}

function runtime(features: string[] = []) {
  return {
    features,
    currentPath: '/backend/umes-next-phases',
    refreshNotifications: jest.fn(),
    navigate: jest.fn(),
    markAsRead: jest.fn(async () => {}),
    dismiss: jest.fn(async () => {}),
  }
}

describe('NotificationDispatcher', () => {
  beforeEach(() => {
    registerNotificationHandlers([])
    __resetNotificationDispatcherForTests()
    jest.clearAllMocks()
  })

  it('dispatches exact and wildcard handlers in priority order', () => {
    const calls: string[] = []
    const handlers: NotificationHandler[] = [
      {
        id: 'wildcard',
        notificationType: 'example.*',
        priority: 10,
        handle(notification) {
          calls.push(`wildcard:${notification.id}`)
        },
      },
      {
        id: 'exact',
        notificationType: 'example.todo.created',
        priority: 100,
        handle(notification) {
          calls.push(`exact:${notification.id}`)
        },
      },
    ]
    registerNotificationHandlers([{ moduleId: 'example', handlers }])

    dispatchNotificationHandlers([makeNotification('n1', 'example.todo.created')], runtime())
    expect(calls).toEqual(['exact:n1', 'wildcard:n1'])
  })

  it('filters handlers by required features', () => {
    const calls: string[] = []
    registerNotificationHandlers([
      {
        moduleId: 'example',
        handlers: [
          {
            id: 'secure',
            notificationType: 'example.todo.created',
            features: ['example.todos.manage'],
            handle(notification) {
              calls.push(notification.id)
            },
          },
        ],
      },
    ])

    dispatchNotificationHandlers([makeNotification('n1', 'example.todo.created')], runtime([]))
    dispatchNotificationHandlers([makeNotification('n2', 'example.todo.created')], runtime(['example.todos.manage']))
    expect(calls).toEqual(['n2'])
  })

  it('accepts wildcard required features', () => {
    const calls: string[] = []
    registerNotificationHandlers([
      {
        moduleId: 'example',
        handlers: [
          {
            id: 'secure',
            notificationType: 'example.todo.created',
            features: ['example.todos.manage'],
            handle(notification) {
              calls.push(notification.id)
            },
          },
        ],
      },
    ])

    dispatchNotificationHandlers([makeNotification('n1', 'example.todo.created')], runtime(['example.todos.*']))

    expect(calls).toEqual(['n1'])
  })

  it('handles each notification once', () => {
    const calls: string[] = []
    registerNotificationHandlers([
      {
        moduleId: 'example',
        handlers: [
          {
            id: 'once',
            notificationType: '*',
            handle(notification) {
              calls.push(notification.id)
            },
          },
        ],
      },
    ])

    const notification = makeNotification('n1', 'example.todo.created')
    dispatchNotificationHandlers([notification], runtime())
    dispatchNotificationHandlers([notification], runtime())
    expect(calls).toEqual(['n1'])
  })

  it('supports effect subscribers and unsubscription', () => {
    const seen: string[] = []
    const unsubscribe = subscribeNotificationEffects('example.*', (notification) => {
      seen.push(notification.id)
    })

    dispatchNotificationHandlers([makeNotification('n1', 'example.todo.created')], runtime())
    unsubscribe()
    dispatchNotificationHandlers([makeNotification('n2', 'example.todo.created')], runtime())

    expect(seen).toEqual(['n1'])
  })

  it('collects required features from registered handlers', () => {
    registerNotificationHandlers([
      {
        moduleId: 'example',
        handlers: [
          { id: 'a', notificationType: '*', features: ['example.todos.manage'], handle: () => {} },
          { id: 'b', notificationType: '*', features: ['example.todos.manage', 'customers.people.view'], handle: () => {} },
        ],
      },
    ])

    expect(getRequiredNotificationHandlerFeatures().sort()).toEqual([
      'customers.people.view',
      'example.todos.manage',
    ])
  })
})
