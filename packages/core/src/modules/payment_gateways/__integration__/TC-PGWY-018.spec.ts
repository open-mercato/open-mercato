import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

/**
 * TC-PGWY-018: Non-existent resource lookups return 404
 *
 * Well-formed but non-existent identifiers must produce clean not-found responses, never
 * leak another scope's data and never crash:
 *   - GET /transactions/[uuid] for an unknown id     → 404 'Transaction not found'
 *   - GET /status?transactionId=[uuid] for unknown id → 404 'Transaction not found'
 *   - GET /providers/[key] for an unknown provider    → 404 'Provider descriptor not found'
 *   - GET /providers/[blank] (whitespace-only key)    → 400 'Provider key is required'
 */
test.describe('TC-PGWY-018: Non-existent resource lookups', () => {
  test('returns 404 for unknown transaction and provider identifiers', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const unknownTransactionId = randomUUID()

    const detail = await apiRequest(request, 'GET', `/api/payment_gateways/transactions/${unknownTransactionId}`, { token })
    expect(detail.status(), 'unknown transaction detail is not found').toBe(404)
    const detailBody = await readJsonSafe<{ error?: string }>(detail)
    expect(detailBody?.error, 'detail reports transaction not found').toMatch(/not found/i)

    const status = await apiRequest(request, 'GET', `/api/payment_gateways/status?transactionId=${unknownTransactionId}`, { token })
    expect(status.status(), 'unknown transaction status is not found').toBe(404)
    const statusBody = await readJsonSafe<{ error?: string }>(status)
    expect(statusBody?.error, 'status reports transaction not found').toMatch(/not found/i)

    const provider = await apiRequest(request, 'GET', '/api/payment_gateways/providers/definitely-not-a-real-provider', { token })
    expect(provider.status(), 'unknown provider descriptor is not found').toBe(404)
    const providerBody = await readJsonSafe<{ error?: string }>(provider)
    expect(providerBody?.error, 'provider reports descriptor not found').toMatch(/not found/i)

    const blankProvider = await apiRequest(request, 'GET', '/api/payment_gateways/providers/%20', { token })
    expect(blankProvider.status(), 'blank provider key is rejected').toBe(400)
  })
})
