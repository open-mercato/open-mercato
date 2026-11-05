import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import {
  getCapturedOmEvents,
  installOmEventCollector,
} from '@open-mercato/core/modules/core/__integration__/helpers/sseEventCollector'

type JwtClaims = {
  sub: string
}

function decodeJwtClaims(token: string): JwtClaims {
  const payload = token.split('.')[1] ?? ''
  const json = Buffer.from(payload, 'base64url').toString('utf8')
  return JSON.parse(json) as JwtClaims
}

async function hasNotificationEvent(
  page: Page,
  recipientUserId: string,
  title: string,
): Promise<boolean> {
  const events = await getCapturedOmEvents(page)
  return events.some((event) => {
    if (event.id !== 'notifications.notification.created') return false
    const payload = event.payload
    if (!payload || typeof payload !== 'object') return false
    const payloadRecipientUserId = (payload as { recipientUserId?: unknown }).recipientUserId
    if (payloadRecipientUserId !== recipientUserId) return false
    const notification = payload.notification
    if (!notification || typeof notification !== 'object') return false
    const notificationTitle = (notification as { title?: unknown }).title
    return notificationTitle === title
  })
}

async function hasNotificationBatchEvent(
  page: Page,
  recipientUserId: string,
): Promise<boolean> {
  const events = await getCapturedOmEvents(page)
  return events.some((event) => {
    if (event.id !== 'notifications.notification.batch_created') return false
    const payload = event.payload
    if (!payload || typeof payload !== 'object') return false
    const recipientUserIds = (payload as { recipientUserIds?: unknown }).recipientUserIds
    if (!Array.isArray(recipientUserIds)) return false
    return recipientUserIds.includes(recipientUserId)
  })
}

async function waitForEventBridgeSubscription(page: Page): Promise<void> {
  const streamRequested = page.waitForRequest((request) => (
    request.url().includes('/api/events/stream')
      && request.resourceType() === 'eventsource'
  ))

  await page.goto('/backend')
  await page.waitForLoadState('domcontentloaded')
  await streamRequested
  await page.waitForTimeout(250)
  await installOmEventCollector(page)
}

async function waitForNotificationBridgeReady(
  page: Page,
  request: Parameters<typeof apiRequest>[0],
  token: string,
  recipientUserId: string,
): Promise<void> {
  const probeTitle = `Notifications Bridge Ready ${Date.now()}`
  const probeRes = await apiRequest(request, 'POST', '/api/notifications', {
    token,
    data: {
      type: 'integration.test.bridge-ready',
      title: probeTitle,
      recipientUserId,
    },
  })
  expect(probeRes.ok()).toBeTruthy()

  await expect
    .poll(async () => hasNotificationEvent(page, recipientUserId, probeTitle), { timeout: 8_000 })
    .toBe(true)
}

test.describe('TC-ADMIN-013: Notifications SSE', () => {
  test('delivers notifications.notification.created to target user without polling', async ({ page, request }) => {
    await login(page, 'superadmin')
    await waitForEventBridgeSubscription(page)

    const token = await getAuthToken(request, 'superadmin')
    const claims = decodeJwtClaims(token)
    await waitForNotificationBridgeReady(page, request, token, claims.sub)
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

  test('delivers notifications.notification.batch_created when batch notification is created', async ({ page, request }) => {
    await login(page, 'superadmin')
    await waitForEventBridgeSubscription(page)

    const token = await getAuthToken(request, 'superadmin')
    const claims = decodeJwtClaims(token)
    await waitForNotificationBridgeReady(page, request, token, claims.sub)
    const uniqueTitle = `Integration Notification Batch ${Date.now()}`

    const createRes = await apiRequest(request, 'POST', '/api/notifications/batch', {
      token,
      data: {
        type: 'integration.test.batch',
        title: uniqueTitle,
        recipientUserIds: [claims.sub],
      },
    })
    expect(createRes.ok()).toBeTruthy()

    await expect
      .poll(async () => hasNotificationBatchEvent(page, claims.sub), { timeout: 8_000 })
      .toBe(true)
  })
})
