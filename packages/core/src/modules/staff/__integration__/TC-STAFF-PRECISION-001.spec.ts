import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/helpers/integration/currenciesFixtures'
import { createTestCustomer, type TestCustomerFixture } from './fixtures'

export const integrationMeta = {
  dependsOnModules: ['customers', 'currencies'],
}

/**
 * TC-STAFF-PRECISION-001: project hourly rate and time entry rate override beyond
 * 4 decimals; report totals `*Exact`.
 * Source: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md
 *
 * The project bills in an 18-decimal currency, so every amount rounds to 18
 * decimals (D10) and any trip through a float would show in the digits:
 *
 *   project rate 123.123456789012345678 x 90 min / 60 = 184.685185183518518517
 *   override     98.765432109876543212 x 20 min / 60 = 32.921810703292181070666...
 *                                                    -> 32.921810703292181071
 *   total                                             = 217.606995886810699588
 */

type JsonRecord = Record<string, unknown>

type SheetRow = { entryId?: string; rateExact?: string | null; amountExact?: string | null }

type SheetBody = {
  report?: { status?: string; currencyCode?: string | null }
  totals?: { billableMinutes?: number; totalAmountExact?: string | null }
  rows?: SheetRow[]
}

const PROJECTS_PATH = '/api/staff/timesheets/time-projects'
const ENTRIES_PATH = '/api/staff/timesheets/time-entries'
const REPORTS_PATH = '/api/staff/timesheets/reports'
const SELF_MEMBER_PATH = '/api/staff/team-members/self'

const ENTRY_DATE = '2026-03-10'
const PERIOD_FROM = '2026-03-01'
const PERIOD_TO = '2026-03-31'
const PROJECT_RATE = '123.123456789012345678'
const OVERRIDE_RATE = '98.765432109876543212'
const PROJECT_RATE_MINUTES = 90
const OVERRIDE_RATE_MINUTES = 20
const PROJECT_RATE_AMOUNT = '184.685185183518518517'
const OVERRIDE_RATE_AMOUNT = '32.921810703292181071'
const EXPECTED_TOTAL = '217.606995886810699588'

async function ensureSelfStaffMemberId(
  request: APIRequestContext,
  token: string,
  displayName: string,
): Promise<{ id: string; created: boolean }> {
  const read = async (): Promise<string | null> => {
    const response = await apiRequest(request, 'GET', SELF_MEMBER_PATH, { token })
    if (!response.ok()) return null
    const body = await readJsonSafe<{ member?: { id?: string } | null }>(response)
    const id = body?.member?.id
    return typeof id === 'string' && id.length > 0 ? id : null
  }
  const existing = await read()
  if (existing) return { id: existing, created: false }
  const response = await apiRequest(request, 'POST', SELF_MEMBER_PATH, { token, data: { displayName } })
  expect(response.ok(), `POST ${SELF_MEMBER_PATH} should create the staff profile: ${response.status()}`).toBeTruthy()
  const created = await read()
  expect(created, 'The staff profile should be readable right after creation').toBeTruthy()
  return { id: created as string, created: true }
}

async function createEntry(request: APIRequestContext, token: string, data: JsonRecord): Promise<string> {
  const response = await apiRequest(request, 'POST', ENTRIES_PATH, { token, data })
  expect(response.status(), `POST ${ENTRIES_PATH} should create the entry`).toBe(201)
  const id = (await readJsonSafe<{ id?: string }>(response))?.id
  expect(typeof id === 'string' && id.length > 0, 'The entry create response should carry an id').toBeTruthy()
  return id as string
}

async function readListItem(request: APIRequestContext, token: string, path: string, id: string): Promise<JsonRecord> {
  const response = await apiRequest(request, 'GET', `${path}?ids=${encodeURIComponent(id)}`, { token })
  expect(response.status(), `GET ${path}?ids should be 200`).toBe(200)
  const body = await readJsonSafe<{ items?: JsonRecord[] }>(response)
  const item = body?.items?.find((candidate) => candidate.id === id)
  expect(item, `GET ${path} should list ${id}`).toBeTruthy()
  return item as JsonRecord
}

