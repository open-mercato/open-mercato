import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

const SEND_PATH = '/api/push_notifications/custom-send'
// A well-formed v4 UUID with no registered devices — the send resolves but fans out to nobody.
const RECIPIENT_NO_DEVICES = '22222222-2222-4222-8222-222222222222'

type SendResponse = { enqueued?: number; warning?: string }

test.describe('TC-PUSH-002: Admin custom push send', () => {
  test('admin sends a custom push; with no recipient devices it enqueues nothing (200)', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const res = await apiRequest(request, 'POST', SEND_PATH, {
      token: adminToken,
      data: { recipientUserId: RECIPIENT_NO_DEVICES, title: 'Scheduled maintenance', body: 'Down at 02:00 UTC.' },
    })
    // 201 Created only when jobs were actually enqueued; the no-op branch returns 200 OK so a caller
    // can distinguish "sent" from "matched nobody" without parsing the body.
    expect(res.status()).toBe(200)
    const json = await readJsonSafe<SendResponse>(res)
    // Wiring smoke: route → guard → service → fan-out runs end-to-end. No devices ⇒ enqueued 0.
    expect(json?.enqueued).toBe(0)
    expect(json?.warning).toBe('no_matching_devices_in_scope')
  })

  test('an invalid payload (missing title) is rejected with 400', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const res = await apiRequest(request, 'POST', SEND_PATH, {
      token: adminToken,
      data: { recipientUserId: RECIPIENT_NO_DEVICES },
    })
    expect(res.status()).toBe(400)
  })

  test('employee without push_notifications.send_custom is forbidden', async ({ request }) => {
    const employeeToken = await getAuthToken(request, 'employee')
    const res = await apiRequest(request, 'POST', SEND_PATH, {
      token: employeeToken,
      data: { recipientUserId: RECIPIENT_NO_DEVICES, title: 'Hi' },
    })
    expect(res.status()).toBe(403)
  })

  test('unauthenticated send requests are rejected', async ({ request }) => {
    const res = await request.fetch(SEND_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: { recipientUserId: RECIPIENT_NO_DEVICES, title: 'Hi' },
    })
    expect([401, 403]).toContain(res.status())
  })
})
