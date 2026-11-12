/** @jest-environment node */
/**
 * Risk R1 made executable: a DRAFT report is computed live and therefore moves
 * when an entry is edited or the rounding rule changes, while a CLOSED report is
 * rebuilt from its own freeze records and cannot move at all.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  StaffTimeEntry,
  StaffTimeProject,
  StaffTimeReport,
  StaffTimeReportEntry,
  StaffTimeTask,
} from '../../../data/entities'
import { buildReportSheet } from '../buildReportSheet'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn().mockResolvedValue([]),
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
}))

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'
const PROJECT_ID = 'project-1'
const REPORT_ID = 'report-1'

const labels = { unassignedTask: 'No task', unassignedPerson: 'Unassigned', nonbillableGroup: 'Non-billable time' }

function makeEm(rows: Map<unknown, Array<Record<string, unknown>>>): EntityManager {
  return {
    find: async (cls: unknown, where: Record<string, unknown>) => {
      const all = rows.get(cls) ?? []
      const ids = (where?.id as { $in?: string[] } | undefined)?.$in
      const entryIds = (where?.timeEntryId as { $in?: string[] } | undefined)?.$in
      return all.filter((row) => {
        if (ids && !ids.includes(row.id as string)) return false
        if (entryIds && !entryIds.includes(row.timeEntryId as string)) return false
        if (where?.status && row.status !== where.status) return false
        return true
      })
    },
  } as unknown as EntityManager
}

const project = {
  id: PROJECT_ID,
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  name: 'Nordvik — B2B',
  hourlyRate: '320.0000',
  currencyCode: 'PLN',
  deletedAt: null,
}

const liveEntry = {
  id: 'e1',
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  timeProjectId: PROJECT_ID,
  taskId: null,
  staffMemberId: null,
  date: new Date('2026-06-10T00:00:00.000Z'),
  durationMinutes: 600,
  roundedMinutes: 600,
  isBillable: true,
  rateOverrideAmount: null,
  notes: null,
  deletedAt: null,
}

function reportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    status: 'draft',
    grouping: 'project_task',
    nonbillableMode: 'separate',
    includeAlreadyReported: false,
    currencyCode: 'PLN',
    periodFrom: new Date('2026-06-01T00:00:00.000Z'),
    periodTo: new Date('2026-06-30T00:00:00.000Z'),
    ...overrides,
  } as unknown as StaffTimeReport
}

describe('buildReportSheet', () => {
  it('computes a draft live, at today rates and rounding', async () => {
    const em = makeEm(
      new Map<unknown, Array<Record<string, unknown>>>([
        [StaffTimeProject, [project]],
        [StaffTimeEntry, [liveEntry]],
        [StaffTimeTask, []],
        [StaffTimeReportEntry, []],
        [StaffTimeReport, []],
      ]),
    )

    const sheet = await buildReportSheet({
      em,
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      report: reportRow(),
      timeProjectIds: [PROJECT_ID],
      labels,
    })

    expect(sheet.isClosed).toBe(false)
    expect(sheet.totals.totalAmount).toBe(3200)
    expect(sheet.totals.billableMinutes).toBe(600)
    expect(sheet.currencyCode).toBe('PLN')
  })

  it('rebuilds a closed report from its own frozen values, ignoring today rate', async () => {
    const closed = reportRow({ status: 'closed', currencyCode: 'PLN' })
    const em = makeEm(
      new Map<unknown, Array<Record<string, unknown>>>([
        // The project rate has since been raised; the closed report must not move.
        [StaffTimeProject, [{ ...project, hourlyRate: '500.0000' }]],
        [StaffTimeEntry, [liveEntry]],
        [StaffTimeTask, []],
        [
          StaffTimeReportEntry,
          [
            {
              id: 'f1',
              reportId: REPORT_ID,
              timeEntryId: 'e1',
              tenantId: TENANT_ID,
              organizationId: ORG_ID,
              frozenRawMinutes: 600,
              frozenRoundedMinutes: 600,
              frozenRateAmount: '320.0000',
              frozenCurrencyCode: 'PLN',
              frozenAmount: '3200.00',
              frozenIsBillable: true,
            },
          ],
        ],
        [StaffTimeReport, [closed as unknown as Record<string, unknown>]],
      ]),
    )

    const sheet = await buildReportSheet({
      em,
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      report: closed,
      timeProjectIds: [PROJECT_ID],
      labels,
    })

    expect(sheet.isClosed).toBe(true)
    expect(sheet.totals.totalAmount).toBe(3200)
    expect(sheet.totals.alreadyReportedCount).toBe(0)
  })

  it('excludes from a closed report an entry logged into the period after it closed', async () => {
    const closed = reportRow({ status: 'closed' })
    const em = makeEm(
      new Map<unknown, Array<Record<string, unknown>>>([
        [StaffTimeProject, [project]],
        [StaffTimeEntry, [liveEntry, { ...liveEntry, id: 'e-new', durationMinutes: 60, roundedMinutes: 60 }]],
        [StaffTimeTask, []],
        [
          StaffTimeReportEntry,
          [
            {
              id: 'f1',
              reportId: REPORT_ID,
              timeEntryId: 'e1',
              tenantId: TENANT_ID,
              organizationId: ORG_ID,
              frozenRawMinutes: 600,
              frozenRoundedMinutes: 600,
              frozenRateAmount: '320.0000',
              frozenCurrencyCode: 'PLN',
              frozenAmount: '3200.00',
              frozenIsBillable: true,
            },
          ],
        ],
        [StaffTimeReport, [closed as unknown as Record<string, unknown>]],
      ]),
    )

    const sheet = await buildReportSheet({
      em,
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      report: closed,
      timeProjectIds: [PROJECT_ID],
      labels,
    })

    // Screen 15 note 2: new time on the same task is legitimate, and belongs to
    // the NEXT report, not retroactively to this closed one.
    expect(sheet.entries.map((entry) => entry.id)).toEqual(['e1'])
    expect(sheet.totals.totalAmount).toBe(3200)
  })

  it('re-groups without moving the grand total (D-7)', async () => {
    const em = makeEm(
      new Map<unknown, Array<Record<string, unknown>>>([
        [StaffTimeProject, [project]],
        [
          StaffTimeEntry,
          [
            liveEntry,
            { ...liveEntry, id: 'e2', staffMemberId: 'm2', date: new Date('2026-06-11T00:00:00.000Z'), durationMinutes: 665, roundedMinutes: 665 },
          ],
        ],
        [StaffTimeTask, []],
        [StaffTimeReportEntry, []],
        [StaffTimeReport, []],
      ]),
    )
    const base = {
      em,
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      report: reportRow(),
      timeProjectIds: [PROJECT_ID],
      labels,
    }

    const byTask = await buildReportSheet(base)
    const byPerson = await buildReportSheet({ ...base, grouping: 'project_person' })
    const byDay = await buildReportSheet({ ...base, grouping: 'project_day' })

    expect(byPerson.totals.totalAmount).toBe(byTask.totals.totalAmount)
    expect(byDay.totals.totalAmount).toBe(byTask.totals.totalAmount)
    expect(byDay.grouping).toBe('project_day')
  })

  /**
   * D-5: the opt-in lets a later report re-include an hour an earlier report
   * already froze, so one entry can carry a freeze record in two closed reports.
   * Each of them still has to render exactly what it froze.
   */
  describe('an hour two closed reports quote', () => {
    const LATER_REPORT_ID = 'report-2'

    function freezeRow(reportId: string, overrides: Record<string, unknown> = {}) {
      return {
        id: `freeze-${reportId}`,
        reportId,
        timeEntryId: 'e1',
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        frozenRawMinutes: 600,
        frozenRoundedMinutes: 600,
        frozenRateAmount: '320.0000',
        frozenCurrencyCode: 'PLN',
        frozenAmount: '3200.00',
        frozenIsBillable: true,
        ...overrides,
      }
    }

    const earlier = reportRow({
      status: 'closed',
      reference: 'RAP-2026-0041',
      closedAt: new Date('2026-07-01T10:00:00.000Z'),
    })
    const later = reportRow({
      id: LATER_REPORT_ID,
      status: 'closed',
      reference: 'RAP-2026-0042',
      includeAlreadyReported: true,
      closedAt: new Date('2026-07-05T10:00:00.000Z'),
    })

    function sharedEm(freezes: Array<Record<string, unknown>>, reports: StaffTimeReport[] = [earlier, later]) {
      return makeEm(
        new Map<unknown, Array<Record<string, unknown>>>([
          [StaffTimeProject, [project]],
          [StaffTimeEntry, [liveEntry]],
          [StaffTimeTask, []],
          [StaffTimeReportEntry, freezes],
          [StaffTimeReport, reports as unknown as Array<Record<string, unknown>>],
        ]),
      )
    }

    // The freeze rows come back in whatever order the database likes, so both orders are pinned.
    it.each([
      ['the earlier report’s record is read first', [freezeRow(REPORT_ID), freezeRow(LATER_REPORT_ID)]],
      ['the later report’s record is read first', [freezeRow(LATER_REPORT_ID), freezeRow(REPORT_ID)]],
    ])('keeps the hour on both sheets when %s', async (_label, freezes) => {
      const em = sharedEm(freezes)

      for (const closedReport of [earlier, later]) {
        const sheet = await buildReportSheet({
          em,
          scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
          report: closedReport,
          timeProjectIds: [PROJECT_ID],
          labels,
        })

        expect(sheet.entries.map((entry) => entry.id)).toEqual(['e1'])
        expect(sheet.entries[0].frozen?.reportId).toBe(closedReport.id)
        expect(sheet.totals.entryCount).toBe(1)
        expect(sheet.totals.billableMinutes).toBe(600)
        expect(sheet.totals.totalAmount).toBe(3200)
        expect(sheet.totals.alreadyReportedCount).toBe(0)
      }
    })

    it('renders each closed report from its own record, not the other report’s', async () => {
      const em = sharedEm([
        freezeRow(REPORT_ID),
        freezeRow(LATER_REPORT_ID, { frozenRoundedMinutes: 300, frozenAmount: '1600.00' }),
      ])
      const base = { em, scope: { tenantId: TENANT_ID, organizationId: ORG_ID }, timeProjectIds: [PROJECT_ID], labels }

      const earlierSheet = await buildReportSheet({ ...base, report: earlier })
      const laterSheet = await buildReportSheet({ ...base, report: later })

      expect(earlierSheet.totals.totalAmount).toBe(3200)
      expect(laterSheet.totals.totalAmount).toBe(1600)
      expect(laterSheet.totals.billableMinutes).toBe(300)
    })

    it.each([
      ['the earlier report’s record is read first', [freezeRow(REPORT_ID), freezeRow(LATER_REPORT_ID)]],
      ['the later report’s record is read first', [freezeRow(LATER_REPORT_ID), freezeRow(REPORT_ID)]],
    ])('names the report that closed first as the source for a new draft when %s', async (_label, freezes) => {
      const draft = reportRow({ id: 'report-3' })
      const sheet = await buildReportSheet({
        em: sharedEm(freezes, [earlier, later, draft]),
        scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
        report: draft,
        timeProjectIds: [PROJECT_ID],
        labels,
      })

      expect(sheet.totals.entryCount).toBe(0)
      expect(sheet.totals.alreadyReportedCount).toBe(1)
      expect(sheet.totals.alreadyReportedIn).toEqual([
        expect.objectContaining({ reportId: REPORT_ID, reference: 'RAP-2026-0041', entryCount: 1 }),
      ])
    })
  })
})
