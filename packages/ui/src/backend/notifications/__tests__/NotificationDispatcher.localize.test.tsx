import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'
import { registerNotificationHandlers } from '@open-mercato/shared/lib/notifications/handler-registry'
import {
  __resetNotificationDispatcherForTests,
  dispatchNotificationHandlers,
  subscribeNotificationEffects,
} from '../NotificationDispatcher'

const flash = jest.fn()
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flash(...args),
}))

const TITLE_KEY = 'communication_channels.notifications.channel_requires_reauth.title'
const BODY_KEY = 'communication_channels.notifications.channel_requires_reauth.body'

const dictionary: Record<string, string> = {
  [TITLE_KEY]: 'Channel needs reconnection',
  [BODY_KEY]: 'Authentication expired. Reconnect {{channel}} to resume sending and receiving messages.',
}

function translate(key: string, fallback?: string, variables?: Record<string, string>): string {
  const template = dictionary[key] ?? fallback ?? key
  return Object.entries(variables ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, value),
    template,
  )
}

function makeNotification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: 'n1',
    type: 'communication_channels.channel.requires_reauth',
    title: TITLE_KEY,
    body: BODY_KEY,
    titleKey: TITLE_KEY,
    bodyKey: BODY_KEY,
    bodyVariables: { channel: 'Sales inbox' },
    severity: 'warning',
    status: 'unread',
    actions: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function runtime(t?: typeof translate) {
  return {
    features: [],
    currentPath: '/backend',
    t,
    refreshNotifications: jest.fn(),
    navigate: jest.fn(),
    markAsRead: jest.fn(async () => {}),
    dismiss: jest.fn(async () => {}),
  }
}

describe('NotificationDispatcher — handler copy localization (#6099)', () => {
  beforeEach(() => {
    __resetNotificationDispatcherForTests()
    flash.mockReset()
    registerNotificationHandlers([
      {
        moduleId: 'test',
        handlers: [
          {
            id: 'test.toast',
            notificationType: 'communication_channels.channel.requires_reauth',
            handle(notification, context) {
              context.toast({ title: notification.title, body: notification.body ?? undefined, severity: 'warning' })
            },
          },
        ],
      },
    ])
  })

  afterAll(() => {
    registerNotificationHandlers([])
  })

  it('hands handlers the translated title and body (with variables) instead of the dictionary keys', () => {
    dispatchNotificationHandlers([makeNotification()], runtime(translate))

    expect(flash).toHaveBeenCalledTimes(1)
    expect(flash).toHaveBeenCalledWith(
      'Channel needs reconnection: Authentication expired. Reconnect Sales inbox to resume sending and receiving messages.',
      'warning',
    )
  })

  it('leaves a notification without keys untouched', () => {
    dispatchNotificationHandlers(
      [makeNotification({ title: 'Plain title', body: 'Plain body', titleKey: null, bodyKey: null, bodyVariables: null })],
      runtime(translate),
    )

    expect(flash).toHaveBeenCalledWith('Plain title: Plain body', 'warning')
  })

  it('falls back to the stored copy when no translator is available', () => {
    dispatchNotificationHandlers([makeNotification()], runtime(undefined))

    expect(flash).toHaveBeenCalledWith(`${TITLE_KEY}: ${BODY_KEY}`, 'warning')
  })

  it('does not rewrite the DTO seen by effect subscribers', () => {
    const seen: NotificationDto[] = []
    const unsubscribe = subscribeNotificationEffects('communication_channels.*', (item) => seen.push(item))

    dispatchNotificationHandlers([makeNotification({ id: 'n2' })], runtime(translate))
    unsubscribe()

    expect(seen).toHaveLength(1)
    expect(seen[0].title).toBe(TITLE_KEY)
  })
})
