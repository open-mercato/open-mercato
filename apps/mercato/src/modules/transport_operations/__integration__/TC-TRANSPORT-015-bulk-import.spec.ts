import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['transport_operations'],
}

const DRIVERS = '/api/transport_operations/drivers'
const VEHICLES = '/api/transport_operations/vehicles'
const DRIVER_IMPORT = `${DRIVERS}/import`
const VEHICLE_IMPORT = `${VEHICLES}/import`

let fixtureCounter = 0
function uniqueSuffix(): string {
  fixtureCounter += 1
  return `${Date.now()}-${fixtureCounter}`
}
function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

type ImportResponse = {
  mode: string
  summary: { total: number; valid?: number; invalid: number; created?: number; failed?: number }
  rows: Array<{ rowNumber: number; status: string; errors: string[] }>
}

type ListResponse = { items?: Array<{ id: string }> }

async function deleteEntity(request: APIRequestContext, token: string, path: string, id: string): Promise<void> {
  try {
    await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token })
  } catch {
    // best-effort cleanup
  }
}

/**
 * TC-TRANSPORT-015: drivers and vehicles can be bulk imported with the same
 * dry-run → commit contract as the freight order importer. The preview must
 * report exactly the rows the commit creates, invalid rows must be skipped
 * without aborting the batch, and every created row must be visible in the
 * module's own list API.
 */
test.describe('TC-TRANSPORT-015: bulk driver and vehicle import', () => {
  test('dry-run reports valid rows and commit creates only those rows', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueSuffix()
    const created: { drivers: string[]; vehicles: string[] } = { drivers: [], vehicles: [] }

    try {
      const driverRows = [
        {
          rowNumber: 2,
          payload: {
            fullName: `Import driver ${suffix}`,
            nationalId: `NID-${suffix}`,
            licenseNumber: `LIC-${suffix}`,
            licenseExpiry: isoDate(90),
            phone: '+966500000010',
            status: 'available',
          },
        },
        {
          rowNumber: 3,
          payload: {
            fullName: `Incomplete driver ${suffix}`,
            nationalId: `NID2-${suffix}`,
            licenseNumber: `LIC2-${suffix}`,
            licenseExpiry: isoDate(90),
          },
        },
      ]

      const driverDryRunResponse = await apiRequest(request, 'POST', DRIVER_IMPORT, {
        token,
        data: { mode: 'dry-run', rows: driverRows },
        retryTransport: false,
      })
      const driverDryRun = await readJsonSafe<ImportResponse>(driverDryRunResponse)
      expect(driverDryRunResponse.ok(), JSON.stringify(driverDryRun)).toBeTruthy()
      expect(driverDryRun?.summary).toMatchObject({ total: 2, valid: 1, invalid: 1 })
      expect(driverDryRun?.rows.find((row) => row.rowNumber === 3)?.status).toBe('invalid')

      const driverCommitResponse = await apiRequest(request, 'POST', DRIVER_IMPORT, {
        token,
        data: { mode: 'commit', rows: driverRows },
        retryTransport: false,
      })
      const driverCommit = await readJsonSafe<ImportResponse>(driverCommitResponse)
      expect(driverCommitResponse.ok(), JSON.stringify(driverCommit)).toBeTruthy()
      expect(driverCommit?.summary).toMatchObject({ total: 2, created: 1, invalid: 1, failed: 0 })

      const driverListResponse = await apiRequest(
        request,
        'GET',
        `${DRIVERS}?search=${encodeURIComponent(`Import driver ${suffix}`)}&pageSize=100`,
        { token },
      )
      const driverList = await readJsonSafe<ListResponse>(driverListResponse)
      expect(driverListResponse.ok()).toBeTruthy()
      const driverItems = driverList?.items ?? []
      expect(driverItems).toHaveLength(1)
      created.drivers.push(...driverItems.map((row) => row.id))

      const vehicleRows = [
        {
          rowNumber: 2,
          payload: {
            plateNumber: `TC15-${suffix}`.slice(0, 20),
            make: 'Toyota',
            model: 'Hiace',
            year: '2024',
            capacity: '14',
            status: 'active',
          },
        },
        {
          rowNumber: 3,
          payload: {
            plateNumber: `TC15B-${suffix}`.slice(0, 20),
            make: 'Ford',
            model: 'Transit',
            year: 'not-a-year',
          },
        },
      ]

      const vehicleDryRunResponse = await apiRequest(request, 'POST', VEHICLE_IMPORT, {
        token,
        data: { mode: 'dry-run', rows: vehicleRows },
        retryTransport: false,
      })
      const vehicleDryRun = await readJsonSafe<ImportResponse>(vehicleDryRunResponse)
      expect(vehicleDryRunResponse.ok(), JSON.stringify(vehicleDryRun)).toBeTruthy()
      expect(vehicleDryRun?.summary).toMatchObject({ total: 2, valid: 1, invalid: 1 })
      expect(vehicleDryRun?.rows.find((row) => row.rowNumber === 3)?.status).toBe('invalid')

      const vehicleCommitResponse = await apiRequest(request, 'POST', VEHICLE_IMPORT, {
        token,
        data: { mode: 'commit', rows: vehicleRows },
        retryTransport: false,
      })
      const vehicleCommit = await readJsonSafe<ImportResponse>(vehicleCommitResponse)
      expect(vehicleCommitResponse.ok(), JSON.stringify(vehicleCommit)).toBeTruthy()
      expect(vehicleCommit?.summary).toMatchObject({ total: 2, created: 1, invalid: 1, failed: 0 })

      const vehicleListResponse = await apiRequest(
        request,
        'GET',
        `${VEHICLES}?search=${encodeURIComponent(`TC15-${suffix}`.slice(0, 20))}&pageSize=100`,
        { token },
      )
      const vehicleList = await readJsonSafe<ListResponse>(vehicleListResponse)
      expect(vehicleListResponse.ok()).toBeTruthy()
      const vehicleItems = vehicleList?.items ?? []
      expect(vehicleItems).toHaveLength(1)
      created.vehicles.push(...vehicleItems.map((row) => row.id))
    } finally {
      for (const id of created.drivers) await deleteEntity(request, token, DRIVERS, id)
      for (const id of created.vehicles) await deleteEntity(request, token, VEHICLES, id)
    }
  })
})
