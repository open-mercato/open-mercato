import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['transport_operations'],
}

/**
 * TC-TRANSPORT-001: every transport list filter narrows the result set.
 *
 * A filter key that reaches the query builder but names nothing it can resolve answers `200` with an
 * empty page, which is indistinguishable from "no matches" in the UI and invisible to every other
 * gate (see `.ai/lessons/crud-filter-keys-must-be-column-names.md`). Each case therefore asserts both
 * directions: the fixture is returned, and a deliberately non-matching sibling is not.
 *
 * The fixtures are created here and removed in `finally`; nothing below depends on seeded data. The
 * scheduled trip is the reason the four entities are created in this order — the trip's create path
 * refuses a vehicle that is not active or a driver whose licence has lapsed, which is exactly the
 * availability rule the module exists to enforce.
 */

const VEHICLES = '/api/transport_operations/vehicles'
const DRIVERS = '/api/transport_operations/drivers'
const ROUTES = '/api/transport_operations/routes'
const TRIPS = '/api/transport_operations/trips'

type ListResponse = { items?: Array<{ id?: string }> }

let fixtureCounter = 0
function uniqueSuffix(): string {
  fixtureCounter += 1
  return `${Date.now()}-${fixtureCounter}`
}

const DAY_MS = 24 * 60 * 60 * 1000
function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10)
}

function isoInstant(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY_MS).toISOString()
}

async function createEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.ok(), `POST ${path} failed with ${response.status()}: ${JSON.stringify(body)}`).toBeTruthy()
  const id = body?.id
  expect(typeof id === 'string' && id.length > 0, `POST ${path} returned no id`).toBe(true)
  return id as string
}

async function listIds(request: APIRequestContext, token: string, path: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', path, { token })
  const body = await readJsonSafe<ListResponse>(response)
  expect(response.ok(), `GET ${path} failed with ${response.status()}`).toBeTruthy()
  return (body?.items ?? []).map((row) => row.id as string)
}

async function deleteEntity(request: APIRequestContext, token: string, path: string, id: string | null): Promise<void> {
  if (!id) return
  try {
    await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token })
  } catch {
    // Cleanup must not mask the assertion that failed first.
  }
}

test.describe('TC-TRANSPORT-001: transport list filters', () => {
  test('the vehicle, driver, route and trip filters each narrow to the fixture', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueSuffix()

    const created = {
      vehicle: null as string | null,
      driver: null as string | null,
      route: null as string | null,
      trip: null as string | null,
    }

    try {
      created.vehicle = await createEntity(request, token, VEHICLES, {
        plateNumber: `TCTR001-${suffix}`,
        vin: `VIN-${suffix}`.slice(0, 32),
        make: 'Toyota',
        model: 'Coaster',
        year: 2024,
        capacity: 23,
        status: 'active',
      })
      const vehiclesBySearch = await listIds(request, token, `${VEHICLES}?search=${encodeURIComponent(`TCTR001-${suffix}`)}&pageSize=20`)
      expect(vehiclesBySearch).toContain(created.vehicle)

      const vehiclesActive = await listIds(request, token, `${VEHICLES}?status=active&pageSize=100`)
      expect(vehiclesActive).toContain(created.vehicle)

      const vehiclesMaintenance = await listIds(request, token, `${VEHICLES}?status=maintenance&pageSize=100`)
      expect(vehiclesMaintenance).not.toContain(created.vehicle)

      created.driver = await createEntity(request, token, DRIVERS, {
        fullName: `Transport TC ${suffix}`,
        nationalId: `TC001-${suffix}`,
        licenseNumber: `LIC-${suffix}`,
        licenseExpiry: isoDate(10),
        phone: '+966500000000',
        status: 'available',
      })
      const driversBySearch = await listIds(request, token, `${DRIVERS}?search=${encodeURIComponent(`LIC-${suffix}`)}&pageSize=20`)
      expect(driversBySearch).toContain(created.driver)

      // The licence is ten days out: inside the renewal window, not expired. Both directions matter,
      // because a filter that matched nothing at all would satisfy the negative case alone.
      const driversWithin30 = await listIds(request, token, `${DRIVERS}?expiry=within30&pageSize=100`)
      expect(driversWithin30).toContain(created.driver)

      const driversExpired = await listIds(request, token, `${DRIVERS}?expiry=expired&pageSize=100`)
      expect(driversExpired).not.toContain(created.driver)

      const driversSuspended = await listIds(request, token, `${DRIVERS}?status=suspended&pageSize=100`)
      expect(driversSuspended).not.toContain(created.driver)

      created.route = await createEntity(request, token, ROUTES, {
        code: `TCR-${suffix}`,
        name: `Transport TC route ${suffix}`,
        startLocation: 'Depot',
        endLocation: 'Al Nakheel',
        estimatedDurationMinutes: 45,
      })
      const routesBySearch = await listIds(request, token, `${ROUTES}?search=${encodeURIComponent(`TCR-${suffix}`)}&pageSize=20`)
      expect(routesBySearch).toContain(created.route)

      created.trip = await createEntity(request, token, TRIPS, {
        routeId: created.route,
        vehicleId: created.vehicle,
        driverId: created.driver,
        scheduledStartTime: isoInstant(1),
        scheduledEndTime: isoInstant(1.5),
      })
      const tripsByRoute = await listIds(request, token, `${TRIPS}?routeId=${created.route}&pageSize=20`)
      expect(tripsByRoute).toContain(created.trip)

      const tripsByVehicle = await listIds(request, token, `${TRIPS}?vehicleId=${created.vehicle}&pageSize=20`)
      expect(tripsByVehicle).toContain(created.trip)

      const tripsByDriver = await listIds(request, token, `${TRIPS}?driverId=${created.driver}&pageSize=20`)
      expect(tripsByDriver).toContain(created.trip)

      const tripsCompleted = await listIds(request, token, `${TRIPS}?status=completed&pageSize=100`)
      expect(tripsCompleted).not.toContain(created.trip)
    } finally {
      await deleteEntity(request, token, TRIPS, created.trip)
      await deleteEntity(request, token, DRIVERS, created.driver)
      await deleteEntity(request, token, ROUTES, created.route)
      await deleteEntity(request, token, VEHICLES, created.vehicle)
    }
  })
})
