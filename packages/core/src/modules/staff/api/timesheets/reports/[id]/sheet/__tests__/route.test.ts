/** @jest-environment node */
/**
 * #6975: MikroORM hydrates the `period_from` / `period_to` date columns as
 * `YYYY-MM-DD` strings, and the sheet used to accept only `Date` instances, so
 * every loaded report answered with a null period and the report page showed "–".
 */

import { NextResponse } from 'next/server'

const mockResolveReportRequestContext = jest.fn()
const mockFindOne = jest.fn()
const mockFind = jest.fn()
const mockBuildReportSheet = jest.fn()

jest.mock('../../../shared', () => ({
  ...jest.requireActual('../../../shared'),
  resolveReportRequestContext: jest.fn((...args: unknown[]) => mockResolveReportRequestContext(...args)),
}))

jest.mock('../../../../_shared/withTimesheetInterceptors', () => ({
  readSearchParamsRecord: jest.fn(() => ({})),
  runTimesheetInterceptors: jest.fn(async () => ({
    ok: true,
    session: {
      searchParams: new URLSearchParams(),
      respond: (status: number, body: unknown) => NextResponse.json(body, { status }),
    },
  })),
}))

jest.mock('../../../../../../commands/timesheets-reports', () => ({
  loadReportProjectIds: jest.fn(async () => []),
}))

jest.mock('../../../../../../lib/timesheets-reports/buildReportSheet', () => ({
  buildReportSheet: jest.fn((...args: unknown[]) => mockBuildReportSheet(...args)),
}))

jest.mock('../../../../../../lib/timesheets-reports/reportRows', () => ({
  buildReportRows: jest.fn(() => []),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (key: string, fallback?: string) => fallback ?? key })),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const REPORT_ID = '44444444-4444-4444-8444-444444444444'

type RouteModule = typeof import('../route')
let getHandler: RouteModule['GET']

function reportRow(periodFrom: unknown, periodTo: unknown) {
  return {
    id: REPORT_ID,
    reference: 'TR-2026-0001',
    title: 'August 2026 — time and materials',
    status: 'draft',
    customerId: null,
    customerSnapshot: null,
    periodKind: 'month',
    periodFrom,
    periodTo,
    includeAlreadyReported: false,
    showRates: true,
    roundingUnitMinutes: 0,
    roundingDirection: 'up',
    closedAt: null,
    closedByUserId: null,
    createdByUserId: USER_ID,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    updatedAt: new Date('2026-08-01T10:00:00.000Z'),
  }
}

async function fetchSheetPeriod() {
  const response = await getHandler(
    new Request(`http://localhost/api/staff/timesheets/reports/${REPORT_ID}/sheet`),
  )
  expect(response.status).toBe(200)
  const body = await response.json()
  return { periodFrom: body.report.periodFrom, periodTo: body.report.periodTo }
}

beforeAll(async () => {
  getHandler = (await import('../route')).GET
})

beforeEach(() => {
  jest.clearAllMocks()
  const em = { fork: () => em, findOne: mockFindOne, find: mockFind }
  mockResolveReportRequestContext.mockResolvedValue({
    container: { resolve: () => em },
    auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID },
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    reportId: REPORT_ID,
    translate: (key: string, fallback?: string) => fallback ?? key,
    canSeeMoney: true,
    grantedFeatures: [],
  })
  mockFind.mockResolvedValue([])
  mockBuildReportSheet.mockResolvedValue({
    currencyCode: 'PLN',
    grouping: 'task',
    nonbillableMode: 'show',
    entries: [],
    projects: [],
    directory: {},
    totals: {
      groups: [],
      entryCount: 0,
      billableMinutes: 0,
      nonbillableMinutes: 0,
      totalAmount: 0,
      alreadyReportedCount: 0,
      alreadyReportedMinutes: 0,
      alreadyReportedIn: [],
    },
  })
})

describe('GET /api/staff/timesheets/reports/[id]/sheet — report period', () => {
  it('returns the period when the date columns are hydrated as strings', async () => {
    mockFindOne.mockResolvedValue(reportRow('2026-08-01', '2026-08-31'))
    await expect(fetchSheetPeriod()).resolves.toEqual({ periodFrom: '2026-08-01', periodTo: '2026-08-31' })
  })

  it('returns the period when the date columns hold Date instances', async () => {
    mockFindOne.mockResolvedValue(reportRow(new Date('2026-09-01'), new Date('2026-09-30')))
    await expect(fetchSheetPeriod()).resolves.toEqual({ periodFrom: '2026-09-01', periodTo: '2026-09-30' })
  })
})