async function readSheet(request: APIRequestContext, token: string, reportId: string): Promise<SheetBody> {
  const response = await apiRequest(request, 'GET', `${REPORTS_PATH}/${reportId}/sheet`, { token })
  expect(response.status(), 'GET report sheet should be 200').toBe(200)
  return ((await readJsonSafe<SheetBody>(response)) ?? {}) as SheetBody
}

function expectExactRows(rows: SheetRow[] | undefined, projectEntryId: string, overrideEntryId: string): void {
  const byEntryId = new Map((rows ?? []).map((row) => [row.entryId, row]))
  expect(byEntryId.get(projectEntryId)?.rateExact).toBe(PROJECT_RATE)
  expect(byEntryId.get(projectEntryId)?.amountExact).toBe(PROJECT_RATE_AMOUNT)
  expect(byEntryId.get(overrideEntryId)?.rateExact).toBe(OVERRIDE_RATE)
  expect(byEntryId.get(overrideEntryId)?.amountExact).toBe(OVERRIDE_RATE_AMOUNT)
}

test.describe('TC-STAFF-PRECISION-001: staff rates and report totals beyond float precision', () => {
  test('project rate, entry override and report totals keep 18 decimals', async ({ request }) => {
    test.setTimeout(180_000)
    const stamp = String(Date.now()).slice(-9)
    const token = await getAuthToken(request, 'admin')

    let currencyId: string | null = null
    let customer: TestCustomerFixture | null = null
    let projectId: string | null = null
    let selfMember: { id: string; created: boolean } | null = null
    let reportId: string | null = null
    const entryIds: string[] = []

    try {
      const currency = await createRandomCurrencyFixture(request, token, {
        name: 'QA TC-STAFF-PRECISION-001',
        decimalPlaces: 18,
      })
      currencyId = currency.id

      selfMember = await ensureSelfStaffMemberId(request, token, `QA Precision Member ${stamp}`)
      const staffMemberId = selfMember.id
      customer = await createTestCustomer(request, token, { displayName: `QA Precision Customer ${stamp}` })

      const projectResponse = await apiRequest(request, 'POST', PROJECTS_PATH, {
        token,
        data: {
          name: `QA Precision Project ${stamp}`,
          code: `QPR-${stamp}`,
          customerId: customer.id,
          status: 'active',
          hourlyRate: PROJECT_RATE,
          currencyCode: currency.code,
          billableByDefault: true,
        },
      })
      expect(projectResponse.ok(), `POST ${PROJECTS_PATH} should create the project: ${projectResponse.status()}`).toBeTruthy()
      projectId = ((await readJsonSafe<{ id?: string }>(projectResponse))?.id ?? null) as string | null
      expect(projectId, 'The project create response should carry an id').toBeTruthy()

      const assignResponse = await apiRequest(request, 'POST', `${PROJECTS_PATH}/${projectId}/employees`, {
        token,
        data: { staffMemberId, status: 'active', assignedStartDate: PERIOD_FROM },
      })
      expect(assignResponse.ok(), `Assigning the member to the project should succeed: ${assignResponse.status()}`).toBeTruthy()

      const projectEntryId = await createEntry(request, token, {
        staffMemberId,
        timeProjectId: projectId,
        date: ENTRY_DATE,
        durationMinutes: PROJECT_RATE_MINUTES,
        source: 'manual',
        isBillable: true,
        notes: `QA precision project rate ${stamp}`,
      })
      entryIds.push(projectEntryId)
      const overrideEntryId = await createEntry(request, token, {
        staffMemberId,
        timeProjectId: projectId,
        date: ENTRY_DATE,
        durationMinutes: OVERRIDE_RATE_MINUTES,
        source: 'manual',
        isBillable: true,
        rateOverrideAmount: OVERRIDE_RATE,
        notes: `QA precision override rate ${stamp}`,
      })
      entryIds.push(overrideEntryId)

      const project = await readListItem(request, token, PROJECTS_PATH, projectId as string)
      expect(String(project.hourly_rate ?? project.hourlyRate)).toBe(PROJECT_RATE)
      const overrideEntry = await readListItem(request, token, ENTRIES_PATH, overrideEntryId)
      expect(String(overrideEntry.rate_override_amount ?? overrideEntry.rateOverrideAmount)).toBe(OVERRIDE_RATE)

      const previewResponse = await apiRequest(request, 'POST', `${REPORTS_PATH}/preview`, {
        token,
        data: {
          customerId: customer.id,
          periodKind: 'custom',
          periodFrom: PERIOD_FROM,
          periodTo: PERIOD_TO,
          timeProjectIds: [projectId],
        },
      })
      expect(previewResponse.status(), 'POST report preview should be 200').toBe(200)
      const preview = await readJsonSafe<{ currencyCode?: string; totals?: { totalAmountExact?: string | null } }>(
        previewResponse,
      )
      expect(preview?.currencyCode).toBe(currency.code)
      expect(preview?.totals?.totalAmountExact).toBe(EXPECTED_TOTAL)

      const reportResponse = await apiRequest(request, 'POST', REPORTS_PATH, {
        token,
        data: {
          customerId: customer.id,
          title: `QA Precision Report ${stamp}`,
          periodKind: 'custom',
          periodFrom: PERIOD_FROM,
          periodTo: PERIOD_TO,
          timeProjectIds: [projectId],
        },
      })
      expect(reportResponse.status(), `POST ${REPORTS_PATH} should create the report`).toBe(201)
      reportId = ((await readJsonSafe<{ id?: string }>(reportResponse))?.id ?? null) as string | null
      expect(reportId, 'The report create response should carry an id').toBeTruthy()

      const draftSheet = await readSheet(request, token, reportId as string)
      expect(draftSheet.report?.status).toBe('draft')
      expect(draftSheet.totals?.billableMinutes).toBe(PROJECT_RATE_MINUTES + OVERRIDE_RATE_MINUTES)
      expect(draftSheet.totals?.totalAmountExact).toBe(EXPECTED_TOTAL)
      expectExactRows(draftSheet.rows, projectEntryId, overrideEntryId)

      const closeResponse = await apiRequest(request, 'POST', `${REPORTS_PATH}/${reportId}/close`, { token, data: {} })
      expect(closeResponse.ok(), `Closing the report should succeed: ${closeResponse.status()}`).toBeTruthy()

      const closedSheet = await readSheet(request, token, reportId as string)
      expect(closedSheet.report?.status).toBe('closed')
      expect(closedSheet.totals?.totalAmountExact).toBe(EXPECTED_TOTAL)
      expectExactRows(closedSheet.rows, projectEntryId, overrideEntryId)

      const storedReport = await readListItem(request, token, REPORTS_PATH, reportId as string)
      expect(String(storedReport.total_amount ?? storedReport.totalAmount)).toBe(EXPECTED_TOTAL)
    } finally {
      if (reportId) {
        await apiRequest(request, 'POST', `${REPORTS_PATH}/${reportId}/unlock`, {
          token,
          data: { reason: 'QA TC-STAFF-PRECISION-001 cleanup' },
        }).catch(() => {})
        await apiRequest(request, 'DELETE', `${REPORTS_PATH}?id=${encodeURIComponent(reportId)}`, { token }).catch(() => {})
      }
      for (const entryId of entryIds) {
        await apiRequest(request, 'DELETE', `${ENTRIES_PATH}?id=${encodeURIComponent(entryId)}`, { token }).catch(() => {})
      }
      if (projectId) {
        await apiRequest(request, 'DELETE', `${PROJECTS_PATH}?id=${encodeURIComponent(projectId)}`, { token }).catch(() => {})
      }
      if (customer) await customer.cleanup()
      if (selfMember?.created) {
        await apiRequest(request, 'DELETE', `/api/staff/team-members?id=${encodeURIComponent(selfMember.id)}`, { token }).catch(
          () => {},
        )
      }
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId)
    }
  })
})
