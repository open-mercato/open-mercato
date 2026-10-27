/** @jest-environment node */
import { inflateRawSync } from 'node:zlib'
import { NextResponse } from 'next/server'
import { StaffTimeReport } from '../../../../../../data/entities'
import { loadReportProjectIds } from '../../../../../../commands/timesheets-reports'
import { buildReportSheet, type ReportSheet } from '../../../../../../lib/timesheets-reports/buildReportSheet'
import { computeReportTotals, type ReportInputEntry } from '../../../../../../lib/timesheets-reports/reportTotals'
import { registerReportExportFormat } from '../../../../../../lib/timesheets-reports/reportExportFormats'
import type { ReportExportInput } from '../../../../../../lib/timesheets-reports/reportExport'
import { GET, metadata } from '../route'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const REPORT_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_ID = '55555555-5555-4555-8555-555555555555'
const mockFindOne = jest.fn()
const mockPersist = jest.fn()
const mockUserHasAllFeatures = jest.fn()
const mockGetGrantedFeatures = jest.fn()
let mockTenantId = TENANT_ID
let mockOrganizationId = ORG_ID

const mockEm = {
  fork: () => mockEm,
  findOne: mockFindOne,
  create: jest.fn((_entity: unknown, data: unknown) => data),
  persist: mockPersist,
  flush: jest.fn(async () => {}),
}
const mockContainer = {
  resolve: (name: string) => {
    if (name === 'em') return mockEm
    if (name === 'rbacService') return {
      userHasAllFeatures: mockUserHasAllFeatures,
      getGrantedFeatures: mockGetGrantedFeatures,
    }
    throw new Error(`[internal] unexpected service: ${name}`)
  },
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: USER_ID, tenantId: mockTenantId, orgId: mockOrganizationId })),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    tenantId: mockTenantId,
    selectedId: mockOrganizationId,
    filterIds: [mockOrganizationId],
    allowedIds: [mockOrganizationId],
  })),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (key: string, fallback?: string) => fallback ?? key })),
}))
jest.mock('../../../../_shared/withTimesheetInterceptors', () => ({
  readSearchParamsRecord: jest.fn(() => ({})),
  runTimesheetInterceptors: jest.fn(async ({ request }: { request: Request }) => ({
    ok: true,
    session: {
      searchParams: new URL(request.url).searchParams,
      respondWithDescriptor: async (descriptor: unknown) => ({ ok: true, descriptor }),
    },
  })),
}))
jest.mock('../../../../../../commands/timesheets-reports', () => ({
  loadReportProjectIds: jest.fn(async () => ['project']),
}))
jest.mock('../../../../../../lib/timesheets-reports/buildReportSheet', () => ({
  buildReportSheet: jest.fn(),
}))
jest.mock('../../../../../../events', () => ({
  emitStaffEvent: jest.fn(async () => {}),
}))

const projects = [{ id: 'project', name: 'Export project', hourlyRate: 97.31, currencyCode: 'PLN' }]
const directory = {
  taskLabelById: { parent: 'Parent task', child: 'Child task' },
  personLabelById: { member: 'Report person' },
}
const labels = { unassignedTask: 'No task', unassignedPerson: 'No person', nonbillableGroup: 'Non-billable' }
const entries: ReportInputEntry[] = ['parent', 'child'].map((taskId) => ({
  id: `entry-${taskId}`,
  timeProjectId: 'project',
  taskId,
  rootTaskId: 'parent',
  staffMemberId: 'member',
  date: '2026-10-01',
  durationMinutes: 60,
  roundedMinutes: 60,
  isBillable: true,
  rateOverrideAmount: null,
  description: 'Visible work description',
  frozen: null,
}))

function makeSheet(): ReportSheet {
  return {
    entries,
    projects,
    directory,
    currencyCode: 'PLN',
    grouping: 'project_task',
    nonbillableMode: 'separate',
    isClosed: false,
    totals: computeReportTotals({
      entries,
      projects,
      directory,
      labels,
      options: { grouping: 'project_task', nonbillableMode: 'separate', includeAlreadyReported: false },
    }),
  }
}

let report = {
  id: REPORT_ID,
  reference: 'RPT-7834',
  title: 'Export report',
  showRates: true,
  periodFrom: '2026-10-01',
  periodTo: '2026-10-31',
  closedAt: null,
}

async function exportReport(format: string, reportId = REPORT_ID) {
  return GET(new Request(`http://localhost/api/staff/timesheets/reports/${reportId}/export?format=${format}`))
}

async function fileText(response: Response, format: string): Promise<string> {
  const body = Buffer.from(await response.arrayBuffer())
  if (format !== 'xlsx') return body.toString(format === 'pdf' ? 'latin1' : 'utf8')
  let offset = 0
  while (body.readUInt32LE(offset) === 0x04034b50) {
    const size = body.readUInt32LE(offset + 18)
    const nameLength = body.readUInt16LE(offset + 26)
    const extraLength = body.readUInt16LE(offset + 28)
    const name = body.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
    const start = offset + 30 + nameLength + extraLength
    if (name === 'xl/worksheets/sheet1.xml') {
      return inflateRawSync(body.subarray(start, start + size)).toString('utf8')
    }
    offset = start + size
  }
  throw new Error('[internal] missing XLSX worksheet')
}

