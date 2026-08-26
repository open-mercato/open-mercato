/** @jest-environment node */
/**
 * Phase 6's money commands.
 *
 * These pin the four properties a client can dispute:
 *
 *  1. **The freeze records ARE the sheet.** Close writes one snapshot per entry
 *     the report covered, carrying the D-7 per-entry amount, and the frozen
 *     `total_amount` is the exact sum of those snapshots.
 *  2. **D-5 holds through the freeze.** An entry already locked by another
 *     report is skipped by default and, when the opt-in is set, is recorded at
 *     its FROZEN values without stealing the earlier report's lock.
 *  3. **R2 blocks before any amount exists.** A selection spanning two
 *     currencies is refused at create with both currencies and the offending
 *     project names in the body.
 *  4. **Unlock is explicit and audited.** It refuses a draft, demands a reason,
 *     clears the locks, removes the freeze records so those hours stop counting
 *     as already reported, and appends an `unlocked` event carrying the reason.
 */
import type { AwilixContainer } from 'awilix'

const mockEmitCrudSideEffects = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockEmitStaffEvent = jest.fn().mockResolvedValue(undefined)

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn((...args: unknown[]) => mockEmitCrudSideEffects(...args)),
    emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
}))

jest.mock('../../events', () => ({
  emitStaffEvent: (...args: unknown[]) => mockEmitStaffEvent(...args),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_PROJECT_ID = '44444444-4444-4444-8444-444444444445'
const REPORT_ID = '55555555-5555-4555-8555-555555555555'
const EARLIER_REPORT_ID = '66666666-6666-4666-8666-666666666666'

type Rows = Map<unknown, Array<Record<string, unknown>>>

type Entities = Awaited<typeof import('../../data/entities')>

type Loaded = {
  commands: Record<string, { execute: (input: unknown, ctx: unknown) => Promise<unknown> }>
  entities: Entities
}

async function load(): Promise<Loaded> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-reports')
  const entities = await import('../../data/entities')
  const ids = [
    'staff.timesheets.reports.create',
    'staff.timesheets.reports.update',
    'staff.timesheets.reports.delete',
    'staff.timesheets.reports.close',
    'staff.timesheets.reports.unlock',
  ]
  const commands: Loaded['commands'] = {}
  for (const id of ids) {
    commands[id] = commandRegistry.get(id) as Loaded['commands'][string]
  }
  return { commands, entities }
}

type FakeEm = {
  em: Record<string, jest.Mock>
  persisted: Array<{ cls: unknown; row: Record<string, unknown> }>
  removed: Array<Record<string, unknown>>
}

function makeEm(rows: Rows, options: { onCreate?: () => void } = {}): FakeEm {
  const persisted: FakeEm['persisted'] = []
  const removed: FakeEm['removed'] = []
  const em: Record<string, jest.Mock> = {
    fork: jest.fn(),
    find: jest.fn(async (cls: unknown, where: Record<string, unknown>) => {
      const all = rows.get(cls) ?? []
      return all.filter((row) => matches(row, where))
    }),
    findOne: jest.fn(async (cls: unknown, where: Record<string, unknown>) => {
      const all = rows.get(cls) ?? []
      return all.find((row) => matches(row, where)) ?? null
    }),
    count: jest.fn(async () => 0),
    create: jest.fn((cls: unknown, data: Record<string, unknown>) => {
      options.onCreate?.()
      const row = { id: `generated-${persisted.length + 1}`, ...data }
      return row
    }),
    persist: jest.fn((row: Record<string, unknown>) => {
      persisted.push({ cls: null, row })
      return em
    }),
    remove: jest.fn((row: Record<string, unknown>) => {
      removed.push(row)
      return em
    }),
    flush: jest.fn(async () => {}),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
  }
  em.fork.mockReturnValue(em)
  return { em, persisted, removed }
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(where ?? {})) {
    const actual = row[key]
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const clause = expected as Record<string, unknown>
      if (Array.isArray(clause.$in)) {
        if (!(clause.$in as unknown[]).includes(actual)) return false
        continue
      }
      if (typeof clause.$like === 'string') {
        const prefix = (clause.$like as string).replace(/%$/, '')
        if (typeof actual !== 'string' || !actual.startsWith(prefix)) return false
        continue
      }
      if (clause.$gte instanceof Date || clause.$lte instanceof Date) {
        const value = actual instanceof Date ? actual.getTime() : new Date(String(actual)).getTime()
        if (clause.$gte instanceof Date && value < clause.$gte.getTime()) return false
        if (clause.$lte instanceof Date && value > clause.$lte.getTime()) return false
        continue
      }
      continue
    }
    if (expected === null) {
      if (actual !== null && actual !== undefined) return false
      continue
    }
    if (actual !== expected) return false
  }
  return true
}

