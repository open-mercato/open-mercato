import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['transport_operations'],
}

/**
 * TC-TRANSPORT-002: a trip can be cancelled from both reachable states.
 *
 * The cancel action exists because `cancelled` was a stored status nothing could
 * set. A scheduled trip cancels outright; an in-progress trip additionally frees
 * its driver, which is the operational reason the action matters — forgetting it
 * leaves the driver stuck `on_trip` and every later dispatch refuses them.
 */
const VEHICLES = '/api/transport_operations/vehicles'
const DRIVERS = '/api/transport_operations/drivers'
const ROUTES = '/api/transport_operations/routes'
const TRIPS = '/api/transport_operations/trips'

const DAY_MS = 24 * 60 * 60 * 1000
let fixtureCounter = 0
function uniqueSuffix(): string {
  fixtureCounter += 1
  return `${Date.now()}-${fixtureCounter}`
}
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
  expect(typeof body?.id).toBe('string')
  return body!.id as string
}

async function deleteEntity(request: APIRequestContext, token: string, path: string, id: string | null): Promise<void> {
  if (!id) return
  try {
    await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token })
  } catch {
    // best-effort cleanup
  }
}

async function getTrip(request: APIRequestContext, token: string, id: string): Promise<Record<string, unknown>> {
  const response = await apiRequest(request, 'GET', `${TRIPS}?id=${encodeURIComponent(id)}`, { token })
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  expect(response.ok()).toBeTruthy()
  return (body?.items ?? [])[0] ?? {}
}

test.describe('TC-TRANSPORT-002: trip cancellation', () => {
  test('cancels a scheduled trip and releases a dispatched driver', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueSuffix()
    const created: Record<string, string | null> = {
      vehicle: null,
      driver: null,
      route: null,
      scheduledTrip: null,
      runningTrip: null,
    }

    try {
      created.vehicle = await createEntity(request, token, VEHICLES, {
        plateNumber: `TCTR002-${suffix}`.slice(0, 20),
        vin: `VIN2-${suffix}`.slice(0, 32),
        make: 'Mercedes',
        model: 'Sprinter',
        year: 2023,
        capacity: 14,
        status: 'active',
      })
      created.driver = await createEntity(request, token, DRIVERS, {
        fullName: `Cancel TC ${suffix}`,
        nationalId: `TC002-${suffix}`,
        licenseNumber: `LIC2-${suffix}`,
        licenseExpiry: isoDate(30),
        phone: '+966500000001',
        status: 'available',
      })
      created.route = await createEntity(request, token, ROUTES, {
        code: `TCR2-${suffix}`,
        name: `Cancel route ${suffix}`,
        startLocation: 'Depot',
        endLocation: 'Olaya',
        estimatedDurationMinutes: 30,
      })

      created.scheduledTrip = await createEntity(request, token, TRIPS, {
        routeId: created.route,
        vehicleId: created.vehicle,
        driverId: created.driver,
        scheduledStartTime: isoInstant(2),
        scheduledEndTime: isoInstant(2.2),
      })
      const scheduledCancel = await apiRequest(request, 'POST', `${TRIPS}/cancel`, {
        token,
        data: { id: created.scheduledTrip, reason: 'Customer request' },
      })
      expect(scheduledCancel.ok(), `scheduled cancel failed with ${scheduledCancel.status()}`).toBeTruthy()
      const cancelled = await getTrip(request, token, created.scheduledTrip)
      expect(cancelled.status).toBe('cancelled')
      expect(cancelled.cancellation_reason).toBe('Customer request')

      created.runningTrip = await createEntity(request, token, TRIPS, {
        routeId: created.route,
        vehicleId: created.vehicle,
        driverId: created.driver,
        scheduledStartTime: isoInstant(3),
        scheduledEndTime: isoInstant(3.2),
      })
      const dispatch = await apiRequest(request, 'POST', `${TRIPS}/dispatch`, {
        token,
        data: { id: created.runningTrip },
      })
      expect(dispatch.ok(), `dispatch failed with ${dispatch.status()}`).toBeTruthy()

      const runningCancel = await apiRequest(request, 'POST', `${TRIPS}/cancel`, {
        token,
        data: { id: created.runningTrip, reason: 'Vehicle breakdown' },
      })
      expect(runningCancel.ok(), `running cancel failed with ${runningCancel.status()}`).toBeTruthy()

      const runningAfter = await getTrip(request, token, created.runningTrip)
      expect(runningAfter.status).toBe('cancelled')
      expect(runningAfter.actual_end_time).toBeTruthy()

      const driverResponse = await apiRequest(request, 'GET', `${DRIVERS}?id=${encodeURIComponent(created.driver)}`, { token })
      const driverBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(driverResponse)
      expect(driverBody?.items?.[0]?.status).toBe('available')

      const repeatCancel = await apiRequest(request, 'POST', `${TRIPS}/cancel`, {
        token,
        data: { id: created.runningTrip },
      })
      expect(repeatCancel.status(), 'a cancelled trip is no longer cancellable').toBe(409)
    } finally {
      await deleteEntity(request, token, TRIPS, created.runningTrip)
      await deleteEntity(request, token, TRIPS, created.scheduledTrip)
      await deleteEntity(request, token, DRIVERS, created.driver)
      await deleteEntity(request, token, ROUTES, created.route)
      await deleteEntity(request, token, VEHICLES, created.vehicle)
    }
  })
})
