import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  deleteFreightEntityIfExists,
  uniqueFreightSuffix,
} from '@open-mercato/core/helpers/integration/freightFixtures'

export const integrationMeta = {
  dependsOnModules: ['freight_operations', 'customers'],
}

const IMPORT = '/api/freight_operations/orders/import'
const ORDERS = '/api/freight_operations/orders'
const COMPANIES = '/api/customers/companies'

type ImportResponse = {
  mode: string
  summary: { total: number; valid?: number; invalid: number; created?: number; failed?: number }
  rows: Array<{ rowNumber: number; status: string; errors: string[] }>
}

/**
 * TC-FREIGHT-011: a bulk order sheet is validated before anything is written,
 * and the commit creates exactly the rows the preview called valid.
 */
test.describe('TC-FREIGHT-011: bulk order import', () => {
  test('dry-run validates every row; commit creates the valid rows only', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueFreightSuffix()
    const company = await createCompanyFixture(request, token, `Order import TC ${suffix}`)
    const snapshot = { id: company, kind: 'company' as const, displayName: `Order import TC ${suffix}` }
    const createdOrderIds: string[] = []

    try {
      const rows = [
        {
          rowNumber: 2,
          payload: {
            cargoDescription: `Steel ${suffix}`,
            pickupLocation: 'Riyadh',
            dropoffLocation: 'Dammam',
            requestedPickupAt: '2026-12-01T12:00:00.000Z',
            agreedAmountNet: '2500',
            truckTypeRequired: 'flatbed',
          },
        },
        {
          rowNumber: 3,
          payload: {
            cargoDescription: `Bad amount ${suffix}`,
            pickupLocation: 'Riyadh',
            dropoffLocation: 'Jeddah',
            agreedAmountNet: 'not-a-number',
          },
        },
        {
          rowNumber: 4,
          payload: {
            cargoDescription: `Pallets ${suffix}`,
            pickupLocation: 'Dammam',
            dropoffLocation: 'Riyadh',
            requestedPickupAt: '2026-12-02T12:00:00.000Z',
            cargoQuantity: '12',
            cargoUnit: 'pallet',
            agreedAmountNet: '1800',
          },
        },
      ]

      const dryRunResponse = await apiRequest(request, 'POST', IMPORT, {
        token,
        data: {
          customerId: company,
          customerSnapshot: snapshot,
          mode: 'dry-run',
          rows,
        },
        retryTransport: false,
      })
      const dryRun = await readJsonSafe<ImportResponse>(dryRunResponse)
      expect(dryRunResponse.ok(), JSON.stringify(dryRun)).toBeTruthy()
      expect(dryRun?.mode).toBe('dry-run')
      expect(dryRun?.summary).toMatchObject({ total: 3, valid: 2, invalid: 1 })
      expect(dryRun?.rows.find((row) => row.rowNumber === 3)?.status).toBe('invalid')

      const commitResponse = await apiRequest(request, 'POST', IMPORT, {
        token,
        data: {
          customerId: company,
          customerSnapshot: snapshot,
          mode: 'commit',
          rows,
        },
        retryTransport: false,
      })
      const commit = await readJsonSafe<ImportResponse>(commitResponse)
      expect(commitResponse.ok(), JSON.stringify(commit)).toBeTruthy()
      expect(commit?.mode).toBe('commit')
      expect(commit?.summary).toMatchObject({ total: 3, created: 2, invalid: 1, failed: 0 })

      const listResponse = await apiRequest(
        request,
        'GET',
        `${ORDERS}?customerId=${encodeURIComponent(company)}&pageSize=100`,
        { token },
      )
      const list = await readJsonSafe<{ items?: Array<{ id: string; cargo_description: string }> }>(listResponse)
      expect(listResponse.ok()).toBeTruthy()
      const items = list?.items ?? []
      expect(items).toHaveLength(2)
      expect(items.map((row) => row.cargo_description).sort()).toEqual(
        [`Pallets ${suffix}`, `Steel ${suffix}`].sort(),
      )
      createdOrderIds.push(...items.map((row) => row.id))
    } finally {
      for (const id of createdOrderIds) {
        await deleteFreightEntityIfExists(request, token, ORDERS, id)
      }
      await deleteFreightEntityIfExists(request, token, COMPANIES, company)
    }
  })
})
