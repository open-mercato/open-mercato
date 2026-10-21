import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['hr_management'],
}

/**
 * TC-HR-008: an entitlement caps paid leave, the monthly accrual is idempotent,
 * and unpaid leave stays uncapped but still reaches the payslip.
 *
 * The fixtures are unique per run so parallel payroll specs in the same
 * organization cannot see each other's employee.
 */

const EMPLOYEES = '/api/hr_management/employees'
const ENTITLEMENTS = '/api/hr_management/leave-entitlements'
const ACCRUALS_RUN = '/api/hr_management/leave-accruals/run'
const LEAVE_REQUESTS = '/api/hr_management/leave-requests'
const COMPENSATIONS = '/api/hr_management/compensations'
const PAYROLL_RUNS = '/api/hr_management/payroll-runs'
const PAYSLIPS = '/api/hr_management/payslips'
const PAYSLIP_LINES = '/api/hr_management/payslips/lines'

let fixtureCounter = 0
function uniqueSuffix(): string {
  fixtureCounter += 1
  return `${Date.now()}-${fixtureCounter}`
}

async function postEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  const text = await response.text()
  expect(response.ok(), `POST ${path} failed with ${response.status()}: ${text.slice(0, 500)}`).toBeTruthy()
  return JSON.parse(text) as Record<string, unknown>
}

async function deleteQuietly(
  request: APIRequestContext,
  token: string,
  path: string,
  id: string | null,
): Promise<void> {
  if (!id) return
  await apiRequest(request, 'DELETE', path, { token, data: { id } }).catch(() => undefined)
}

test.describe('TC-HR-008: leave balances and accrual', () => {
  test('refuses an over-balance request, accrues idempotently and pays unpaid leave', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueSuffix()
    const year = new Date().getUTCFullYear()
    const periodStart = `${year}-01-01`
    const periodEnd = `${year}-12-31`

    let employeeId: string | null = null
    let entitlementId: string | null = null
    const leaveRequestIds: string[] = []

    try {
      const employee = await postEntity(request, token, EMPLOYEES, {
        employeeNumber: `LV-${suffix}`,
        firstName: 'Leave',
        lastName: `Balance ${suffix}`,
        nationalId: `LVID-${suffix}`,
        jobTitle: 'Driver',
        hireDate: periodStart,
      })
      employeeId = String(employee.id)

      const entitlement = await postEntity(request, token, ENTITLEMENTS, {
        employeeId,
        leaveType: 'annual',
        periodStart,
        periodEnd,
        entitledDays: '10',
        carryOverDays: '0',
      })
      entitlementId = String(entitlement.id)

      const overBalance = await apiRequest(request, 'POST', LEAVE_REQUESTS, {
        token,
        data: {
          employeeId,
          leaveType: 'annual',
          startDate: `${year}-01-05`,
          endDate: `${year}-01-16`,
          totalDays: 12,
        },
      })
      expect(overBalance.status(), 'a request above the entitlement must be refused').toBe(409)

      const withinBalance = await postEntity(request, token, LEAVE_REQUESTS, {
        employeeId,
        leaveType: 'annual',
        startDate: `${year}-01-05`,
        endDate: `${year}-01-09`,
        totalDays: 5,
      })
      leaveRequestIds.push(String(withinBalance.id))

      const pendingCounts = await apiRequest(request, 'POST', LEAVE_REQUESTS, {
        token,
        data: {
          employeeId,
          leaveType: 'annual',
          startDate: `${year}-01-12`,
          endDate: `${year}-01-17`,
          totalDays: 6,
        },
      })
      expect(pendingCounts.status(), 'pending leave must consume the balance').toBe(409)

      const firstRun = await apiRequest(request, 'POST', ACCRUALS_RUN, {
        token,
        data: { month: `${year}-02`, employeeId, leaveType: 'annual' },
      })
      const firstRunBody = await readJsonSafe<{ created?: number; skipped?: number; daysAdded?: string }>(firstRun)
      expect(firstRun.ok()).toBeTruthy()
      expect(firstRunBody?.created).toBe(1)
      expect(firstRunBody?.daysAdded).toBe('0.83')

      const secondRun = await apiRequest(request, 'POST', ACCRUALS_RUN, {
        token,
        data: { month: `${year}-02`, employeeId, leaveType: 'annual' },
      })
      const secondRunBody = await readJsonSafe<{ created?: number; skipped?: number; daysAdded?: string }>(secondRun)
      expect(secondRun.ok()).toBeTruthy()
      expect(secondRunBody?.created).toBe(0)
      expect(secondRunBody?.skipped).toBe(1)
      expect(secondRunBody?.daysAdded).toBe('0.00')

      const unpaid = await postEntity(request, token, LEAVE_REQUESTS, {
        employeeId,
        leaveType: 'unpaid',
        startDate: `${year}-01-12`,
        endDate: `${year}-01-21`,
        totalDays: 10,
      })
      leaveRequestIds.push(String(unpaid.id))

      const approved = await apiRequest(request, 'PUT', LEAVE_REQUESTS, {
        token,
        data: { id: unpaid.id, status: 'approved' },
      })
      expect(approved.ok(), `PUT ${LEAVE_REQUESTS} failed with ${approved.status()}`).toBeTruthy()

      await postEntity(request, token, COMPENSATIONS, {
        employeeId,
        effectiveFrom: periodStart,
        basicSalary: '3000.00',
        currencyCode: 'SAR',
      })

      const run = await postEntity(request, token, `${PAYROLL_RUNS}/create`, {
        periodStart,
        periodEnd: `${year}-01-31`,
        paymentDate: `${year}-01-31`,
        currencyCode: 'SAR',
      })
      const runId = String(run.id)
      const calculated = await apiRequest(request, 'POST', `${PAYROLL_RUNS}/calculate`, { token, data: { id: runId } })
      expect(calculated.ok(), `POST ${PAYROLL_RUNS}/calculate failed with ${calculated.status()}`).toBeTruthy()

      const payslips = await apiRequest(
        request,
        'GET',
        `${PAYSLIPS}?payrollRunId=${runId}&employeeId=${employeeId}&pageSize=10`,
        { token },
      )
      const payslipBody = await readJsonSafe<{ items?: Array<{ id: string; unpaid_leave_days: string }> }>(payslips)
      expect(payslips.ok()).toBeTruthy()
      expect(payslipBody?.items).toHaveLength(1)
      expect(Number(payslipBody?.items?.[0]?.unpaid_leave_days)).toBe(10)

      const payslipId = String(payslipBody?.items?.[0]?.id)
      const lines = await apiRequest(request, 'GET', `${PAYSLIP_LINES}?id=${payslipId}`, { token })
      const lineBody = await readJsonSafe<{ items?: Array<{ code: string; amount: string }> }>(lines)
      const unpaidLine = (lineBody?.items ?? []).find((line) => line.code === 'unpaid_leave')
      expect(unpaidLine, 'the payslip must carry an unpaid-leave deduction line').toBeTruthy()
      expect(Number(unpaidLine?.amount)).toBeGreaterThan(0)
    } finally {
      for (const id of leaveRequestIds) await deleteQuietly(request, token, LEAVE_REQUESTS, id)
      await deleteQuietly(request, token, ENTITLEMENTS, entitlementId)
      await deleteQuietly(request, token, EMPLOYEES, employeeId)
    }
  })
})
