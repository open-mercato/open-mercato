import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { createPaymentSession } from './helpers/fixtures'

/**
 * TC-PGWY-015: Query parameter validation on GET /transactions
 *
 * `listTransactionsQuerySchema` validates page/pageSize/status before any DB query.
 * Invalid query parameters are rejected with 400 `{ error: 'Invalid query', details }`
 * where `details` is the flattened zod error. Valid filters return a 200 paged result.
 */
type ListResponse = {
  items: Array<{ id: string; providerKey: string; unifiedStatus: string }>
  total: number
  page: number
  pageSize: number
  totalPages: number
}

type ValidationError = {
  error: string
  details?: { fieldErrors?: Record<string, string[]> }
}

test.describe('TC-PGWY-015: Transactions list query validation', () => {
  test('rejects invalid page/pageSize/status with 400', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const pageZero = await apiRequest(request, 'GET', '/api/payment_gateways/transactions?page=0', { token })
    expect(pageZero.status(), 'page=0 is below the minimum').toBe(400)
    const pageZeroBody = await readJsonSafe<ValidationError>(pageZero)
    expect(pageZeroBody?.details?.fieldErrors?.page, 'page field error present').toBeTruthy()

    const pageNonNumeric = await apiRequest(request, 'GET', '/api/payment_gateways/transactions?page=abc', { token })
    expect(pageNonNumeric.status(), 'page=abc is non-numeric').toBe(400)

    const pageSizeZero = await apiRequest(request, 'GET', '/api/payment_gateways/transactions?pageSize=0', { token })
    expect(pageSizeZero.status(), 'pageSize=0 is below the minimum').toBe(400)

    const pageSizeTooLarge = await apiRequest(request, 'GET', '/api/payment_gateways/transactions?pageSize=101', { token })
    expect(pageSizeTooLarge.status(), 'pageSize=101 exceeds the maximum of 100').toBe(400)

    const invalidStatus = await apiRequest(request, 'GET', '/api/payment_gateways/transactions?status=invalid_status', { token })
    expect(invalidStatus.status(), 'status must be a known unified status').toBe(400)
    const invalidStatusBody = await readJsonSafe<ValidationError>(invalidStatus)
    expect(invalidStatusBody?.details?.fieldErrors?.status, 'status field error present').toBeTruthy()
  })

  test('accepts valid pagination and provider filters with 200', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 21.5,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })

    const paged = await apiRequest(request, 'GET', '/api/payment_gateways/transactions?page=1&pageSize=20&status=authorized', { token })
    expect(paged.status(), 'valid page/pageSize/status query is accepted').toBe(200)
    const pagedBody = await readJsonSafe<ListResponse>(paged)
    expect(Array.isArray(pagedBody?.items), 'response carries an items array').toBe(true)
    expect(pagedBody?.page, 'echoes requested page').toBe(1)
    expect(pagedBody?.pageSize, 'echoes requested pageSize').toBe(20)
    expect((pagedBody?.items.length ?? 0), 'authorized filter returns at least the created row').toBeGreaterThan(0)
    for (const item of pagedBody?.items ?? []) {
      expect(item.unifiedStatus, 'status filter returns only authorized rows').toBe('authorized')
    }

    const filtered = await apiRequest(request, 'GET', '/api/payment_gateways/transactions?providerKey=mock', { token })
    expect(filtered.status(), 'valid providerKey filter is accepted').toBe(200)
    const filteredBody = await readJsonSafe<ListResponse>(filtered)
    expect((filteredBody?.items.length ?? 0), 'provider filter returns at least the created row').toBeGreaterThan(0)
    for (const item of filteredBody?.items ?? []) {
      expect(item.providerKey, 'provider filter returns only mock rows').toBe('mock')
    }
  })
})
