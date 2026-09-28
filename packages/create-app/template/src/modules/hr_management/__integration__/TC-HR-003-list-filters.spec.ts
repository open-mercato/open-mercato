import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['hr_management'],
}

/**
 * TC-HR-003: every HR list filter narrows the result set.
 *
 * A filter key that does not reach the query (see the column-name contract) answers `200` with an empty
 * page, which is indistinguishable from "no matches" in the UI and invisible to every other gate. Each
 * case therefore asserts both directions: the fixture is returned, and a deliberately non-matching
 * sibling is not.
 *
 * The fixtures are created here and removed in `finally`; nothing below depends on seeded data.
 */

const DEPARTMENTS = '/api/hr_management/departments'
const EMPLOYEES = '/api/hr_management/employees'
const DRIVERS = '/api/hr_management/driver-profiles'
const DOCUMENTS = '/api/hr_management/employee-documents'

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

test.describe('TC-HR-003: HR list filters', () => {
  test('the employee, driver and document filters each narrow to the fixture', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueSuffix()

    const created = {
      departmentA: null as string | null,
      departmentB: null as string | null,
      employeeA: null as string | null,
      employeeB: null as string | null,
      driver: null as string | null,
      document: null as string | null,
    }

    try {
      created.departmentA = await createEntity(request, token, DEPARTMENTS, { name: `TC HR 003 A ${suffix}`, code: `TCHR003A-${suffix}` })
      created.departmentB = await createEntity(request, token, DEPARTMENTS, { name: `TC HR 003 B ${suffix}`, code: `TCHR003B-${suffix}` })

      created.employeeA = await createEntity(request, token, EMPLOYEES, {
        employeeNumber: `TCHR003A-${suffix}`,
        firstName: `Alpha${suffix}`,
        lastName: 'Filter',
        nationalId: `8000000${suffix.slice(-4)}`,
        jobTitle: 'Driver',
        hireDate: '2026-01-05',
        status: 'active',
        departmentId: created.departmentA,
      })
      created.employeeB = await createEntity(request, token, EMPLOYEES, {
        employeeNumber: `TCHR003B-${suffix}`,
        firstName: `Beta${suffix}`,
        lastName: 'Filter',
        nationalId: `9000000${suffix.slice(-4)}`,
        jobTitle: 'Driver',
        hireDate: '2026-01-05',
        status: 'terminated',
        departmentId: created.departmentB,
      })

      const byDepartment = await listIds(request, token, `${EMPLOYEES}?departmentId=${created.departmentA}&pageSize=20`)
      expect(byDepartment).toContain(created.employeeA)
      expect(byDepartment).not.toContain(created.employeeB)

      const bySearch = await listIds(request, token, `${EMPLOYEES}?search=${encodeURIComponent(`Alpha${suffix}`)}&pageSize=20`)
      expect(bySearch).toContain(created.employeeA)
      expect(bySearch).not.toContain(created.employeeB)

      const byStatus = await listIds(request, token, `${EMPLOYEES}?status=terminated&pageSize=20`)
      expect(byStatus).toContain(created.employeeB)
      expect(byStatus).not.toContain(created.employeeA)

      created.driver = await createEntity(request, token, DRIVERS, {
        employeeId: created.employeeA,
        licenseNumber: `TCHR003-${suffix}`,
        licenseType: 'Heavy',
        licenseExpiry: isoDate(10),
      })
      const driversByEmployee = await listIds(request, token, `${DRIVERS}?employeeId=${created.employeeA}&pageSize=20`)
      expect(driversByEmployee).toContain(created.driver)

      const driversBySearch = await listIds(request, token, `${DRIVERS}?search=${encodeURIComponent(`TCHR003-${suffix}`)}&pageSize=20`)
      expect(driversBySearch).toContain(created.driver)

      const driversWithin30 = await listIds(request, token, `${DRIVERS}?expiry=within30&pageSize=100`)
      expect(driversWithin30).toContain(created.driver)

      const driversExpired = await listIds(request, token, `${DRIVERS}?expiry=expired&pageSize=100`)
      expect(driversExpired).not.toContain(created.driver)

      created.document = await createEntity(request, token, DOCUMENTS, {
        employeeId: created.employeeA,
        documentType: 'iqama',
        documentNumber: `TCHR003-${suffix}`,
        expiryDate: isoDate(20),
      })
      const documentsByEmployee = await listIds(request, token, `${DOCUMENTS}?employeeId=${created.employeeA}&pageSize=20`)
      expect(documentsByEmployee).toContain(created.document)

      const documentsByType = await listIds(request, token, `${DOCUMENTS}?documentType=iqama&pageSize=20`)
      expect(documentsByType).toContain(created.document)

      const documentsByOtherType = await listIds(request, token, `${DOCUMENTS}?documentType=passport&pageSize=20`)
      expect(documentsByOtherType).not.toContain(created.document)

      const documentsBySearch = await listIds(request, token, `${DOCUMENTS}?search=${encodeURIComponent(`TCHR003-${suffix}`)}&pageSize=20`)
      expect(documentsBySearch).toContain(created.document)
    } finally {
      await deleteEntity(request, token, DOCUMENTS, created.document)
      await deleteEntity(request, token, DRIVERS, created.driver)
      await deleteEntity(request, token, EMPLOYEES, created.employeeB)
      await deleteEntity(request, token, EMPLOYEES, created.employeeA)
      await deleteEntity(request, token, DEPARTMENTS, created.departmentB)
      await deleteEntity(request, token, DEPARTMENTS, created.departmentA)
    }
  })
})
