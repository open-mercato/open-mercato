import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

const OM_EVENT_NAME = 'om:event'

type CapturedEvent = {
  id: string
  payload?: Record<string, unknown>
}

type JwtClaims = {
  sub: string
}

function decodeJwtClaims(token: string): JwtClaims {
  const payload = token.split('.')[1] ?? ''
  const json = Buffer.from(payload, 'base64url').toString('utf8')
  return JSON.parse(json) as JwtClaims
}

async function installCollector(page: Page): Promise<void> {
  await page.evaluate((eventName) => {
    ;(window as unknown as { __capturedOmEvents?: CapturedEvent[] }).__capturedOmEvents = []
    window.addEventListener(eventName, (event: Event) => {
      const detail = (event as CustomEvent<CapturedEvent>).detail
      if (!detail || typeof detail !== 'object') return
      const store = (window as unknown as { __capturedOmEvents?: CapturedEvent[] }).__capturedOmEvents
      if (!store) return
      store.push(detail)
    })
  }, OM_EVENT_NAME)
}

async function hasNotificationEvent(
  page: Page,
  recipientUserId: string,
  title: string,
): Promise<boolean> {
  return page.evaluate(({ userId, titleText }) => {
    const events = (window as unknown as { __capturedOmEvents?: CapturedEvent[] }).__capturedOmEvents ?? []
    return events.some((event) => {
      if (event.id !== 'notifications.notification.created') return false
      const payload = event.payload
      if (!payload || typeof payload !== 'object') return false
      const recipientUserId = (payload as { recipientUserId?: unknown }).recipientUserId
      if (recipientUserId !== userId) return false
      const notification = payload.notification
      if (!notification || typeof notification !== 'object') return false
      const notificationTitle = (notification as { title?: unknown }).title
      return notificationTitle === titleText
    })
  }, { userId: recipientUserId, titleText: title })
}

test.describe('TC-ADMIN-013: Notifications SSE', () => {
  test('delivers notifications.notification.created to target user without polling', async ({ page, request }) => {
    await login(page, 'superadmin')
    await page.goto('/backend')
    await page.waitForLoadState('domcontentloaded')
    await installCollector(page)

    const token = await getAuthToken(request, 'superadmin')
    const claims = decodeJwtClaims(token)
    const uniqueTitle = `Integration Notification ${Date.now()}`

    const createRes = await apiRequest(request, 'POST', '/api/notifications', {
      token,
      data: {
        type: 'integration.test',
        title: uniqueTitle,
        recipientUserId: claims.sub,
      },
    })
    expect(createRes.ok()).toBeTruthy()

    await expect
      .poll(async () => hasNotificationEvent(page, claims.sub, uniqueTitle), { timeout: 8_000 })
      .toBe(true)
  })
})
