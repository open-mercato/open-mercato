import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createPaymentSession } from './helpers/fixtures'

test.describe('TC-PGWY-021: Manual payment operation idempotency', () => {
  test('replays one logical refund and permits distinct equal partial refunds', async ({ request }) => {
    const operationSuffix = randomUUID()
    const token = await getAuthToken(request)
    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 40,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })

    const capture = await apiRequest(request, 'POST', '/api/payment_gateways/capture', {
      token,
      data: { transactionId: session.transactionId, operationId: `capture-${operationSuffix}` },
    })
    expect(capture.ok()).toBe(true)

    const refundPayload = {
      transactionId: session.transactionId,
      amount: 10,
      reason: 'Partial return',
      operationId: `refund-a-${operationSuffix}`,
    }
    const first = await apiRequest(request, 'POST', '/api/payment_gateways/refund', {
      token,
      data: refundPayload,
    })
    expect(first.ok()).toBe(true)
    const firstResult = await first.json()

    const replay = await apiRequest(request, 'POST', '/api/payment_gateways/refund', {
      token,
      data: refundPayload,
    })
    expect(replay.ok()).toBe(true)
    expect(await replay.json()).toEqual(firstResult)

    const conflicting = await apiRequest(request, 'POST', '/api/payment_gateways/refund', {
      token,
      data: { ...refundPayload, amount: 15 },
    })
    expect(conflicting.status()).toBe(409)
    await expect(conflicting.json()).resolves.toMatchObject({ code: 'payment_operation_conflict' })

    const distinct = await apiRequest(request, 'POST', '/api/payment_gateways/refund', {
      token,
      data: { ...refundPayload, operationId: `refund-b-${operationSuffix}` },
    })
    expect(distinct.ok()).toBe(true)
    const distinctResult = await distinct.json()
    expect(distinctResult.refundId).not.toBe(firstResult.refundId)
  })
})
