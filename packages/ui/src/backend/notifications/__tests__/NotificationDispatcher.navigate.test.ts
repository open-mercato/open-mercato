import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'
import { registerNotificationHandlers } from '@open-mercato/shared/lib/notifications/handler-registry'
import {
  __resetNotificationDispatcherForTests,
  dispatchNotificationHandlers,
} from '../NotificationDispatcher'

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

const TYPE = 'test.navigate'

function makeNotification(id: string, target: string): NotificationDto {
  return {
    id,
    type: TYPE,
    title: 'Navigate',
    severity: 'info',
    status: 'unread',
    actions: [],
    data: { target },
    createdAt: new Date().toISOString(),
  }
}

function runtime() {
  return {
    features: [],
    currentPath: '/backend',
    refreshNotifications: jest.fn(),
    navigate: jest.fn(),
    markAsRead: jest.fn(async () => {}),
    dismiss: jest.fn(async () => {}),
  }
}

describe('NotificationDispatcher — handler navigation stays on the application origin (#7240)', () => {
  beforeEach(() => {
    __resetNotificationDispatcherForTests()
    registerNotificationHandlers([
      {
        moduleId: 'test',
        handlers: [
          {
            id: 'test.navigate',
            notificationType: TYPE,
            handle(notification, context) {
              const target = (notification.data as { target?: string } | null)?.target
              if (target) context.navigate(target)
            },
          },
        ],
      },
    ])
  })

  afterAll(() => {
    registerNotificationHandlers([])
  })

  it.each(['/\\evil.example/phish', '/\t/evil.example', '//evil.example', 'https://evil.example'])(
    'does not navigate to %j',
    (target) => {
      const ctx = runtime()
      dispatchNotificationHandlers([makeNotification('n-unsafe', target)], ctx)
      expect(ctx.navigate).not.toHaveBeenCalled()
    },
  )

  it('navigates to a same-origin path', () => {
    const ctx = runtime()
    dispatchNotificationHandlers([makeNotification('n-safe', '/backend/notifications')], ctx)
    expect(ctx.navigate).toHaveBeenCalledWith('/backend/notifications')
  })
})
