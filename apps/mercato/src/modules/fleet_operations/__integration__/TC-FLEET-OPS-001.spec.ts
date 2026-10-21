import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

export const integrationMeta = {
  dependsOnModules: ['fleet_operations', 'fleet_management', 'financial'],
}

/**
 * TC-FLEET-OPS-001: work orders, parts/labor, schedules, insurance and the ledger.
 *
 * Creates a vehicle and a preventive schedule, opens a work order with one part
 * and one labor line, completes it, and asserts: totals are recomputed, the
 * schedule rolls to the next odometer, and maintenance/insurance costs reach the
 * general ledger through their subscribers. Self-contained fixtures, cleaned up
 * in `finally`.
 */

const VEHICLES = '/api/fleet_management/vehicles'
const SCHEDULES = '/api/fleet_operations/maintenance-schedules'
const WORK_ORDERS = '/api/fleet_operations/work-orders'
const PARTS = '/api/fleet_operations/work-order-parts'
const LABOR = '/api/fleet_operations/work-order-labor'
const POLICIES = '/api/fleet_operations/insurance-policies'
const CHART = '/api/financial/chart-of-accounts'
const PERIODS = '/api/financial/periods'
const ENTRIES = '/api/financial/journal-entries'
const LINES = '/api/financial/journal-entries/lines'

const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

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

async function resolvePeriodForToday(request: APIRequestContext, token: string): Promise<void> {
  const today = new Date()
  const year = today.getUTCFullYear()
  const existing = await apiRequest(request, 'GET', `${PERIODS}?fiscalYear=${year}&pageSize=100`, { token })
  const body = await readJsonSafe<{ items?: Array<{ id: string; start_date: string; end_date: string }> }>(existing)
  const todayIso = today.toISOString().slice(0, 10)
  if ((body?.items ?? []).some((period) => period.start_date.slice(0, 10) <= todayIso && period.end_date.slice(0, 10) >= todayIso)) {
    return
  }
  const month = today.getUTCMonth()
  await postEntity(request, token, PERIODS, {
    fiscalYear: year,
    periodNumber: month + 1,
    periodName: `${year}-${String(month + 1).padStart(2, '0')} ${uniqueSuffix()}`,
    startDate: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    endDate: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
  })
}