function createCtx(em: unknown) {
  return {
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return null
        // No moduleConfigService: the rounding snapshot falls back to its
        // documented default instead of failing the close.
        throw new Error('[internal] not registered')
      },
    } as unknown as AwilixContainer,
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: [ORG_ID],
  }
}

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    name: 'Nordvik — migracja B2B',
    customerId: CUSTOMER_ID,
    customerSnapshot: { name: 'Nordvik Retail AB' },
    hourlyRate: '320.0000',
    currencyCode: 'PLN',
    deletedAt: null,
    ...overrides,
  }
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    customerId: CUSTOMER_ID,
    customerSnapshot: { name: 'Nordvik Retail AB' },
    reference: 'RAP-2026-0042',
    title: 'Nordvik · June',
    periodKind: 'month',
    periodFrom: new Date('2026-06-01T00:00:00.000Z'),
    periodTo: new Date('2026-06-30T00:00:00.000Z'),
    currencyCode: 'PLN',
    grouping: 'project_task',
    nonbillableMode: 'separate',
    includeAlreadyReported: false,
    showRates: true,
    roundingUnitMinutes: 0,
    roundingDirection: 'up',
    status: 'draft',
    totalAmount: null,
    totalBillableMinutes: null,
    totalNonbillableMinutes: null,
    closedAt: null,
    closedByUserId: null,
    deletedAt: null,
    updatedAt: new Date('2026-06-30T00:00:00.000Z'),
    ...overrides,
  }
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    timeProjectId: PROJECT_ID,
    taskId: null,
    staffMemberId: 'member-1',
    date: new Date('2026-06-10T00:00:00.000Z'),
    durationMinutes: 665,
    roundedMinutes: 665,
    isBillable: true,
    rateOverrideAmount: null,
    notes: 'Refaktor',
    lockedReportId: null,
    lockedAt: null,
    deletedAt: null,
    updatedAt: new Date('2026-06-10T00:00:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockEmitCrudSideEffects.mockResolvedValue(undefined)
  mockFindWithDecryption.mockResolvedValue([])
  mockEmitStaffEvent.mockResolvedValue(undefined)
})

function broadcastPayload(eventId: string): Record<string, unknown> | undefined {
  const call = mockEmitStaffEvent.mock.calls.find(([id]) => id === eventId)
  return call?.[1] as Record<string, unknown> | undefined
}

