import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  createNotificationFixture,
  dismissNotificationsByType,
  listNotifications,
} from '@open-mercato/core/helpers/integration/notificationsFixtures'

/**
 * TC-NOTIF-019: notification hrefs must stay on the application origin (#7240).
 *
 * A prefix-only check accepted `/\host` and `/<TAB>/host`, which the WHATWG URL parser (browser,
 * Next router, `<a href>`) resolves to an external origin. Create endpoints must reject them for
 * both `linkHref` and action hrefs, ordinary backend paths keep working, and rows stored before
 * the check was tightened are no longer handed to clients.
 *
 * The stored-row test seeds an unsafe href with SQL through `withClient`, which reads `DATABASE_URL`
 * from the environment or the app `.env`.
 */

const UNSAFE_HREFS = ['/\\evil.example/phish', '/\t/evil.example/phish', '/\\/evil.example']

test.describe('TC-NOTIF-019: notification hrefs resolve to the same origin', () => {
  test('rejects external-resolving hrefs on create and keeps same-origin paths', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { userId } = getTokenScope(token)
    const type = `qa.notifications.href.${Date.now()}`

    try {
      for (const href of UNSAFE_HREFS) {
        const linkResponse = await apiRequest(request, 'POST', '/api/notifications', {
          token,
          data: { type, title: 'Unsafe link', recipientUserId: userId, linkHref: href },
        })
        expect(linkResponse.status(), `linkHref ${JSON.stringify(href)} must be rejected`).toBe(400)

        const actionResponse = await apiRequest(request, 'POST', '/api/notifications', {
          token,
          data: {
            type,
            title: 'Unsafe action',
            recipientUserId: userId,
            actions: [{ id: 'open', label: 'Open', href }],
          },
        })
        expect(actionResponse.status(), `action href ${JSON.stringify(href)} must be rejected`).toBe(400)
      }

      const okResponse = await apiRequest(request, 'POST', '/api/notifications', {
        token,
        data: { type, title: 'Safe link', recipientUserId: userId, linkHref: '/backend/notifications' },
      })
      expect(okResponse.status()).toBe(201)
      const created = await readJsonSafe<{ id?: string }>(okResponse)

      const listed = await listNotifications(request, token, { type })
      expect(listed.items).toHaveLength(1)
      expect(listed.items[0]?.id).toBe(created?.id)
      expect(listed.items[0]?.linkHref).toBe('/backend/notifications')
    } finally {
      await dismissNotificationsByType(request, token, type)
    }
  })

  test('does not hand out unsafe hrefs stored before the check was tightened', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { userId } = getTokenScope(token)
    const type = `qa.notifications.href.legacy.${Date.now()}`
    const sourceEntityId = randomUUID()

    try {
      const notificationId = await createNotificationFixture(request, token, {
        type,
        title: 'Legacy link',
        recipientUserId: userId,
        sourceEntityId,
        linkHref: '/backend/notifications',
        actions: [
          { id: 'legacy', label: 'Legacy', href: '/backend/notifications' },
          { id: 'safe', label: 'Safe', href: '/backend/example/{sourceEntityId}' },
        ],
      })

      const seeded = await withClient((client) =>
        client.query(
          `update notifications
              set link_href = $2,
                  action_data = jsonb_set(action_data, '{actions,0,href}', to_jsonb($3::text))
            where id = $1`,
          [notificationId, '/\\evil.example/phish', '/\t/evil.example/phish'],
        ),
      )
      expect(seeded.rowCount).toBe(1)

      const listed = await listNotifications(request, token, { type })
      expect(listed.items).toHaveLength(1)
      const item = listed.items[0] as { linkHref?: unknown; actions?: Array<{ id: string; href?: unknown }> }
      expect(item.linkHref ?? null).toBeNull()
      expect((item.actions ?? []).map((action) => [action.id, action.href ?? null])).toEqual([
        ['legacy', null],
        ['safe', `/backend/example/${sourceEntityId}`],
      ])

      const actionResponse = await apiRequest(
        request,
        'POST',
        `/api/notifications/${encodeURIComponent(notificationId)}/action`,
        { token, data: { actionId: 'legacy' } },
      )
      expect(actionResponse.status()).toBe(200)
      const actionBody = await readJsonSafe<{ ok?: boolean; href?: unknown }>(actionResponse)
      expect(actionBody?.ok).toBe(true)
      expect(actionBody?.href ?? null).toBeNull()
    } finally {
      await dismissNotificationsByType(request, token, type)
      await withClient((client) => client.query('delete from notifications where type = $1', [type])).catch(() => undefined)
    }
  })
})
