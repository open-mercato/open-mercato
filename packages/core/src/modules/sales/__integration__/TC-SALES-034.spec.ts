import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-SALES-034: Tax-rate CRUD operations and rate validation via API.
 *
 * Issue #2459 scenario "TC-SALES-033 — Tax Rate CRUD Operations" (P1).
 * Renumbered to 034: TC-SALES-030 is already taken (read-model totals, #2455/#2457).
 *
 * Tax rates are a configuration entity at `/api/sales/tax-rates`, gated by
 * `sales.settings.manage`. Create returns `{ id }` and update/delete return
 * `{ ok: true }`, so persisted values are read back via GET. `rate` is a percentage
 * magnitude bounded 0..100 by the validator — out-of-range values are rejected 400.
 * `code` must match `^[a-z0-9\-_]+$`; a Date.now() stamp keeps each run's code unique
 * so the run is idempotent across retries.
 */

type JsonRecord = Record<string, unknown>

async function readJson(response: APIResponse): Promise<JsonRecord> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as JsonRecord
  } catch {
    return {}
  }
}

function listItems(body: JsonRecord): JsonRecord[] {
  return Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
}

function num(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim().length) return Number(value)
  return Number.NaN
}

test.describe('TC-SALES-034 tax-rate CRUD + validation', () => {
  test('creates, reads, updates, and deletes a tax rate', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const code = `qa-tax-${stamp}`
    let taxRateId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', '/api/sales/tax-rates', {
        token,
        data: { name: `QA Tax ${stamp}`, code, rate: 7.5 },
      })
      expect(createResponse.status(), 'POST /api/sales/tax-rates should be 201').toBe(201)
      taxRateId = (await readJson(createResponse)).id as string
      expect(taxRateId, 'create response should carry id').toBeTruthy()

      // The tax-rates list does not narrow by `?id=`, so resolve the created row by id.
      const created = listItems(
        await readJson(await apiRequest(request, 'GET', '/api/sales/tax-rates?pageSize=100', { token })),
      ).find((row) => row.id === taxRateId) ?? {}
      expect(created.name).toBe(`QA Tax ${stamp}`)
      expect(created.code).toBe(code)
      expect(num(created.rate)).toBe(7.5)

      const updateResponse = await apiRequest(request, 'PUT', '/api/sales/tax-rates', {
        token,
        data: { id: taxRateId, rate: 8 },
      })
      expect(updateResponse.status(), 'PUT /api/sales/tax-rates should be 200').toBe(200)
      const updated = listItems(
        await readJson(await apiRequest(request, 'GET', '/api/sales/tax-rates?pageSize=100', { token })),
      ).find((row) => row.id === taxRateId) ?? {}
      expect(num(updated.rate)).toBe(8)

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/sales/tax-rates?id=${encodeURIComponent(taxRateId)}`,
        { token },
      )
      expect(deleteResponse.status(), 'DELETE /api/sales/tax-rates should be 200').toBe(200)
      const afterDelete = listItems(
        await readJson(await apiRequest(request, 'GET', '/api/sales/tax-rates?pageSize=100', { token })),
      )
      expect(afterDelete.some((row) => row.id === taxRateId)).toBeFalsy()
      taxRateId = null
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/tax-rates', taxRateId)
    }
  })

  test('rejects an out-of-range tax rate', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()

    const tooHigh = await apiRequest(request, 'POST', '/api/sales/tax-rates', {
      token,
      data: { name: `QA Tax high ${stamp}`, code: `qa-tax-high-${stamp}`, rate: 150 },
    })
    expect(tooHigh.status(), 'rate above 100 should be rejected with 400').toBe(400)

    const negative = await apiRequest(request, 'POST', '/api/sales/tax-rates', {
      token,
      data: { name: `QA Tax neg ${stamp}`, code: `qa-tax-neg-${stamp}`, rate: -5 },
    })
    expect(negative.status(), 'negative rate should be rejected with 400').toBe(400)
  })
})
