import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

test.describe('TC-NOTIF-001: notification SSE delivery', () => {
  test.describe.configure({ timeout: 120_000 })

  test('delivers notification updates via SSE without periodic polling', async ({ page, request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')

    const requestCounts = {
      notificationsList: 0,
      unreadCount: 0,
    }

    const onRequest = (rawRequest: { url: () => string }) => {
      const url = rawRequest.url()
      if (url.includes('/api/notifications?')) {
        requestCounts.notificationsList += 1
      }
      if (url.includes('/api/notifications/unread-count')) {
        requestCounts.unreadCount += 1
      }
    }

    const title = `TC-NOTIF-001 ${Date.now()}`

    try {
      await login(page, 'admin')
      page.on('request', onRequest)
      await page.goto('/backend')
      await page.waitForLoadState('domcontentloaded')

      await page.evaluate(() => {
        const store = window as unknown as { __tcNotificationSseEvents?: number }
        store.__tcNotificationSseEvents = 0
        window.addEventListener('om:event', (event) => {
          const detail = (event as CustomEvent<{ id?: string }>).detail
          if (detail?.id === 'notifications.notification.created') {
            store.__tcNotificationSseEvents = (store.__tcNotificationSseEvents ?? 0) + 1
          }
        })
      })

      await page.waitForTimeout(3_000)
      const baselineRequests = { ...requestCounts }

      const createNotificationResponse = await apiRequest(request, 'POST', '/api/notifications/feature', {
        token: superadminToken,
        data: {
          requiredFeature: 'notifications.view',
          type: 'notifications.test.sse',
          title,
          body: 'SSE integration test notification',
          severity: 'info',
          sourceModule: 'notifications',
        },
      })

      expect(createNotificationResponse.ok()).toBeTruthy()

      await expect.poll(async () => {
        return page.evaluate(() => {
          const store = window as unknown as { __tcNotificationSseEvents?: number }
          return store.__tcNotificationSseEvents ?? 0
        })
      }, { timeout: 20_000 }).toBeGreaterThan(0)

      await expect.poll(async () => {
        const listResponse = await apiRequest(request, 'GET', '/api/notifications?pageSize=10', { token: adminToken })
        if (!listResponse.ok()) {
          return false
        }
        const body = await listResponse.json() as { items?: Array<{ title?: string }> }
        return Boolean(body.items?.some((item) => item.title === title))
      }, { timeout: 20_000 }).toBe(true)

      await page.waitForTimeout(6_000)
      expect(requestCounts.notificationsList).toBe(baselineRequests.notificationsList)
      expect(requestCounts.unreadCount).toBe(baselineRequests.unreadCount)
    } finally {
      page.off('request', onRequest)
    }
  })
})
