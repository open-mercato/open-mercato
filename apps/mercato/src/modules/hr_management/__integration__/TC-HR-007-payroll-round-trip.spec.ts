import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['hr_management', 'financial'],
}

/**
 * TC-HR-007: a payroll run calculates, closes, consumes nothing it should not,
 * and reaches the ledger.
 *
 * The employee has a basic salary and a housing allowance only, so the expected
 * gross is the sum and the expected entry is two lines. The run closes from
 * `calculated` (no approval workflow is configured in the fixture), which is the
 * documented fallback; the approval path is covered by the engine's own tests.
 */

const EMPLOYEES = '/api/hr_management/employees'
const COMPENSATIONS = '/api/hr_management/compensations'
const PAYROLL_RUNS = '/api/hr_management/payroll-runs'
const PAYSLIPS = '/api/hr_management/payslips'
const CHART = '/api/financial/chart-of-accounts'
const PERIODS = '/api/financial/periods'
const ENTRIES = '/api/financial/journal-entries'
const LINES = '/api/financial/journal-entries/lines'

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
  idKeys: string[] = ['id'],
): Promise<Record<string, unknown>> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  const text = await response.text()
  expect(response.ok(), `POST ${path} failed with ${response.status()}: ${text.slice(0, 500)}`).toBeTruthy()
  const body = JSON.parse(text) as Record<string, unknown>
  for (const key of idKeys) {
    if (typeof body[key] === 'string' && String(body[key]).length > 0) return body
  }
  throw new Error(`POST ${path} returned no id: ${text.slice(0, 500)}`)
}

async function resolvePeriodForToday(request: APIRequestContext, token: string): Promise<string> {
  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)
  const year = today.getUTCFullYear()
  const existing = await apiRequest(request, 'GET', `${PERIODS}?fiscalYear=${year}&pageSize=100`, { token })
  const body = await readJsonSafe<{ items?: Array<{ id: string; start_date: string; end_date: string }> }>(existing)
  const covering = (body?.items ?? []).find(
    (period) => period.start_date.slice(0, 10) <= todayIso && period.end_date.slice(0, 10) >= todayIso,
  )
  if (covering) return covering.id
  const month = today.getUTCMonth()
  const created = await postEntity(request, token, PERIODS, {
    fiscalYear: year,
    periodNumber: month + 1,
    periodName: `${year}-${String(month + 1).padStart(2, '0')} ${uniqueSuffix()}`,
    startDate: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    endDate: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
  })
  return String(created.id)
}

test.describe('TC-HR-007: payroll round trip', () => {
  let cleanupEmployeeId: string | null = null

  test.afterEach(async ({ request }) => {
    if (!cleanupEmployeeId) return
    try {
      const token = await getAuthToken(request)
      await apiRequest(request, 'DELETE', `${EMPLOYEES}?id=${encodeURIComponent(cleanupEmployeeId)}`, { token })
    } catch {
      // Cleanup must not mask the assertion that failed first.
    } finally {
      cleanupEmployeeId = null
    }
  })

  test('calculate, close, and post to the ledger', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueSuffix()
    const today = new Date()
    const todayIso = today.toISOString().slice(0, 10)
    const periodStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10)

    await apiRequest(request, 'POST', CHART, { token, data: { countryCode: 'SA' } })
    await resolvePeriodForToday(request, token)

    const employee = await postEntity(request, token, EMPLOYEES, {
      employeeNumber: `PAY-${suffix}`,
      firstName: 'Payroll',
      lastName: `Test ${suffix}`,
      nationalId: `NID-${suffix}`,
      jobTitle: 'Driver',
      hireDate: periodStart,
    })
    const employeeId = String(employee.id)
    cleanupEmployeeId = employeeId

    await postEntity(request, token, COMPENSATIONS, {
      employeeId,
      effectiveFrom: periodStart,
      basicSalary: '5000.00',
      housingAllowance: '1000.00',
      currencyCode: 'SAR',
    })

    const run = await postEntity(request, token, PAYROLL_RUNS + '/create', {
      periodStart,
      periodEnd: todayIso,
      paymentDate: todayIso,
      currencyCode: 'SAR',
    })
    const runId = String(run.id)

    const calculated = await apiRequest(request, 'POST', `${PAYROLL_RUNS}/calculate`, { token, data: { id: runId } })
    expect(calculated.ok(), `POST ${PAYROLL_RUNS}/calculate failed with ${calculated.status()}`).toBeTruthy()

    const payslips = await apiRequest(request, 'GET', `${PAYSLIPS}?payrollRunId=${runId}&employeeId=${employeeId}&pageSize=100`, { token })
    const payslipBody = await readJsonSafe<{ items?: Array<{ id: string; gross_amount: string; net_amount: string; deduction_amount: string }> }>(payslips)
    expect(payslips.ok()).toBeTruthy()
    expect(payslipBody?.items).toHaveLength(1)
    expect(payslipBody?.items?.[0]?.gross_amount).toBe('6000.0000')
    expect(payslipBody?.items?.[0]?.deduction_amount).toBe('0.0000')
    expect(payslipBody?.items?.[0]?.net_amount).toBe('6000.0000')

    const closed = await apiRequest(request, 'POST', `${PAYROLL_RUNS}/close`, { token, data: { id: runId } })
    expect(closed.ok(), `POST ${PAYROLL_RUNS}/close failed with ${closed.status()}`).toBeTruthy()

    const runAfter = await apiRequest(request, 'GET', `${PAYROLL_RUNS}?ids=${runId}&pageSize=1`, { token })
    const runAfterBody = await readJsonSafe<{ items?: Array<{ status: string }> }>(runAfter)
    expect(runAfterBody?.items?.[0]?.status).toBe('closed')

    await expect.poll(async () => {
      const entries = await apiRequest(
        request,
        'GET',
        `${ENTRIES}?sourceEntityType=hr_payroll_run&sourceEntityId=${runId}&pageSize=10`,
        { token },
      )
      const body = await readJsonSafe<{ items?: Array<{ id: string; status: string }> }>(entries)
      return body?.items?.find((entry) => entry.status === 'posted')?.id ?? null
    }, {
      timeout: 30_000,
      message: 'the closed run must reach the ledger',
    }).not.toBeNull()

    const entries = await apiRequest(
      request,
      'GET',
      `${ENTRIES}?sourceEntityType=hr_payroll_run&sourceEntityId=${runId}&pageSize=10`,
      { token },
    )
    const entryBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(entries)
    const entryId = entryBody?.items?.[0]?.id as string
    const lines = await apiRequest(request, 'GET', `${LINES}?id=${entryId}`, { token })
    const lineBody = await readJsonSafe<{ items?: Array<{ account_code: string; debit_amount: string; credit_amount: string }> }>(lines)
    expect(lineBody?.items?.find((line) => line.account_code === '5100')?.debit_amount).toBe('6000.0000')
    expect(lineBody?.items?.find((line) => line.account_code === '2000')?.credit_amount).toBe('6000.0000')
  })
})
