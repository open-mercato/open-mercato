import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { expect, test } from '@playwright/test'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const STRIPE_WEBHOOK_PATH = '/api/payment_gateways/webhook/stripe'
const LIMIT_BYTES = 1024 * 1024

function paddedEventJson(totalBytes: number): string {
  const prefix = `{"id":"evt_tc_pgwy_025","type":"payment_intent.succeeded","data":{"object":{"id":"pi_tc_pgwy_025_${Date.now()}"}},"pad":"`
  const suffix = '"}'
  return prefix + 'x'.repeat(totalBytes - prefix.length - suffix.length) + suffix
}

function postChunked(totalBytes: number): Promise<number> {
  const url = new URL(STRIPE_WEBHOOK_PATH, BASE_URL)
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    let responded = false
    const req = send(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=1,v1=00',
        'transfer-encoding': 'chunked',
      },
    }, (res) => {
      responded = true
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'EPIPE' || (error as NodeJS.ErrnoException).code === 'ECONNRESET') return
      reject(error)
    })
    req.on('close', () => {
      if (!responded) reject(new Error('[internal] connection closed before a response arrived'))
    })
    const chunk = Buffer.alloc(64 * 1024, 0x20)
    let sent = 0
    const writeMore = () => {
      while (sent < totalBytes) {
        sent += chunk.length
        if (!req.write(chunk)) {
          req.once('drain', writeMore)
          return
        }
      }
      req.end()
    }
    writeMore()
  })
}

/**
 * TC-PGWY-025: the unauthenticated Stripe webhook endpoint refuses bodies over 1 MiB with 413
 * before verifying a signature or looking up a transaction, and still reads a body of exactly 1 MiB
 * (answered 401 because no transaction matches the fixture's PaymentIntent id).
 */
test.describe('TC-PGWY-025: Stripe webhook body limit', () => {
  test.beforeEach(async ({ request }) => {
    const probe = await request.fetch(`${BASE_URL}${STRIPE_WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: '{}',
    })
    test.skip(probe.status() === 404, 'gateway_stripe is not enabled in this app')
  })

  test('answers 413 for a declared body over 1 MiB', async ({ request }) => {
    const response = await request.fetch(`${BASE_URL}${STRIPE_WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=00' },
      data: paddedEventJson(LIMIT_BYTES + 1),
    })
    expect(response.status()).toBe(413)
    expect(await response.json()).toEqual({ error: 'Webhook payload too large' })
  })

  test('answers 413 for a chunked body over 1 MiB without Content-Length', async () => {
    expect(await postChunked(LIMIT_BYTES * 4)).toBe(413)
  })

  test('still reads a body of exactly 1 MiB and answers 401 when no transaction matches', async ({ request }) => {
    const response = await request.fetch(`${BASE_URL}${STRIPE_WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=00' },
      data: paddedEventJson(LIMIT_BYTES),
    })
    expect(response.status()).toBe(401)
  })
})