beforeEach(() => {
  jest.clearAllMocks()
  mockTenantId = TENANT_ID
  mockOrganizationId = ORG_ID
  report = { ...report, showRates: true }
  mockUserHasAllFeatures.mockResolvedValue(false)
  mockGetGrantedFeatures.mockResolvedValue(['staff.timesheets.reports.view'])
  mockFindOne.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) =>
    where.id === REPORT_ID && where.tenantId === TENANT_ID && where.organizationId === ORG_ID && where.deletedAt === null
      ? report : null,
  )
  jest.mocked(buildReportSheet).mockResolvedValue(makeSheet())
})

describe('report export money permissions', () => {
  it.each(['pdf', 'csv', 'xlsx'])('redacts money for a reports-view-only caller in %s', async (format) => {
    expect(metadata.GET.requireFeatures).toEqual(['staff.timesheets.reports.view'])
    const response = await exportReport(format)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain(`RPT-7834.${format}`)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const text = await fileText(response, format)
    expect(text).toContain('Parent task')
    expect(text).toContain('Child task')
    expect(text).not.toContain('97.31')
    expect(text).not.toContain('194.62')
    expect(text).not.toContain('Amount')
    expect(text).not.toContain('Rate')
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(USER_ID, ['staff.timesheets.rates.view'], {
      tenantId: TENANT_ID, organizationId: ORG_ID,
    })
  })

  it.each(['pdf', 'csv', 'xlsx'])('preserves authorized amounts with hidden rates in %s', async (format) => {
    mockUserHasAllFeatures.mockResolvedValue(true)
    report.showRates = false
    const response = await exportReport(format)
    expect(response.status).toBe(200)
    const text = await fileText(response, format)
    expect(text).toContain('Amount')
    expect(text).toContain('97.31')
    if (format === 'pdf') expect(text).toContain('194.62 PLN')
    expect(text).not.toContain('Rate')
    expect(text).not.toContain('97.31 PLN/h')
  })

  it.each(['pdf', 'csv', 'xlsx'])('preserves authorized rates in %s', async (format) => {
    mockUserHasAllFeatures.mockResolvedValue(true)
    const response = await exportReport(format)
    expect(response.status).toBe(200)
    const text = await fileText(response, format)
    expect(text).toContain('Rate')
    expect(text).toContain('97.31')
  })

  it.each([false, true])('passes only permission-appropriate money to contributed serializers (allowed: %s)', async (allowed) => {
    mockUserHasAllFeatures.mockResolvedValue(allowed)
    const originalSheet = makeSheet()
    jest.mocked(buildReportSheet).mockResolvedValue(originalSheet)
    const serialize = jest.fn((input: ReportExportInput) => ({
      body: Buffer.from(JSON.stringify(input)), contentType: 'application/json', filename: 'report.json',
    }))
    const unregister = registerReportExportFormat({
      id: 'permission-test-json', labelKey: 'test.format', mimeType: 'application/json', extension: 'json', serialize,
    })
    try {
      const response = await exportReport('permission-test-json')
      expect(response.status).toBe(200)
      const input = serialize.mock.calls[0][0]
      expect(input.totals.totalAmount).toBe(allowed ? 194.62 : 0)
      expect(input.groups[0].rate).toBe(allowed ? 97.31 : null)
      expect(input.groups[0].amount).toBe(allowed ? 194.62 : 0)
      const parent = input.groups[0].lines[0]
      const child = parent.children[0]
      expect(parent.rate).toBe(allowed ? 97.31 : null)
      expect(parent.amount).toBe(allowed ? 194.62 : 0)
      expect(child.rate).toBe(allowed ? 97.31 : null)
      expect(child.amount).toBe(allowed ? 97.31 : 0)
      expect(parent.minutes).toBe(120)
      expect(child.minutes).toBe(60)
      for (const row of input.rows) {
        expect(row.rate).toBe(allowed ? 97.31 : null)
        expect(row.amount).toBe(allowed ? 97.31 : null)
      }
      expect(input.canSeeMoney).toBe(allowed)
      expect(originalSheet).toEqual(makeSheet())
    } finally {
      unregister()
    }
  })

  it('retains tenant, organization and report scope throughout sheet construction', async () => {
    expect((await exportReport('pdf')).status).toBe(200)
    expect(mockFindOne).toHaveBeenCalledWith(StaffTimeReport, {
      id: REPORT_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null,
    })
    expect(loadReportProjectIds).toHaveBeenCalledWith(mockEm, REPORT_ID, { tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(buildReportSheet).toHaveBeenCalledWith(expect.objectContaining({
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID }, report, timeProjectIds: ['project'],
    }))
  })

  it.each(['tenant', 'organization', 'report'])('refuses an inaccessible %s before serializing or auditing', async (scope) => {
    if (scope === 'tenant') mockTenantId = OTHER_ID
    if (scope === 'organization') mockOrganizationId = OTHER_ID
    const response = await exportReport('pdf', scope === 'report' ? OTHER_ID : REPORT_ID)
    expect(response.status).toBe(404)
    expect(buildReportSheet).not.toHaveBeenCalled()
    expect(mockPersist).not.toHaveBeenCalled()
  })
})
