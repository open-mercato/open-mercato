/** @jest-environment node */
// EP-15 / EP-16 — the task-context and report enricher hosts, and the query-engine
// surface every staff enricher is published on.
//
// Two properties are worth pinning beyond the field list. Money (`hourlyRate`,
// `totalAmount`) is ADDED for a holder of `staff.timesheets.rates.view` and absent
// for everyone else — never blanked — which is the module-wide rule. And the
// query-engine aliases must carry the DOT form of the entity id: the CRUD factory
// looks an enricher up by the colon form its route declares, while the query engine
// looks it up by `entityIdToEventEntity(entity)`, so an enricher published only under
// the colon form silently never runs in a query pipeline.

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: jest.fn(async () => null),
}))

import type { EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { enrichers } from '../enrichers'
import {
  StaffTimeProject,
  StaffTimeReport,
  StaffTimeReportEntry,
  StaffTimeReportEvent,
  StaffTimeTask,
  StaffTimeTaskStatus,
} from '../entities'

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'
const USER_ID = 'user-1'
const TASK_ID = 'task-1'
const PROJECT_ID = 'project-1'
const STATUS_ID = 'status-1'
const MEMBER_ID = 'member-1'
const REPORT_ID = 'report-1'

const taskContextEnricher = enrichers.find((enricher) => enricher.id === 'staff.timesheets-tasks-context')!
const reportEnricher = enrichers.find((enricher) => enricher.id === 'staff.timesheets-reports')!

type World = Map<unknown, unknown[]>

function context(world: World, canSeeRates: boolean): EnricherContext {
  const em = {
    fork: () => em,
    find: async (cls: unknown) => world.get(cls) ?? [],
  }
  return {
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    userId: USER_ID,
    em,
    container: {
      resolve: (name: string) => {
        if (name === 'rbacService') {
          return {
            userHasAllFeatures: async (_userId: string, features: string[]) =>
              canSeeRates && features.includes('staff.timesheets.rates.view'),
          }
        }
        return undefined
      },
    },
  } as unknown as EnricherContext
}

describe('staff.timesheets-tasks-context enricher', () => {
  const world: World = new Map([
    [
      StaffTimeTask,
      [
        {
          id: TASK_ID,
          timeProjectId: PROJECT_ID,
          taskStatusId: STATUS_ID,
          assigneeStaffMemberId: MEMBER_ID,
        },
      ],
    ],
    [
      StaffTimeProject,
      [{ id: PROJECT_ID, name: 'Cart migration', code: 'CART', color: '#123456', hourlyRate: '320.0000', currencyCode: 'PLN' }],
    ],
    [StaffTimeTaskStatus, [{ id: STATUS_ID, name: 'In review', isDone: false }]],
  ])

  beforeEach(() => {
    ;(findWithDecryption as jest.Mock).mockResolvedValue([{ id: MEMBER_ID, displayName: 'Ada L.' }])
  })

  it('targets the task entity', () => {
    expect(taskContextEnricher.targetEntity).toBe('staff:staff_time_task')
  })

  it('names the project, the column and the assignee in one namespaced block', async () => {
    const [row] = await taskContextEnricher.enrichMany!([{ id: TASK_ID }], context(world, false))

    expect(row._staff).toEqual({
      projectName: 'Cart migration',
      projectCode: 'CART',
      projectColor: '#123456',
      statusName: 'In review',
      statusIsDone: false,
      assigneeName: 'Ada L.',
    })
  })

  it('adds the project rate only for a holder of staff.timesheets.rates.view', async () => {
    const [row] = await taskContextEnricher.enrichMany!([{ id: TASK_ID }], context(world, true))

    expect(row._staff).toMatchObject({ hourlyRate: 320, currencyCode: 'PLN' })
  })

  it('answers with the empty block for a row the page no longer resolves', async () => {
    const [row] = await taskContextEnricher.enrichMany!([{ id: 'missing' }], context(world, true))

    expect(row._staff.projectName).toBeNull()
    expect(row._staff).not.toHaveProperty('hourlyRate')
  })
})

describe('staff.timesheets-reports enricher', () => {
  const closedAt = new Date('2026-08-01T10:00:00.000Z')
  const exportedAt = new Date('2026-08-02T09:00:00.000Z')
  const world: World = new Map([
    [
      StaffTimeReport,
      [
        {
          id: REPORT_ID,
          status: 'closed',
          closedAt,
          totalBillableMinutes: 480,
          totalNonbillableMinutes: 60,
          totalAmount: '2560.00',
          currencyCode: 'PLN',
        },
      ],
    ],
    [
      StaffTimeReportEntry,
      [{ reportId: REPORT_ID }, { reportId: REPORT_ID }, { reportId: REPORT_ID }],
    ],
    [
      StaffTimeReportEvent,
      [
        { reportId: REPORT_ID, createdAt: exportedAt, metadata: { format: 'pdf' } },
        { reportId: REPORT_ID, createdAt: new Date('2026-08-01T11:00:00.000Z'), metadata: { format: 'csv' } },
      ],
    ],
  ])

  it('targets the report entity', () => {
    expect(reportEnricher.targetEntity).toBe('staff:staff_time_report')
  })

  it('publishes the freeze state, the frozen entry count and the export history', async () => {
    const [row] = await reportEnricher.enrichMany!([{ id: REPORT_ID }], context(world, false))

    expect(row._staff).toEqual({
      isClosed: true,
      closedAt: closedAt.toISOString(),
      billableMinutes: 480,
      nonbillableMinutes: 60,
      totalMinutes: 540,
      lockedEntryCount: 3,
      exportCount: 2,
      lastExportedAt: exportedAt.toISOString(),
      lastExportFormat: 'pdf',
    })
  })

  it('adds the amount only for a holder of staff.timesheets.rates.view', async () => {
    const [row] = await reportEnricher.enrichMany!([{ id: REPORT_ID }], context(world, true))

    expect(row._staff).toMatchObject({ totalAmount: 2560, currencyCode: 'PLN' })
  })
})

describe('query-engine surface', () => {
  const apiIds = [
    'staff.timesheets-projects-portfolio',
    'staff.timesheets-tasks-rollup',
    'staff.timesheets-tasks-tags',
    'staff.timesheets-tasks-context',
    'staff.timesheets-time-entries',
    'staff.timesheets-reports',
  ]

  it('publishes exactly one query-engine alias per API enricher', () => {
    const aliases = enrichers.filter((enricher) => enricher.queryEngine?.enabled === true)

    expect(aliases.map((enricher) => enricher.id).sort()).toEqual(
      apiIds.map((id) => `${id}.query-engine`).sort(),
    )
  })

  it('targets the dot form the query pipeline looks enrichers up by', () => {
    for (const enricher of enrichers.filter((entry) => entry.queryEngine?.enabled === true)) {
      expect(enricher.targetEntity).not.toContain(':')
      expect(enricher.targetEntity.startsWith('staff.')).toBe(true)
    }
  })

  it('leaves the API-surface enrichers opted out, so nothing runs twice', () => {
    for (const id of apiIds) {
      expect(enrichers.find((enricher) => enricher.id === id)!.queryEngine).toBeUndefined()
    }
  })
})
