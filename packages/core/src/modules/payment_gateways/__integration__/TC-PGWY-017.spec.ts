import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { createPaymentSession } from './helpers/fixtures'

/**
 * TC-PGWY-017: Payload validation on the mutation routes
 *
 * /capture, /refund, /cancel and /sessions validate their JSON body with zod before any
 * service call and reject malformed payloads with 422 `{ error: 'Invalid payload', details }`.
 * Covers positive amounts, required transactionId, UUID format, reason length, currency
 * length and required providerKey. A fully valid session + capture confirm the happy path.
 */
type ValidationError = {
  error: string
  details?: { fieldErrors?: Record<string, string[]> }
}

test.describe('TC-PGWY-017: Mutation payload validation', () => {
  test('rejects invalid capture/refund payloads with 422', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const validId = randomUUID()

    const negativeAmount = await apiRequest(request, 'POST', '/api/payment_gateways/capture', {
      token,
      data: { transactionId: validId, amount: -10 },
    })
    expect(negativeAmount.status(), 'capture amount must be positive').toBe(422)
    const negativeAmountBody = await readJsonSafe<ValidationError>(negativeAmount)
    expect(negativeAmountBody?.details?.fieldErrors?.amount, 'amount field error present').toBeTruthy()

    const zeroAmount = await apiRequest(request, 'POST', '/api/payment_gateways/capture', {
      token,
      data: { transactionId: validId, amount: 0 },
    })
    expect(zeroAmount.status(), 'capture amount of zero is not positive').toBe(422)

    const nonNumericAmount = await apiRequest(request, 'POST', '/api/payment_gateways/capture', {
      token,
      data: { transactionId: validId, amount: 'abc' },
    })
    expect(nonNumericAmount.status(), 'capture amount must be numeric').toBe(422)

    const missingTransactionId = await apiRequest(request, 'POST', '/api/payment_gateways/capture', {
      token,
      data: { amount: 10 },
    })
    expect(missingTransactionId.status(), 'capture requires transactionId').toBe(422)
    const missingTransactionIdBody = await readJsonSafe<ValidationError>(missingTransactionId)
    expect(missingTransactionIdBody?.details?.fieldErrors?.transactionId, 'transactionId field error present').toBeTruthy()

    const malformedTransactionId = await apiRequest(request, 'POST', '/api/payment_gateways/capture', {
      token,
      data: { transactionId: 'not-a-uuid', amount: 10 },
    })
    expect(malformedTransactionId.status(), 'capture transactionId must be a UUID').toBe(422)

    const refundNegative = await apiRequest(request, 'POST', '/api/payment_gateways/refund', {
      token,
      data: { transactionId: validId, amount: -5 },
    })
    expect(refundNegative.status(), 'refund amount must be positive').toBe(422)

    const refundLongReason = await apiRequest(request, 'POST', '/api/payment_gateways/refund', {
      token,
      data: { transactionId: validId, amount: 5, reason: 'x'.repeat(201) },
    })
    expect(refundLongReason.status(), 'refund reason must be 200 chars or fewer').toBe(422)
  })

  test('rejects invalid session payloads with 422', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const negativeAmount = await apiRequest(request, 'POST', '/api/payment_gateways/sessions', {
      token,
      data: { providerKey: 'mock', amount: -1, currencyCode: 'USD' },
    })
    expect(negativeAmount.status(), 'session amount must be positive').toBe(422)

    const shortCurrency = await apiRequest(request, 'POST', '/api/payment_gateways/sessions', {
      token,
      data: { providerKey: 'mock', amount: 10, currencyCode: 'US' },
    })
    expect(shortCurrency.status(), 'currencyCode must be 3 characters').toBe(422)

    const longCurrency = await apiRequest(request, 'POST', '/api/payment_gateways/sessions', {
      token,
      data: { providerKey: 'mock', amount: 10, currencyCode: 'USDA' },
    })
    expect(longCurrency.status(), 'currencyCode must be 3 characters').toBe(422)

    const missingProvider = await apiRequest(request, 'POST', '/api/payment_gateways/sessions', {
      token,
      data: { amount: 10, currencyCode: 'USD' },
    })
    expect(missingProvider.status(), 'session requires providerKey').toBe(422)

    const emptyProvider = await apiRequest(request, 'POST', '/api/payment_gateways/sessions', {
      token,
      data: { providerKey: '', amount: 10, currencyCode: 'USD' },
    })
    expect(emptyProvider.status(), 'providerKey must be non-empty').toBe(422)
  })

  test('accepts valid session and capture payloads', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 30.0,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })
    expect(session.status, 'a valid session payload authorizes').toBe('authorized')

    const capture = await apiRequest(request, 'POST', '/api/payment_gateways/capture', {
      token,
      data: { transactionId: session.transactionId, amount: 30.0 },
    })
    expect(capture.status(), 'a valid capture payload succeeds').toBe(200)
  })
})
