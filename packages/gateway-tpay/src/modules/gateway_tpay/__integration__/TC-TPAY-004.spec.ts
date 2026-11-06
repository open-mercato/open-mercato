import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * TC-TPAY-004: Tpay notifications on the generic payment webhook route
 *
 * Unauthenticated form posts to `/api/payment_gateways/webhook/tpay` get Tpay's plain-text protocol answers:
 * an unknown `tr_crc` is retryable (`503 FALSE`) and a body over 64 KiB is rejected (`413 FALSE`).
 * No stored transaction, credential, or network call to Tpay is involved.
 */
const WEBHOOK_PATH = '/api/payment_gateways/webhook/tpay'

function notificationForm(trCrc: string): string {
  return new URLSearchParams({
    id: '123456',
    tr_id: 'TR-QA00-000000',
    tr_date: '2026-10-09 12:00:00',
    tr_crc: trCrc,
    tr_amount: '12.34',
    tr_paid: '12.34',
    tr_desc: 'QA notification',
    tr_status: 'TRUE',
    tr_error: 'none',
    tr_email: 'qa@example.com',
    md5sum: '0'.repeat(32),
    test_mode: '1',
  }).toString()
}

async function postNotification(request: APIRequestContext, body: string) {
  return request.post(WEBHOOK_PATH, {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-jws-signature': 'e30..c2ln',
      'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    },
    data: body,
  })
}

test.describe('TC-TPAY-004: Tpay notification responses', () => {
  test('answers 503 FALSE for a notification whose transaction is unknown', async ({ request }) => {
    const response = await postNotification(request, notificationForm(randomUUID()))

    expect(response.status()).toBe(503)
    expect(response.headers()['content-type']).toContain('text/plain')
    expect(await response.text()).toBe('FALSE')
  })

  test('answers 413 FALSE for a notification body over 64 KiB', async ({ request }) => {
    const oversized = `${notificationForm(randomUUID())}&padding=${'x'.repeat(70 * 1024)}`

    const response = await postNotification(request, oversized)

    expect(response.status()).toBe(413)
    expect(await response.text()).toBe('FALSE')
  })
})
