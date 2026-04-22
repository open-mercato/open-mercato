import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import {
  getCapturedOmEvents,
  installOmEventCollector,
} from '@open-mercato/core/modules/core/__integration__/helpers/sseEventCollector'
import { deleteMessageIfExists, decodeJwtSubject } from './helpers'

async function hasMessagesSentEvent(
  page: Page,
  recipientUserId: string,
  messageId: string,
): Promise<boolean> {
  const events = await getCapturedOmEvents(page)
  return events.some((event) => {
    if (event.id !== 'messages.message.sent') return false
    const payload = event.payload
    if (!payload || typeof payload !== 'object') return false
    const ids = (payload as { recipientUserIds?: unknown }).recipientUserIds
    if (!Array.isArray(ids)) return false
    if (!ids.includes(recipientUserId)) return false
    return (payload as { messageId?: unknown }).messageId === messageId
  })
}

async function hasMessagesReadEvent(
  page: Page,
  recipientUserId: string,
  messageId: string,
): Promise<boolean> {
  const events = await getCapturedOmEvents(page)
  return events.some((event) => {
    if (event.id !== 'messages.message.read') return false
    const payload = event.payload
    if (!payload || typeof payload !== 'object') return false
    if ((payload as { messageId?: unknown }).messageId !== messageId) return false
    return (payload as { recipientUserId?: unknown }).recipientUserId === recipientUserId
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

async function waitForMessagesBridgeReady(
  page: Page,
  request: Parameters<typeof apiRequest>[0],
  adminToken: string,
  employeeUserId: string,
): Promise<void> {
  const subject = `Messages Bridge Ready ${Date.now()}`
  const createRes = await apiRequest(request, 'POST', '/api/messages', {
    token: adminToken,
    data: {
      recipients: [{ userId: employeeUserId, type: 'to' }],
      subject,
      body: 'probe',
      sendViaEmail: false,
    },
  })
  expect(createRes.status()).toBe(201)
  const created = (await createRes.json()) as { id?: string }
  const probeId = typeof created.id === 'string' ? created.id : null
  expect(probeId).toBeTruthy()
  try {
    await expect
      .poll(async () => hasMessagesSentEvent(page, employeeUserId, probeId as string), { timeout: 8_000 })
      .toBe(true)
  } finally {
    await deleteMessageIfExists(request, adminToken, probeId)
  }
}

/**
 * TC-MSG-012: Messages DOM Event Bridge (SSE)
 * Verifies `messages.message.*` events with `clientBroadcast: true` reach the
 * recipient's browser via `om:event` without relying on list polling.
 */
test.describe('TC-MSG-012: Messages SSE (DOM Event Bridge)', () => {
  test('delivers messages.message.sent to recipient session', async ({ page, request }) => {
    let messageId: string | null = null
    let adminToken: string | null = null

    try {
      await login(page, 'employee')
      await waitForEventBridgeSubscription(page)

      adminToken = await getAuthToken(request, 'admin')
      const employeeToken = await getAuthToken(request, 'employee')
      const employeeUserId = decodeJwtSubject(employeeToken)

      await waitForMessagesBridgeReady(page, request, adminToken, employeeUserId)

      const subject = `Integration Messages SSE ${Date.now()}`
      const createRes = await apiRequest(request, 'POST', '/api/messages', {
        token: adminToken,
        data: {
          recipients: [{ userId: employeeUserId, type: 'to' }],
          subject,
          body: 'SSE integration body',
          sendViaEmail: false,
        },
      })
      expect(createRes.status()).toBe(201)
      const created = (await createRes.json()) as { id?: unknown }
      expect(typeof created.id).toBe('string')
      messageId = created.id as string

      await expect
        .poll(async () => hasMessagesSentEvent(page, employeeUserId, messageId as string), { timeout: 8_000 })
        .toBe(true)
    } finally {
      await deleteMessageIfExists(request, adminToken, messageId)
    }
  })

  test('delivers messages.message.read to recipient session after mark read', async ({ page, request }) => {
    let messageId: string | null = null
    let adminToken: string | null = null

    try {
      await login(page, 'employee')
      await waitForEventBridgeSubscription(page)

      adminToken = await getAuthToken(request, 'admin')
      const employeeToken = await getAuthToken(request, 'employee')
      const employeeUserId = decodeJwtSubject(employeeToken)

      await waitForMessagesBridgeReady(page, request, adminToken, employeeUserId)

      const subject = `Integration Messages SSE Read ${Date.now()}`
      const createRes = await apiRequest(request, 'POST', '/api/messages', {
        token: adminToken,
        data: {
          recipients: [{ userId: employeeUserId, type: 'to' }],
          subject,
          body: 'Mark read SSE body',
          sendViaEmail: false,
        },
      })
      expect(createRes.status()).toBe(201)
      const created = (await createRes.json()) as { id?: unknown }
      expect(typeof created.id).toBe('string')
      messageId = created.id as string

      await expect
        .poll(async () => hasMessagesSentEvent(page, employeeUserId, messageId as string), { timeout: 8_000 })
        .toBe(true)

      const readRes = await apiRequest(request, 'PUT', `/api/messages/${encodeURIComponent(messageId)}/read`, {
        token: employeeToken,
      })
      expect(readRes.ok()).toBeTruthy()

      await expect
        .poll(async () => hasMessagesReadEvent(page, employeeUserId, messageId as string), { timeout: 8_000 })
        .toBe(true)
    } finally {
      await deleteMessageIfExists(request, adminToken, messageId)
    }
  })
})