describe('staff.timesheets.reports.create', () => {
  it('allocates the first RAP number of the year and snapshots the customer', async () => {
    const { commands, entities } = await load()
    const rows: Rows = new Map([
      [entities.StaffTimeProject, [project()]],
      [entities.StaffTimeReport, []],
      [entities.StaffTimeReportProject, []],
    ])
    const { em, persisted } = makeEm(rows)

    const result = (await commands['staff.timesheets.reports.create'].execute(
      {
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        customerId: CUSTOMER_ID,
        title: 'Nordvik · June',
        periodKind: 'month',
        periodFrom: '2026-06-01',
        periodTo: '2026-06-30',
        timeProjectIds: [PROJECT_ID],
      },
      createCtx(em),
    )) as { reportId: string }

    expect(result.reportId).toBeTruthy()
    const created = persisted.map((item) => item.row)
    const reportRow = created.find((row) => typeof row.reference === 'string')
    expect(reportRow?.reference).toBe(`RAP-${new Date().getFullYear()}-0001`)
    expect(reportRow?.currencyCode).toBe('PLN')
    expect(reportRow?.status).toBe('draft')
    // D-9: the customer travels as a snapshot, never as a join.
    expect(reportRow?.customerSnapshot).toEqual({ name: 'Nordvik Retail AB' })
    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.commit).toHaveBeenCalledTimes(1)
  })

  it('continues past the highest number ever handed out, deleted reports included', async () => {
    const { commands, entities } = await load()
    const year = new Date().getFullYear()
    const rows: Rows = new Map([
      [entities.StaffTimeProject, [project()]],
      [
        entities.StaffTimeReport,
        [
          report({ id: 'r-1', reference: `RAP-${year}-0007` }),
          // Soft-deleted: reissuing its number behind a PDF a client holds is
          // exactly what must not happen.
          report({ id: 'r-2', reference: `RAP-${year}-0009`, deletedAt: new Date() }),
        ],
      ],
      [entities.StaffTimeReportProject, []],
    ])
    const { em, persisted } = makeEm(rows)

    await commands['staff.timesheets.reports.create'].execute(
      {
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        customerId: CUSTOMER_ID,
        title: 'Nordvik · June',
        periodKind: 'month',
        periodFrom: '2026-06-01',
        periodTo: '2026-06-30',
        timeProjectIds: [PROJECT_ID],
      },
      createCtx(em),
    )

    const reference = persisted.map((item) => item.row).find((row) => typeof row.reference === 'string')?.reference
    expect(reference).toBe(`RAP-${year}-0010`)
  })

  it('refuses a mixed-currency selection and names both currencies and projects (R2)', async () => {
    const { commands, entities } = await load()
    const rows: Rows = new Map([
      [
        entities.StaffTimeProject,
        [project(), project({ id: OTHER_PROJECT_ID, name: 'Nordvik — EU', currencyCode: 'EUR' })],
      ],
      [entities.StaffTimeReport, []],
      [entities.StaffTimeReportProject, []],
    ])
    const { em, persisted } = makeEm(rows)

    await expect(
      commands['staff.timesheets.reports.create'].execute(
        {
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          customerId: CUSTOMER_ID,
          title: 'Nordvik',
          periodKind: 'month',
          periodFrom: '2026-06-01',
          periodTo: '2026-06-30',
          timeProjectIds: [PROJECT_ID, OTHER_PROJECT_ID],
        },
        createCtx(em),
      ),
    ).rejects.toMatchObject({
      status: 422,
      body: expect.objectContaining({
        code: 'report_currency_conflict',
        currencies: ['EUR', 'PLN'],
      }),
    })
    // Nothing was written — the refusal lands before a report exists.
    expect(persisted).toHaveLength(0)
  })

  it('refuses a project belonging to a different customer', async () => {
    const { commands, entities } = await load()
    const rows: Rows = new Map([
      [entities.StaffTimeProject, [project({ customerId: 'someone-else', name: 'Ambra — retainer' })]],
      [entities.StaffTimeReport, []],
      [entities.StaffTimeReportProject, []],
    ])
    const { em } = makeEm(rows)

    await expect(
      commands['staff.timesheets.reports.create'].execute(
        {
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          customerId: CUSTOMER_ID,
          title: 'Nordvik',
          periodKind: 'month',
          periodFrom: '2026-06-01',
          periodTo: '2026-06-30',
          timeProjectIds: [PROJECT_ID],
        },
        createCtx(em),
      ),
    ).rejects.toMatchObject({
      status: 422,
      body: expect.objectContaining({
        code: 'report_project_customer_mismatch',
        offenders: ['Ambra — retainer'],
      }),
    })
  })
})

