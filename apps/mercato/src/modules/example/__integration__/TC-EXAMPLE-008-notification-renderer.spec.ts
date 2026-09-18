import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  dismissNotificationIfExists,
  listNotifications,
} from '@open-mercato/core/helpers/integration/notificationsFixtures'

const EXAMPLE_NOTIFICATION_TYPE = 'example.umes.actionable'

export const integrationMeta = {
  dependsOnModules: ['example', 'notifications', 'events'],
}

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
  test('renders deduped success and failure notifications for the requesting user and cleans them up', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const emittedIds = new Set<string>()

    try {
      const before = await listExampleNotifications(request, token)
      const beforeIds = new Set(before.map((item) => String(item.id)))

      const emitted = await apiRequest(request, 'POST', '/api/example/notifications', {
        token,
        data: {
          linkHref: `/backend/umes-next-phases?allowed=1&run=${suffix}`,
          outcome: 'success',
          dedupeKey: suffix,
        },
      })
      expect(emitted.ok(), `emit notification failed: ${emitted.status()}`).toBeTruthy()

      const after = await listExampleNotifications(request, token)
      const fresh = after.filter((item) => !beforeIds.has(String(item.id)))
      expect(fresh.length, 'exactly one new notification must be emitted per request').toBe(1)

      const [notification] = fresh
      const successId = String(notification.id)
      emittedIds.add(successId)
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
      expect(otherTray.map((item) => String(item.id))).not.toContain(successId)

      // Repeating the same logical success refreshes the existing record rather than adding a
      // duplicate tray item. The returned identity makes that contract explicit.
      const duplicateSuccess = await apiRequest(request, 'POST', '/api/example/notifications', {
        token,
        data: {
          linkHref: `/backend/umes-next-phases?allowed=1&run=${suffix}`,
          outcome: 'success',
          dedupeKey: suffix,
        },
      })
      expect(duplicateSuccess.ok()).toBeTruthy()
      expect(String((await duplicateSuccess.json() as { id: string }).id)).toBe(successId)

      const failed = await apiRequest(request, 'POST', '/api/example/notifications', {
        token,
        data: {
          linkHref: `/backend/umes-next-phases?allowed=1&run=${suffix}-failure`,
          outcome: 'failure',
          dedupeKey: suffix,
        },
      })
      expect(failed.ok()).toBeTruthy()
      const failureId = String((await failed.json() as { id: string }).id)
      emittedIds.add(failureId)

      const afterOutcomes = await listExampleNotifications(request, token)
      const outcomeRows = afterOutcomes.filter((item) => emittedIds.has(String(item.id)))
      expect(outcomeRows).toHaveLength(2)
      expect(outcomeRows.map((item) => item.severity).sort()).toEqual(['error', 'success'])

      // Opening the real notification panel proves discovery attached the module's client
      // renderer. The marker lives inside that renderer, not the generic NotificationItem.
      await login(page, 'admin')
      await page.goto('/backend/umes-next-phases', { waitUntil: 'domcontentloaded' })
      const bell = page.getByRole('button', { name: /notifications/i }).first()
      await expect(bell).toBeVisible({ timeout: 30_000 })
      await bell.click()
      for (const notificationId of emittedIds) {
        await expect(
          page.locator(`[data-testid="example-actionable-notification-renderer"][data-notification-id="${notificationId}"]`),
        ).toBeVisible({ timeout: 30_000 })
      }

      await dismissNotificationIfExists(request, token, successId)
      const afterDismiss = await listExampleNotifications(request, token)
      const dismissed = afterDismiss.find((item) => String(item.id) === successId)
      // Dismissal either removes the row from the tray or marks it dismissed; both are a
      // cleared tray from the recipient's point of view, and neither leaves it unread.
      expect(dismissed === undefined || Boolean(dismissed.dismissedAt ?? dismissed.dismissed_at)).toBe(true)
      emittedIds.delete(successId)
    } finally {
      for (const notificationId of emittedIds) {
        await dismissNotificationIfExists(request, token, notificationId)
      }
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