async function findPostedEntry(
  request: APIRequestContext,
  token: string,
  sourceEntityType: string,
  sourceEntityId: string,
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const response = await apiRequest(
      request,
      'GET',
      `${ENTRIES}?sourceEntityType=${sourceEntityType}&sourceEntityId=${sourceEntityId}&pageSize=10`,
      { token },
    )
    if (response.ok()) {
      const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
      const posted = (body.items ?? []).find((entry) => entry.status === 'posted')
      if (posted) return posted
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return null
}

test.describe('TC-FLEET-OPS-001: fleet operations round trip', () => {
  test('completes a work order and posts maintenance and insurance costs', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueSuffix()
    let vehicleId: string | null = null
    let scheduleId: string | null = null
    let workOrderId: string | null = null
    let partId: string | null = null
    let laborId: string | null = null
    let policyId: string | null = null

    try {
      await apiRequest(request, 'POST', CHART, { token, data: { countryCode: 'SA' } })
      await resolvePeriodForToday(request, token)

      const vehicle = await postEntity(request, token, VEHICLES, {
        plateNumber: `QA-${suffix}`.slice(0, 20),
        make: 'Toyota',
        model: 'Hiace',
        year: 2024,
        currentOdometer: 10000,
        status: 'active',
      })
      vehicleId = String(vehicle.id ?? vehicle.vehicleId ?? '')
      expect(vehicleId).toBeTruthy()

      const schedule = await postEntity(request, token, SCHEDULES, {
        vehicleId,
        name: `Oil service ${suffix}`,
        intervalType: 'odometer',
        intervalOdometer: 5000,
      })
      scheduleId = String(schedule.id ?? '')
      expect(scheduleId).toBeTruthy()

      const workOrder = await postEntity(request, token, WORK_ORDERS, {
        vehicleId,
        scheduleId,
        title: `Oil change ${suffix}`,
        type: 'preventive',
        odometer: 10000,
      })
      workOrderId = String(workOrder.id ?? '')
      expect(workOrderId).toBeTruthy()

      const part = await postEntity(request, token, PARTS, {
        workOrderId,
        description: 'Oil filter',
        quantity: 2,
        unitCost: 100,
      })
      partId = String(part.id ?? '')
      const labor = await postEntity(request, token, LABOR, {
        workOrderId,
        description: 'Workshop labor',
        hours: 2,
        rate: 50,
      })
      laborId = String(labor.id ?? '')

      const before = await apiRequest(request, 'GET', `${WORK_ORDERS}?id=${workOrderId}`, { token })
      const beforeBody = await readJsonSafe<{ items?: Array<{ updatedAt?: string }> }>(before)
      const updatedAt = beforeBody?.items?.[0]?.updatedAt ?? null
      expect(updatedAt).toBeTruthy()

      const complete = await apiRequest(request, 'POST', `${WORK_ORDERS}/complete`, {
        token,
        headers: updatedAt ? { [LOCK_HEADER]: updatedAt } : undefined,
        data: { id: workOrderId, completedAt: new Date().toISOString() },
      })
      expect(complete.ok(), `complete failed with ${complete.status()}`).toBeTruthy()
      const completeBody = (await complete.json()) as { totalCost?: string }
      expect(completeBody.totalCost).toBe('300.00')

      const after = await apiRequest(request, 'GET', `${WORK_ORDERS}?id=${workOrderId}`, { token })
      const afterBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(after)
      const order = afterBody?.items?.[0] ?? {}
      expect(order.status).toBe('completed')
      expect(order.total_cost).toBe('300.0000')

      const scheduleAfter = await apiRequest(request, 'GET', `${SCHEDULES}?id=${scheduleId}`, { token })
      const scheduleBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(scheduleAfter)
      expect(scheduleBody?.items?.[0]?.next_due_odometer).toBe(15000)

      const maintenanceEntry = await findPostedEntry(request, token, 'fleet_work_order', workOrderId)
      expect(maintenanceEntry, 'the completed work order must reach the ledger').toBeTruthy()
      const maintenanceLines = await apiRequest(
        request,
        'GET',
        `${LINES}?id=${String(maintenanceEntry?.id)}`,
        { token },
      )
      const maintenanceLineBody = await readJsonSafe<{ items?: Array<{ account_code: string; debit_amount: string; credit_amount: string }> }>(maintenanceLines)
      expect(maintenanceLineBody?.items?.find((line) => line.account_code === '5600')?.debit_amount).toBe('300.0000')
      expect(maintenanceLineBody?.items?.find((line) => line.account_code === '2000')?.credit_amount).toBe('300.0000')

      const policy = await postEntity(request, token, POLICIES, {
        vehicleId,
        policyNumber: `POL-${suffix}`,
        insurerName: 'QA Insurer',
        coverageType: 'comprehensive',
        startDate: new Date().toISOString().slice(0, 10),
        endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        premiumAmount: 1200,
        currencyCode: 'SAR',
      })
      policyId = String(policy.id ?? '')
      expect(policyId).toBeTruthy()

      const insuranceEntry = await findPostedEntry(request, token, 'fleet_insurance_policy', policyId)
      expect(insuranceEntry, 'the insurance premium must reach the ledger').toBeTruthy()
      const insuranceLines = await apiRequest(
        request,
        'GET',
        `${LINES}?id=${String(insuranceEntry?.id)}`,
        { token },
      )
      const insuranceLineBody = await readJsonSafe<{ items?: Array<{ account_code: string; debit_amount: string }> }>(insuranceLines)
      expect(insuranceLineBody?.items?.find((line) => line.account_code === '5700')?.debit_amount).toBe('1200.0000')
    } finally {
      await deleteEntityIfExists(request, token, POLICIES, policyId)
      await deleteEntityIfExists(request, token, PARTS, partId)
      await deleteEntityIfExists(request, token, LABOR, laborId)
      await deleteEntityIfExists(request, token, WORK_ORDERS, workOrderId)
      await deleteEntityIfExists(request, token, SCHEDULES, scheduleId)
      await deleteEntityIfExists(request, token, VEHICLES, vehicleId)
    }
  })
})
