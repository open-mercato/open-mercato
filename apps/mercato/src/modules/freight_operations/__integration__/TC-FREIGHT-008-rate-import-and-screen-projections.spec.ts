import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  activateFreightContractFixture,
  createFreightContractFixture,
  deleteFreightEntityIfExists,
  uniqueFreightSuffix,
} from '@open-mercato/core/helpers/integration/freightFixtures'

export const integrationMeta = {
  dependsOnModules: ['freight_operations', 'customers'],
}

const CONTRACTS = '/api/freight_operations/contracts'
const CONTRACT_ROUTES = '/api/freight_operations/contract-routes'
const IMPORT = '/api/freight_operations/contract-routes/import'

type ImportResponse = {
  mode?: string
  summary?: { total: number; valid?: number; invalid: number; created?: number; failed?: number }
  rows?: Array<{ rowNumber: number; status: string; errors: string[] }>
}

/**
 * TC-FREIGHT-008: the bulk rate importer and the additive projections the staff
 * screens read.
 *
 * The dry run is the contract: it reports every invalid row without writing
 * anything, a clean run commits exactly the valid rows, and the same file
 * imported twice cannot take the same line number twice.
 */
test.describe('TC-FREIGHT-008: rate import dry run, commit, and screen projections', () => {
  test('validates before writing, then commits only the valid rows', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueFreightSuffix()
    const company = await createCompanyFixture(request, token, `Import TC ${suffix}`)
    const snapshot = { id: company, kind: 'company' as const, displayName: `Import TC ${suffix}` }

    let contractId: string | null = null
    try {
      contractId = (await createFreightContractFixture(request, token, {
        customerId: company,
        customerSnapshot: snapshot,
        title: `Import TC ${suffix}`,
      })).id

      // A draft contract accepts rates; the projection must carry the notes the
      // edit form prefills.
      const withNotes = await apiRequest(request, 'PUT', CONTRACTS, {
        token,
        data: { id: contractId, notes: 'Imported lane sheet signed by operations.' },
        retryTransport: false,
      })
      expect(withNotes.ok()).toBeTruthy()
      const contractRow = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(
        await apiRequest(request, 'GET', `${CONTRACTS}?ids=${contractId}&pageSize=1`, { token }),
      )
      expect(contractRow?.items?.[0]?.notes).toBe('Imported lane sheet signed by operations.')

      // A dry run with one bad row: nothing is written, and the row is named.
      const dryRun = await apiRequest(request, 'POST', IMPORT, {
        token,
        data: {
          contractId,
          mode: 'dry-run',
          rows: [
            { rowNumber: 2, payload: { origin: 'Riyadh', destination: 'Dammam', rateAmount: '450', equipmentType: 'Flatbed', driverIncentiveType: 'per_trip', driverIncentiveValue: '35' } },
            { rowNumber: 3, payload: { origin: 'Riyadh', destination: '', rateAmount: 'not-a-number' } },
          ],
        },
        retryTransport: false,
      })
      const dryBody = await readJsonSafe<ImportResponse>(dryRun)
      expect(dryRun.ok(), JSON.stringify(dryBody)).toBeTruthy()
      expect(dryBody?.summary?.valid).toBe(1)
      expect(dryBody?.summary?.invalid).toBe(1)
      expect(dryBody?.rows?.find((row) => row.rowNumber === 3)?.errors.length).toBeGreaterThan(0)

      const afterDryRun = await apiRequest(request, 'GET', `${CONTRACT_ROUTES}?contractId=${contractId}&pageSize=50`, { token })
      const afterDryRunBody = await readJsonSafe<{ items?: unknown[] }>(afterDryRun)
      expect(afterDryRunBody?.items?.length ?? 0).toBe(0)

      // The commit writes the valid row and carries the new columns through.
      const commit = await apiRequest(request, 'POST', IMPORT, {
        token,
        data: {
          contractId,
          mode: 'commit',
          rows: [
            { rowNumber: 2, payload: { origin: 'Riyadh', destination: 'Dammam', rateAmount: '450', equipmentType: 'Flatbed', driverIncentiveType: 'per_trip', driverIncentiveValue: '35' } },
            { rowNumber: 3, payload: { origin: 'Riyadh', destination: '', rateAmount: 'not-a-number' } },
          ],
        },
        retryTransport: false,
      })
      const commitBody = await readJsonSafe<ImportResponse>(commit)
      expect(commit.ok(), JSON.stringify(commitBody)).toBeTruthy()
      expect(commitBody?.summary?.created).toBe(1)

      const rows = await apiRequest(request, 'GET', `${CONTRACT_ROUTES}?contractId=${contractId}&pageSize=50`, { token })
      const rowsBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(rows)
      expect(rowsBody?.items?.length).toBe(1)
      expect(rowsBody?.items?.[0]?.origin).toBe('Riyadh')
      expect(rowsBody?.items?.[0]?.equipment_type).toBe('Flatbed')
      expect(rowsBody?.items?.[0]?.driver_incentive_type).toBe('per_trip')
      expect(Number(rowsBody?.items?.[0]?.driver_incentive_value)).toBe(35)
      expect(rowsBody?.items?.[0]?.updatedAt).toBeTruthy()

      // Activating now succeeds: there is an active rate line.
      await activateFreightContractFixture(request, token, contractId)

      // Importing the same line number again is refused per row, not silently
      // duplicated: the preview the operator approved is what was written.
      const repeatedLine = await apiRequest(request, 'POST', IMPORT, {
        token,
        data: {
          contractId,
          mode: 'commit',
          rows: [{ rowNumber: 2, payload: { origin: 'Jeddah', destination: 'Mecca', rateAmount: '300', lineNumber: 1 } }],
        },
        retryTransport: false,
      })
      const repeatedBody = await readJsonSafe<ImportResponse>(repeatedLine)
      expect(repeatedBody?.summary?.created).toBe(0)
      expect(repeatedBody?.rows?.[0]?.status).toBe('invalid')
    } finally {
      if (contractId) {
        const rows = await readJsonSafe<{ items?: Array<{ id: string }> }>(
          await apiRequest(request, 'GET', `${CONTRACT_ROUTES}?contractId=${contractId}&pageSize=100`, { token }),
        )
        for (const row of rows?.items ?? []) {
          await deleteFreightEntityIfExists(request, token, CONTRACT_ROUTES, row.id)
        }
        await deleteFreightEntityIfExists(request, token, CONTRACTS, contractId)
      }
      await deleteFreightEntityIfExists(request, token, '/api/customers/companies', company)
    }
  })
})
