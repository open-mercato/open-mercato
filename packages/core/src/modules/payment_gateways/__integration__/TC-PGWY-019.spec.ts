import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { createPaymentSession } from './helpers/fixtures'

/**
 * TC-PGWY-019: Required and well-formed transactionId on GET /status
 *
 * The status route guards its single query parameter:
 *   - missing transactionId            → 400 'transactionId is required'
 *   - empty transactionId              → 400 'transactionId is required'
 *   - malformed (non-UUID) transactionId → 400 (validated as a UUID before any DB lookup)
 *   - well-formed but unknown id        → 404 'Transaction not found'
 *   - well-formed and existing id       → 200 with the transaction status
 *
 * The malformed-UUID case is the regression guard for a hardening fix: previously the raw
 * string reached a Postgres `uuid` comparison and surfaced as an unhandled 500. It is now
 * validated up front and returns a clean 400.
 */
test.describe('TC-PGWY-019: Status transactionId validation', () => {
  test('requires a well-formed transactionId before lookup', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const missing = await apiRequest(request, 'GET', '/api/payment_gateways/status', { token })
    expect(missing.status(), 'missing transactionId is rejected').toBe(400)
    const missingBody = await readJsonSafe<{ error?: string }>(missing)
    expect(missingBody?.error, 'reports transactionId is required').toBe('transactionId is required')

    const empty = await apiRequest(request, 'GET', '/api/payment_gateways/status?transactionId=', { token })
    expect(empty.status(), 'empty transactionId is rejected').toBe(400)

    const malformed = await apiRequest(request, 'GET', '/api/payment_gateways/status?transactionId=not-a-uuid', { token })
    expect(malformed.status(), 'malformed transactionId is rejected before DB lookup').toBe(400)

    const unknown = await apiRequest(request, 'GET', `/api/payment_gateways/status?transactionId=${randomUUID()}`, { token })
    expect(unknown.status(), 'well-formed but unknown transactionId is not found').toBe(404)
  })

  test('returns the status for an existing transactionId', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 18.25,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })

    const status = await apiRequest(request, 'GET', `/api/payment_gateways/status?transactionId=${session.transactionId}`, { token })
    expect(status.status(), 'existing transactionId resolves').toBe(200)
    const statusBody = await readJsonSafe<{ transactionId?: string; status?: string }>(status)
    expect(statusBody?.transactionId, 'status echoes the transaction id').toBe(session.transactionId)
    expect(statusBody?.status, 'status carries a unified status').toBe('authorized')
  })
})
