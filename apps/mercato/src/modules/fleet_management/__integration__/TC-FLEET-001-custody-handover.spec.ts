import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['fleet_management', 'hr_management'],
}

/**
 * TC-FLEET-001: vehicle custody, hand over and back.
 *
 * The two action commands are the only writers of a vehicle's custody state, and what they promise is
 * cross-entity: the vehicle's status, its assigned employee, its odometer, the assignment row and an
 * odometer log all move together, in one transaction. A unit test can pin the payload shape (there is
 * one) but not that promise, which is why it lives here.
 *
 * The negative case matters just as much: handing over a vehicle that is already in someone's custody
 * has to be refused, or two drivers hold the same truck.
 */

const VEHICLES = '/api/fleet_management/vehicles'
const ASSIGNMENTS = '/api/fleet_management/assignments'
const HANDOVER = '/api/fleet_management/assignments/handover'
const RETURN = '/api/fleet_management/assignments/return'
const ODOMETER_LOGS = '/api/fleet_management/odometer-logs'
const EMPLOYEES = '/api/hr_management/employees'

type VehicleItem = {
  id?: string
  status?: string
  assigned_employee_id?: string | null
  current_odometer?: number | null
}
type ListResponse<T> = { items?: T[] }
type CreatedByApi = { id?: string | null }

let fixtureCounter = 0
function uniqueSuffix(): string {
  fixtureCounter += 1
  return `${Date.now()}-${fixtureCounter}`
}

async function createEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  const body = await readJsonSafe<CreatedByApi>(response)
  expect(response.ok(), `POST ${path} failed with ${response.status()}: ${JSON.stringify(body)}`).toBeTruthy()
  return body?.id as string
}

async function readVehicle(request: APIRequestContext, token: string, id: string): Promise<VehicleItem | null> {
  const response = await apiRequest(request, 'GET', `${VEHICLES}?ids=${encodeURIComponent(id)}&pageSize=1`, { token })
  expect(response.ok(), `GET ${VEHICLES} failed with ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<ListResponse<VehicleItem>>(response)
  return body?.items?.[0] ?? null
}

async function deleteEntity(request: APIRequestContext, token: string, path: string, id: string | null): Promise<void> {
  if (!id) return
  try {
    await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token })
  } catch {
    // Cleanup must not mask the assertion that failed first.
  }
}

test.describe('TC-FLEET-001: vehicle custody', () => {
  test('handover assigns custody and the return puts the vehicle back, with a log for each', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueSuffix()

    let vehicleId: string | null = null
    let employeeId: string | null = null
    let assignmentId: string | null = null

    try {
      employeeId = await createEntity(request, token, EMPLOYEES, {
        employeeNumber: `TCFLEET001-${suffix}`,
        firstName: 'TC',
        lastName: `Fleet001 ${suffix}`,
        nationalId: `20000000${suffix.slice(-4)}`,
        jobTitle: 'Driver',
        hireDate: '2026-01-05',
        status: 'active',
      })

      vehicleId = await createEntity(request, token, VEHICLES, {
        plateNumber: `TCF-${suffix.slice(-6)}`,
        make: 'Toyota',
        model: 'Hilux',
        year: 2024,
        status: 'active',
        currentOdometer: 1000,
      })

      const handoverResponse = await apiRequest(request, 'POST', HANDOVER, {
        token,
        data: { vehicleId, employeeId, handoverOdometer: 1200, custodyNotes: `TC FLEET 001 custody ${suffix}` },
      })
      const handover = await readJsonSafe<{ assignmentId?: string; vehicleId?: string }>(handoverResponse)
      expect(handoverResponse.ok(), `handover failed with ${handoverResponse.status()}: ${JSON.stringify(handover)}`).toBeTruthy()
      assignmentId = expectId(handover?.assignmentId, 'handover returned no assignment id')
      expect(handover?.vehicleId).toBe(vehicleId)
      expect(handover?.vehicleId).toBe(vehicleId)

      const assigned = await readVehicle(request, token, vehicleId)
      expect(assigned?.status).toBe('assigned')
      expect(assigned?.assigned_employee_id).toBe(employeeId)
      expect(assigned?.current_odometer).toBe(1200)

      // The custody filters the vehicles screen and the odometer history are built on: a key that never
      // reaches the query would answer 200 with nothing, which reads as "no vehicle" rather than a bug.
      const assignedVehicles = await apiRequest(request, 'GET', `${VEHICLES}?assignedEmployeeId=${employeeId}&pageSize=20`, { token })
      const assignedBody = await readJsonSafe<ListResponse<{ id?: string }>>(assignedVehicles)
      expect((assignedBody?.items ?? []).map((row) => row.id)).toContain(vehicleId)

      const odometerByAssignment = await apiRequest(
        request,
        'GET',
        `${ODOMETER_LOGS}?assignmentId=${encodeURIComponent(assignmentId)}&pageSize=20`,
        { token },
      )
      const odometerByAssignmentBody = await readJsonSafe<ListResponse<{ reading?: number | null; source?: string | null }>>(odometerByAssignment)
      expect(odometerByAssignmentBody?.items?.length).toBe(1)
      expect(odometerByAssignmentBody?.items?.[0]?.reading).toBe(1200)
      expect(odometerByAssignmentBody?.items?.[0]?.source).toBe('assignment_handover')

      // A second handover while the vehicle is in custody must be refused: two drivers, one truck.
      const secondHandover = await apiRequest(request, 'POST', HANDOVER, {
        token,
        data: { vehicleId, employeeId, handoverOdometer: 1300 },
      })
      expect(secondHandover.ok(), 'a vehicle already in custody accepted a second handover').toBeFalsy()

      const returnResponse = await apiRequest(request, 'POST', RETURN, {
        token,
        data: { id: assignmentId, returnOdometer: 1450, custodyNotes: `TC FLEET 001 returned ${suffix}` },
      })
      expect(returnResponse.ok(), `return failed with ${returnResponse.status()}`).toBeTruthy()

      const returned = await readVehicle(request, token, vehicleId)
      expect(returned?.status).toBe('active')
      expect(returned?.assigned_employee_id).toBeNull()
      expect(returned?.current_odometer).toBe(1450)

      const logsResponse = await apiRequest(
        request,
        'GET',
        `${ODOMETER_LOGS}?vehicleId=${encodeURIComponent(vehicleId)}&pageSize=50`,
        { token },
      )
      const logs = await readJsonSafe<ListResponse<{ reading?: number | null; source?: string | null }>>(logsResponse)
      expect(logsResponse.ok(), `odometer log read failed with ${logsResponse.status()}`).toBeTruthy()
      // Both ends of the custody are logged, and the source names which end: a vehicle's mileage
      // history has to show where it stood when it left and when it came back.
      const readingBySource = new Map((logs?.items ?? []).map((row) => [row.source, row.reading]))
      expect(readingBySource.get('assignment_handover')).toBe(1200)
      expect(readingBySource.get('assignment_return')).toBe(1450)
    } finally {
      await deleteEntity(request, token, ASSIGNMENTS, assignmentId)
      await deleteEntity(request, token, VEHICLES, vehicleId)
      await deleteEntity(request, token, EMPLOYEES, employeeId)
    }
  })
})
