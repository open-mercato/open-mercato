import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createPaymentSession, getTransactionStatus } from './helpers/fixtures'

/**
 * TC-PGWY-022: Captures cannot add up past the authorized amount (#4487)
 *
 * #4486 rejected a single capture larger than the authorization, but each request was
 * compared against the full amount in isolation, so repeated partial captures (60 + 60
 * against 100) still slipped through. The service now keeps a captured-to-date ledger on
 * the transaction and reserves the requested slice before the provider is called, so the
 * sum of all captures against one authorization can never exceed it.
 */
test.describe('TC-PGWY-022: Cumulative capture ceiling', () => {
  async function capture(
    request: APIRequestContext,
    token: string,
    transactionId: string,
    amount: number | undefined,
    operationId: string,
  ) {
    return apiRequest(request, 'POST', '/api/payment_gateways/capture', {
      token,
      data: { transactionId, amount, operationId },
    })
  }

  test('rejects a second partial capture that would exceed the authorized amount', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = `${Date.now()}`

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 100.00,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })
    expect(session.status).toBe('authorized')

    const first = await capture(request, token, session.transactionId, 60.00, `cap-a-${suffix}`)
    expect(first.ok()).toBe(true)
    expect((await first.json()).capturedAmount).toBe(60.00)

    // 60 + 60 = 120 against an authorization of 100: each request passes a per-capture
    // check on its own, so only the cumulative ceiling can reject this one.
    const second = await capture(request, token, session.transactionId, 60.00, `cap-b-${suffix}`)
    expect(second.status()).toBe(409)
    expect((await second.json()).code).toBe('payment_capture_ceiling_exceeded')

    // The rejected capture must not have consumed any of the remaining 40.
    const third = await capture(request, token, session.transactionId, 40.00, `cap-c-${suffix}`)
    expect(third.ok()).toBe(true)
    expect((await third.json()).capturedAmount).toBe(40.00)

    const fourth = await capture(request, token, session.transactionId, 0.01, `cap-d-${suffix}`)
    expect(fourth.status()).toBe(409)
    expect((await fourth.json()).code).toBe('payment_capture_ceiling_exceeded')

    const status = await getTransactionStatus(request, token, session.transactionId)
    expect(status.status).toBe('captured')
  })

  test('captures only the remainder when a later request omits the amount', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = `${Date.now()}`

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 80.00,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })
    expect(session.status).toBe('authorized')

    const first = await capture(request, token, session.transactionId, 30.00, `rest-a-${suffix}`)
    expect(first.ok()).toBe(true)

    const rest = await capture(request, token, session.transactionId, undefined, `rest-b-${suffix}`)
    expect(rest.ok()).toBe(true)
    expect((await rest.json()).capturedAmount).toBe(50.00)

    const extra = await capture(request, token, session.transactionId, 1.00, `rest-c-${suffix}`)
    expect(extra.status()).toBe(409)
    expect((await extra.json()).code).toBe('payment_capture_ceiling_exceeded')
  })

  test('replays a repeated operation id instead of capturing a second time', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = `${Date.now()}`

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 50.00,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })

    const operationId = `replay-${suffix}`
    const first = await capture(request, token, session.transactionId, 20.00, operationId)
    expect(first.ok()).toBe(true)

    const replay = await capture(request, token, session.transactionId, 20.00, operationId)
    expect(replay.ok()).toBe(true)
    expect(await replay.json()).toEqual(await first.json())

    // The replay must not have consumed a second 20 from the authorization.
    const remainder = await capture(request, token, session.transactionId, 30.00, `remainder-${suffix}`)
    expect(remainder.ok()).toBe(true)
    expect((await remainder.json()).capturedAmount).toBe(30.00)
  })

  test('rejects concurrent captures that would jointly exceed the authorization', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = `${Date.now()}`

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 100.00,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })

    const [left, right] = await Promise.all([
      capture(request, token, session.transactionId, 60.00, `race-a-${suffix}`),
      capture(request, token, session.transactionId, 60.00, `race-b-${suffix}`),
    ])

    const statuses = [left.status(), right.status()].sort((a, b) => a - b)
    expect(statuses).toEqual([200, 409])

    const loser = left.status() === 409 ? left : right
    expect((await loser.json()).code).toMatch(/payment_capture_(ceiling_exceeded|reservation_conflict)/)
  })
})
