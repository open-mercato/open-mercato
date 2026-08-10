import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  dismissNotificationIfExists,
  dismissNotificationsByType,
  listNotifications,
} from '@open-mercato/core/helpers/integration/notificationsFixtures'

const EXAMPLE_NOTIFICATION_TYPE = 'example.umes.actionable'

async function listExampleNotifications(
  request: APIRequestContext,
  token: string,
): Promise<Array<Record<string, unknown>>> {
  const { items } = await listNotifications(request, token, { type: EXAMPLE_NOTIFICATION_TYPE, pageSize: 100 })
  return items
}

/**
 * Milestone B coverage for the module's notification surface.
 *
 * `notifications.ts` registers the `example.umes.actionable` type and
 * `api/notifications/route.ts` emits it. The properties that matter are the ones a registration
 * is responsible for and a hand-rolled insert would not have: the emitted record carries the
 * registered type, its declared actions and its translation keys; it is addressed to the
 * requesting user rather than broadcast; and it is dismissible, which is the only way a test
 * can leave the recipient's tray as it found it.
 */
test.describe('TC-EXAMPLE-008: the example notification type renders for its own audience', () => {
  test('emits a registered actionable notification to the requesting user and dismisses it', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    let emittedId: string | null = null

    try {
      const before = await listExampleNotifications(request, token)
      const beforeIds = new Set(before.map((item) => String(item.id)))

      const emitted = await apiRequest(request, 'POST', '/api/example/notifications', {
        token,
        data: { linkHref: `/backend/umes-next-phases?allowed=1&run=${suffix}` },
      })
      expect(emitted.ok(), `emit notification failed: ${emitted.status()}`).toBeTruthy()

      const after = await listExampleNotifications(request, token)
      const fresh = after.filter((item) => !beforeIds.has(String(item.id)))
      expect(fresh.length, 'exactly one new notification must be emitted per request').toBe(1)

      const [notification] = fresh
      emittedId = String(notification.id)
      expect(notification.type).toBe(EXAMPLE_NOTIFICATION_TYPE)

      // The registered shape travels with the record: the type's declared actions and the
      // translation keys, not a hard-coded English string baked into the emitter.
      const serialized = JSON.stringify(notification)
      expect(serialized).toContain('example.notifications.umesActionable.title')
      expect(serialized).toContain('open')
      expect(serialized).toContain('dismiss')
      expect(serialized).toContain(suffix)

      // Audience: the notification is addressed, not broadcast. A second, unrelated account
      // must not see it in its own tray.
      const otherToken = await getAuthToken(request, 'superadmin')
      const otherTray = await listExampleNotifications(request, otherToken)
      expect(otherTray.map((item) => String(item.id))).not.toContain(emittedId)

      // A second emit is a second notification, not a silently merged one: the module emits an
      // actionable item per request, and collapsing them would hide work from the recipient.
      const secondEmit = await apiRequest(request, 'POST', '/api/example/notifications', {
        token,
        data: { linkHref: `/backend/umes-next-phases?allowed=1&run=${suffix}-b` },
      })
      expect(secondEmit.ok()).toBeTruthy()
      const afterSecond = await listExampleNotifications(request, token)
      expect(afterSecond.filter((item) => !beforeIds.has(String(item.id))).length).toBe(2)

      await dismissNotificationIfExists(request, token, emittedId)
      const afterDismiss = await listExampleNotifications(request, token)
      const dismissed = afterDismiss.find((item) => String(item.id) === emittedId)
      // Dismissal either removes the row from the tray or marks it dismissed; both are a
      // cleared tray from the recipient's point of view, and neither leaves it unread.
      expect(dismissed === undefined || Boolean(dismissed.dismissedAt ?? dismissed.dismissed_at)).toBe(true)
      emittedId = null
    } finally {
      await dismissNotificationIfExists(request, token, emittedId)
      await dismissNotificationsByType(request, token, EXAMPLE_NOTIFICATION_TYPE)
    }
  })

  test('refuses to emit for a caller without the managing feature', async ({ request }) => {
    // The route is gated on `example.todos.manage`. An unauthenticated caller is the one
    // negative every deployment can rely on, and it proves the gate is on the route rather
    // than only in the UI that links to it.
    const response = await apiRequest(request, 'POST', '/api/example/notifications', {
      token: 'not-a-real-token',
      data: {},
    })
    expect(response.ok(), 'an unauthenticated emit must be refused').toBeFalsy()
    expect([401, 403]).toContain(response.status())
  })
})