describe('staff.timesheets.reports.close (US-G3)', () => {
  function closeFixture(entries: Array<Record<string, unknown>>, reportOverrides: Record<string, unknown> = {}) {
    return async () => {
      const { commands, entities } = await load()
      const reportRow = report(reportOverrides)
      const rows: Rows = new Map([
        [entities.StaffTimeReport, [reportRow]],
        [entities.StaffTimeReportProject, [{ reportId: REPORT_ID, timeProjectId: PROJECT_ID, tenantId: TENANT_ID, organizationId: ORG_ID }]],
        [entities.StaffTimeProject, [project()]],
        [entities.StaffTimeEntry, entries],
        [entities.StaffTimeTask, []],
        [entities.StaffTimeReportEntry, []],
      ])
      const fake = makeEm(rows)
      return { commands, entities, reportRow, rows, ...fake }
    }
  }

  it('freezes one snapshot per entry at the D-7 amount, locks them, and totals exactly', async () => {
    const { commands, entities, reportRow, em, persisted } = await closeFixture([
      entry({ id: 'e1', durationMinutes: 665, roundedMinutes: 665 }),
      entry({ id: 'e2', durationMinutes: 665, roundedMinutes: 665 }),
      entry({ id: 'e3', durationMinutes: 665, roundedMinutes: 665 }),
    ])()

    const result = (await commands['staff.timesheets.reports.close'].execute(
      { id: REPORT_ID },
      createCtx(em),
    )) as { lockedEntryCount: number; totalAmount: number }

    const freezes = persisted
      .map((item) => item.row)
      .filter((row) => typeof row.timeEntryId === 'string')
    expect(freezes).toHaveLength(3)
    // 665 min at 320/h rounds to 3546.67 per entry; the total is their exact sum
    // and is therefore 10 640.01, not the 10 640.00 a sum-then-round would give.
    expect(freezes.every((row) => row.frozenAmount === '3546.67')).toBe(true)
    expect(freezes.every((row) => row.frozenRoundedMinutes === 665)).toBe(true)
    expect(freezes.every((row) => row.frozenCurrencyCode === 'PLN')).toBe(true)
    expect(result.totalAmount).toBe(10640.01)
    expect(reportRow.totalAmount).toBe('10640.01')
    expect(reportRow.totalBillableMinutes).toBe(1995)
    expect(reportRow.status).toBe('closed')
    expect(reportRow.closedByUserId).toBe('user-1')
    expect(result.lockedEntryCount).toBe(3)

    // One transaction for the whole freeze.
    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.rollback).not.toHaveBeenCalled()

    const events = persisted.map((item) => item.row).filter((row) => row.eventType === 'closed')
    expect(events).toHaveLength(1)
    expect(events[0].metadata).toMatchObject({ frozenEntryCount: 3, lockedEntryCount: 3, totalAmount: 10640.01 })
    expect(entities.StaffTimeReportEntry).toBeTruthy()
  })

  it('stamps locked_report_id on the entries it froze', async () => {
    const rows = [entry({ id: 'e1' })]
    const { commands, em } = await closeFixture(rows)()
    await commands['staff.timesheets.reports.close'].execute({ id: REPORT_ID }, createCtx(em))
    expect(rows[0].lockedReportId).toBe(REPORT_ID)
    expect(rows[0].lockedAt).toBeInstanceOf(Date)
  })

  it('excludes an hour already frozen elsewhere, so it cannot reach a second invoice (D-5)', async () => {
    const { commands, entities } = await load()
    const reportRow = report()
    const alreadyBilled = entry({ id: 'e-billed', lockedReportId: EARLIER_REPORT_ID })
    const fresh = entry({ id: 'e-fresh' })
    const rows: Rows = new Map([
      [
        entities.StaffTimeReport,
        [reportRow, report({ id: EARLIER_REPORT_ID, reference: 'RAP-2026-0041', status: 'closed' })],
      ],
      [entities.StaffTimeReportProject, [{ reportId: REPORT_ID, timeProjectId: PROJECT_ID, tenantId: TENANT_ID, organizationId: ORG_ID }]],
      [entities.StaffTimeProject, [project()]],
      [entities.StaffTimeEntry, [alreadyBilled, fresh]],
      [entities.StaffTimeTask, []],
      [
        entities.StaffTimeReportEntry,
        [
          {
            reportId: EARLIER_REPORT_ID,
            timeEntryId: 'e-billed',
            tenantId: TENANT_ID,
            organizationId: ORG_ID,
            frozenRawMinutes: 665,
            frozenRoundedMinutes: 660,
            frozenRateAmount: '300.0000',
            frozenCurrencyCode: 'PLN',
            frozenAmount: '3300.00',
            frozenIsBillable: true,
          },
        ],
      ],
    ])
    const { em, persisted } = makeEm(rows)

    await commands['staff.timesheets.reports.close'].execute({ id: REPORT_ID }, createCtx(em))

    const freezes = persisted.map((item) => item.row).filter((row) => typeof row.timeEntryId === 'string')
    expect(freezes.map((row) => row.timeEntryId)).toEqual(['e-fresh'])
    // The earlier report keeps its lock.
    expect(alreadyBilled.lockedReportId).toBe(EARLIER_REPORT_ID)
  })

  it('records a re-included hour at its frozen values and does not steal the earlier lock', async () => {
    const { commands, entities } = await load()
    const reportRow = report({ includeAlreadyReported: true })
    const alreadyBilled = entry({ id: 'e-billed', lockedReportId: EARLIER_REPORT_ID })
    const rows: Rows = new Map([
      [
        entities.StaffTimeReport,
        [reportRow, report({ id: EARLIER_REPORT_ID, reference: 'RAP-2026-0041', status: 'closed' })],
      ],
      [entities.StaffTimeReportProject, [{ reportId: REPORT_ID, timeProjectId: PROJECT_ID, tenantId: TENANT_ID, organizationId: ORG_ID }]],
      [entities.StaffTimeProject, [project()]],
      [entities.StaffTimeEntry, [alreadyBilled]],
      [entities.StaffTimeTask, []],
      [
        entities.StaffTimeReportEntry,
        [
          {
            reportId: EARLIER_REPORT_ID,
            timeEntryId: 'e-billed',
            tenantId: TENANT_ID,
            organizationId: ORG_ID,
            frozenRawMinutes: 665,
            frozenRoundedMinutes: 660,
            frozenRateAmount: '300.0000',
            frozenCurrencyCode: 'PLN',
            frozenAmount: '3300.00',
            frozenIsBillable: true,
          },
        ],
      ],
    ])
    const { em, persisted } = makeEm(rows)

    const result = (await commands['staff.timesheets.reports.close'].execute(
      { id: REPORT_ID },
      createCtx(em),
    )) as { lockedEntryCount: number; totalAmount: number }

    const freeze = persisted.map((item) => item.row).find((row) => row.timeEntryId === 'e-billed')
    // Frozen at 660 min × 300, not recomputed as 665 × 320.
    expect(freeze?.frozenRoundedMinutes).toBe(660)
    expect(freeze?.frozenAmount).toBe('3300.00')
    expect(result.totalAmount).toBe(3300)
    // Ownership of the lock stays with the report that froze it first.
    expect(alreadyBilled.lockedReportId).toBe(EARLIER_REPORT_ID)
    expect(result.lockedEntryCount).toBe(0)
  })

  it('refuses to close a report that covers nothing rather than freezing a zero', async () => {
    const { commands, em, persisted } = await closeFixture([])()
    await expect(
      commands['staff.timesheets.reports.close'].execute({ id: REPORT_ID }, createCtx(em)),
    ).rejects.toMatchObject({ status: 422, body: expect.objectContaining({ code: 'report_empty' }) })
    expect(persisted).toHaveLength(0)
    expect(em.rollback).toHaveBeenCalled()
  })

  it('refuses to close an already closed report', async () => {
    const { commands, em } = await closeFixture([entry()], { status: 'closed' })()
    await expect(
      commands['staff.timesheets.reports.close'].execute({ id: REPORT_ID }, createCtx(em)),
    ).rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'report_closed' }) })
  })

  it('never reaches outside the caller tenant', async () => {
    const { commands, entities } = await load()
    const rows: Rows = new Map([[entities.StaffTimeReport, [report({ tenantId: 'other-tenant' })]]])
    const { em } = makeEm(rows)
    await expect(
      commands['staff.timesheets.reports.close'].execute({ id: REPORT_ID }, createCtx(em)),
    ).rejects.toMatchObject({ status: 404 })
  })

  /**
   * M-1. The close broadcast reaches every browser in the organization with no
   * feature check. Money was already withheld; the customer identity is too — it is
   * the one field that says which client was billed, and nothing subscribes to it
   * (both in-repo subscribers re-read the report from the database).
   */
  it('broadcasts the close without the amount or the customer identity', async () => {
    const { commands, em } = await closeFixture([entry()])()

    await commands['staff.timesheets.reports.close'].execute({ id: REPORT_ID }, createCtx(em))

    const payload = broadcastPayload('staff.timesheets.time_report.closed')
    expect(payload).toMatchObject({ id: REPORT_ID, tenantId: TENANT_ID, reference: 'RAP-2026-0042' })
    expect(payload).not.toHaveProperty('customerId')
    expect(payload).not.toHaveProperty('totalAmount')
    expect(JSON.stringify(payload)).not.toContain(CUSTOMER_ID)
  })
})

