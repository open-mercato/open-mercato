import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

function decodeJwtSubject(token: string): string {
  const payload = token.split('.')[1] ?? ''
  const decoded = Buffer.from(payload, 'base64url').toString('utf8')
  const parsed = JSON.parse(decoded) as { sub?: string }
  if (!parsed.sub || parsed.sub.trim().length === 0) {
    throw new Error('Missing JWT subject')
  }
  return parsed.sub
}

test.describe('TC-NOTIF-001: notification SSE delivery', () => {
  test.describe.configure({ timeout: 120_000 })

  test('delivers notification updates via SSE without periodic polling', async ({ page, request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const adminUserId = decodeJwtSubject(adminToken)

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

      await page.waitForTimeout(3_000)
      const baselineRequests = { ...requestCounts }

      const createNotificationResponse = await apiRequest(request, 'POST', '/api/notifications', {
        token: superadminToken,
        data: {
          recipientUserId: adminUserId,
          type: 'notifications.test.sse',
          title,
          body: 'SSE integration test notification',
          severity: 'info',
          sourceModule: 'notifications',
        },
      })

      expect(createNotificationResponse.ok()).toBeTruthy()

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