describe('staff.timesheets.reports.unlock (US-G3)', () => {
  async function unlockFixture(statusValue: 'draft' | 'closed' = 'closed') {
    const { commands, entities } = await load()
    const reportRow = report({
      status: statusValue,
      totalAmount: '10640.01',
      totalBillableMinutes: 1995,
      closedAt: new Date('2026-07-20T16:40:00.000Z'),
      closedByUserId: 'user-1',
    })
    const locked = [
      entry({ id: 'e1', lockedReportId: REPORT_ID, lockedAt: new Date() }),
      entry({ id: 'e2', lockedReportId: REPORT_ID, lockedAt: new Date() }),
    ]
    const freezes = [
      { id: 'f1', reportId: REPORT_ID, timeEntryId: 'e1', tenantId: TENANT_ID, organizationId: ORG_ID },
      { id: 'f2', reportId: REPORT_ID, timeEntryId: 'e2', tenantId: TENANT_ID, organizationId: ORG_ID },
    ]
    const rows: Rows = new Map([
      [entities.StaffTimeReport, [reportRow]],
      [entities.StaffTimeReportEntry, freezes],
      [entities.StaffTimeEntry, locked],
      [entities.StaffTimeReportProject, []],
    ])
    return { commands, reportRow, locked, freezes, ...makeEm(rows) }
  }

  it('clears the locks, removes the freeze records and returns the report to draft', async () => {
    const { commands, reportRow, locked, freezes, em, persisted, removed } = await unlockFixture()

    const result = (await commands['staff.timesheets.reports.unlock'].execute(
      { id: REPORT_ID, reason: 'Klient zakwestionował 4 h na refaktorze.' },
      createCtx(em),
    )) as { unlockedEntryCount: number }

    expect(result.unlockedEntryCount).toBe(2)
    expect(locked.every((row) => row.lockedReportId === null && row.lockedAt === null)).toBe(true)
    // The freeze records go, so those hours stop counting as already reported.
    expect(removed).toEqual(expect.arrayContaining(freezes))
    expect(reportRow.status).toBe('draft')
    expect(reportRow.closedAt).toBeNull()
    expect(reportRow.totalAmount).toBeNull()
    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.commit).toHaveBeenCalledTimes(1)

    const event = persisted.map((item) => item.row).find((row) => row.eventType === 'unlocked')
    expect(event?.reason).toBe('Klient zakwestionował 4 h na refaktorze.')
    expect(event?.actorUserId).toBe('user-1')
    // What was frozen survives in the audit even though the records are gone.
    expect(event?.metadata).toMatchObject({
      unlockedEntryCount: 2,
      frozenEntryCount: 2,
      frozenTotalAmount: '10640.01',
    })
  })

  it('refuses a draft report — there is nothing to unlock', async () => {
    const { commands, em } = await unlockFixture('draft')
    await expect(
      commands['staff.timesheets.reports.unlock'].execute({ id: REPORT_ID, reason: 'why' }, createCtx(em)),
    ).rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'report_not_closed' }) })
  })

  it('refuses an empty reason at the schema boundary', async () => {
    const { commands, em } = await unlockFixture()
    await expect(
      commands['staff.timesheets.reports.unlock'].execute({ id: REPORT_ID, reason: '   ' }, createCtx(em)),
    ).rejects.toThrow()
  })

  /**
   * M-1. `time_report.unlocked` is `clientBroadcast: true` and the DOM Event Bridge
   * filters on tenant + organization with no feature check, so the mandatory unlock
   * justification — free operator prose about a client's billing — must not be on
   * the wire. It stays on the audit row, which is read behind the ACL.
   */
  it('broadcasts the unlock without the operator justification', async () => {
    const { commands, em } = await unlockFixture()
    const reason = 'Klient zakwestionował 4 h na refaktorze.'

    await commands['staff.timesheets.reports.unlock'].execute({ id: REPORT_ID, reason }, createCtx(em))

    const payload = broadcastPayload('staff.timesheets.time_report.unlocked')
    expect(payload).toMatchObject({ id: REPORT_ID, tenantId: TENANT_ID, unlockedEntryCount: 2 })
    expect(payload).not.toHaveProperty('reason')
    expect(JSON.stringify(payload)).not.toContain('refaktorze')
  })
})

describe('a closed report is immutable', () => {
  async function closedReportEm() {
    const { commands, entities } = await load()
    const rows: Rows = new Map([
      [entities.StaffTimeReport, [report({ status: 'closed' })]],
      [entities.StaffTimeReportProject, []],
      [entities.StaffTimeProject, [project()]],
    ])
    return { commands, ...makeEm(rows) }
  }

  it('refuses an update', async () => {
    const { commands, em } = await closedReportEm()
    await expect(
      commands['staff.timesheets.reports.update'].execute({ id: REPORT_ID, title: 'Renamed' }, createCtx(em)),
    ).rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'report_closed' }) })
  })

  it('refuses a delete, which would strand the entries it froze', async () => {
    const { commands, em } = await closedReportEm()
    await expect(
      commands['staff.timesheets.reports.delete'].execute({ id: REPORT_ID }, createCtx(em)),
    ).rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'report_closed' }) })
  })
})
