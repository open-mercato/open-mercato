/** @jest-environment node */
// T4.9 — the three time fields of an update: `durationMinutes`, `startedAt` and
// `endedAt`.
//
// The defect this file exists to keep fixed: `staffTimeEntryUpdateSchema` did not
// accept the two clocks, so zod stripped them and correcting a start or an end
// reported success and changed nothing. A silent no-op is worse than a disabled
// field, because there is nothing for the user to notice.
//
// What is pinned beyond "the keys arrive" is the consistency rule, because a
// duration that contradicts its span is a defensible-invoice problem (D-7 bills
// the rounded twin of whatever duration lands here):
//
//   the clocks are the observation and the duration is their summary, so the
//   clocks win — unless the duration is the field the request actually pinned,
//   in which case the untouched clock moves to match it.
//
// Plus D-8: an end whose clock precedes its start is a midnight crossing, so
// `ended_at` lands on the next calendar day and `date` still names the day the
// work started.
import type { AwilixContainer } from 'awilix'

const mockResolveProjectAccess = jest.fn()
const mockGetStaffMemberByUserId = jest.fn()

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
    emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async (em: { find: Function }, cls: unknown, where: unknown) => em.find(cls, where)),
  findOneWithDecryption: jest.fn(async (em: { findOne: Function }, cls: unknown, where: unknown) =>
    em.findOne(cls, where),
  ),
}))

jest.mock('../../lib/time-tracking/access', () => {
  const actual = jest.requireActual('../../lib/time-tracking/access')
  return {
    ...actual,
    resolveProjectAccess: jest.fn((...args: unknown[]) => mockResolveProjectAccess(...args)),
  }
})

jest.mock('../../lib/staffMemberResolver', () => ({
  getStaffMemberByUserId: jest.fn((...args: unknown[]) => mockGetStaffMemberByUserId(...args)),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT_ID = '11111111-1111-4111-8111-1111111111ff'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const STAFF_MEMBER_ID = '44444444-4444-4444-8444-444444444444'
const PROJECT_ID = '55555555-5555-4555-8555-555555555555'
const ENTRY_ID = '77777777-7777-4777-8777-777777777777'

const DAY = '2026-07-01'
const AT = (clock: string, day: string = DAY) => new Date(`${day}T${clock}:00.000Z`)

type ProjectRow = {
  id: string
  tenantId: string
  organizationId: string
  currencyCode: string | null
  hourlyRate: string | null
  billableByDefault: boolean
  deletedAt: Date | null
}

type EntryRow = Record<string, unknown> & {
  id: string
  tenantId: string
  organizationId: string
  staffMemberId: string
  durationMinutes: number
  roundedMinutes: number | null
  startedAt: Date | null
  endedAt: Date | null
  date: Date
}

type Entities = {
  StaffTimeEntry: unknown
  StaffTimeProject: unknown
  StaffTimeTask: unknown
}

type UpdateCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
  prepare?: (input: unknown, ctx: unknown) => Promise<Record<string, unknown>>
  buildLog?: (args: {
    snapshots: Record<string, unknown>
    ctx: unknown
  }) => Promise<{ changes?: Record<string, { from: unknown; to: unknown }> } | null>
}

type Loaded = {
  update: UpdateCommand
  entities: Entities
  roundMinutes: (raw: number, settings: { unitMinutes: 0 | 5 | 10 | 15; direction: 'up' | 'nearest' }) => number
}

async function loadCommands(): Promise<Loaded> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-entries')
  const entities = await import('../../data/entities')
  const rounding = await import('../../lib/time-tracking/rounding')
  return {
    update: commandRegistry.get('staff.timesheets.time_entries.update') as UpdateCommand,
    entities: {
      StaffTimeEntry: entities.StaffTimeEntry,
      StaffTimeProject: entities.StaffTimeProject,
      StaffTimeTask: entities.StaffTimeTask,
    },
    roundMinutes: rounding.roundMinutes,
  }
}

function projectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: PROJECT_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    currencyCode: 'PLN',
    hourlyRate: '320.0000',
    billableByDefault: true,
    deletedAt: null,
    ...overrides,
  }
}

/** 09:00 → 10:00 on 2026-07-01, sixty raw minutes, sixty rounded. */
function entryRow(overrides: Partial<EntryRow> = {}): EntryRow {
  return {
    id: ENTRY_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    staffMemberId: STAFF_MEMBER_ID,
    date: AT('00:00'),
    durationMinutes: 60,
    roundedMinutes: 60,
    startedAt: AT('09:00'),
    endedAt: AT('10:00'),
    notes: 'Original note',
    timeProjectId: PROJECT_ID,
    taskId: null,
    customerId: null,
    dealId: null,
    orderId: null,
    isBillable: true,
    rateOverrideAmount: null,
    rateCurrencyCode: 'PLN',
    lockedReportId: null,
    source: 'manual',
    createdAt: AT('00:00'),
    updatedAt: AT('00:00'),
    deletedAt: null,
    ...overrides,
  }
}

type World = {
  projects: ProjectRow[]
  entries: EntryRow[]
}

function matchesScope(row: { tenantId: string; organizationId: string }, where: Record<string, unknown>): boolean {
  if (where.tenantId !== undefined && where.tenantId !== null && row.tenantId !== where.tenantId) return false
  if (
    where.organizationId !== undefined &&
    where.organizationId !== null &&
    row.organizationId !== where.organizationId
  ) {
    return false
  }
  return true
}

function makeEm(world: World, entities: Entities) {
  const em: Record<string, jest.Mock> = {
    fork: jest.fn(),
    findOne: jest.fn(async (cls: unknown, where: Record<string, unknown>) => {
      if (cls === entities.StaffTimeProject) {
        return world.projects.find((row) => row.id === where.id && !row.deletedAt && matchesScope(row, where)) ?? null
      }
      if (cls === entities.StaffTimeEntry) {
        return (
          world.entries.find((row) => row.id === where.id && !row.deletedAt && matchesScope(row, where)) ?? null
        )
      }
      return null
    }),
    find: jest.fn(async () => []),
    create: jest.fn((_cls: unknown, data: Record<string, unknown>) => data),
    persist: jest.fn(),
    flush: jest.fn(async () => {}),
  }
  em.fork.mockReturnValue(em)
  return em
}

function makeCtx(em: unknown, settings: Record<string, unknown> = {}) {
  const configService = {
    getRecord: async (_moduleId: string, name: string) =>
      Object.prototype.hasOwnProperty.call(settings, name) ? { value: settings[name] } : null,
  }
  return {
    auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID },
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return null
        if (name === 'moduleConfigService') return configService
        if (name === 'commandBus') return { execute: jest.fn(async () => ({ result: { tagIds: [] } })) }
        if (name === 'rbacService') {
          return { userHasAllFeatures: async () => true, getGrantedFeatures: async () => [] }
        }
        return null
      },
    } as unknown as AwilixContainer,
    selectedOrganizationId: null,
    organizationScope: null,
    organizationIds: null,
  }
}

const MANAGES_ALL_PROJECTS = { canManageAll: true, projectIds: [], staffMemberId: STAFF_MEMBER_ID }
const ROUND_UP_QUARTER_HOUR = { 'rounding.unitMinutes': 15, 'rounding.direction': 'up' }

async function runUpdate(
  entry: EntryRow,
  input: Record<string, unknown>,
  settings: Record<string, unknown> = {},
): Promise<void> {
  const { update, entities } = await loadCommands()
  const world: World = { projects: [projectRow()], entries: [entry] }
  const em = makeEm(world, entities)
  await update.execute({ id: ENTRY_ID, ...input }, makeCtx(em, settings))
}

describe('staff timesheets time-entry interval updates (T4.9)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveProjectAccess.mockResolvedValue(MANAGES_ALL_PROJECTS)
    mockGetStaffMemberByUserId.mockResolvedValue({ id: STAFF_MEMBER_ID })
  })

  describe('the keys reach the row at all', () => {
    it('persists a start sent on its own instead of silently dropping it', async () => {
      const entry = entryRow()

      await runUpdate(entry, { startedAt: AT('08:00').toISOString() })

      expect(entry.startedAt?.toISOString()).toBe(AT('08:00').toISOString())
    })

    it('persists an end sent on its own', async () => {
      const entry = entryRow()

      await runUpdate(entry, { endedAt: AT('11:30').toISOString() })

      expect(entry.endedAt?.toISOString()).toBe(AT('11:30').toISOString())
    })

    it('clears a clock that is explicitly sent as null', async () => {
      const entry = entryRow()

      await runUpdate(entry, { endedAt: null })

      expect(entry.endedAt).toBeNull()
      // With one side gone there is nothing left for the duration to contradict,
      // so the stored minutes stand.
      expect(entry.durationMinutes).toBe(60)
    })
  })

  describe('the consistency rule', () => {
    it('recomputes the duration from both clocks, treating a duration sent with them as advisory', async () => {
      const entry = entryRow()

      await runUpdate(entry, {
        startedAt: AT('09:00').toISOString(),
        endedAt: AT('10:00').toISOString(),
        // What the entry dialog sends when its own arithmetic has gone stale.
        durationMinutes: 120,
      })

      expect(entry.durationMinutes).toBe(60)
      expect(entry.startedAt?.toISOString()).toBe(AT('09:00').toISOString())
      expect(entry.endedAt?.toISOString()).toBe(AT('10:00').toISOString())
    })

    it('restates the duration against the stored counterpart when one clock moves', async () => {
      const entry = entryRow()

      await runUpdate(entry, { startedAt: AT('08:00').toISOString() })

      expect(entry.durationMinutes).toBe(120)
    })

    it('derives the other clock when one clock arrives with a duration', async () => {
      const entry = entryRow()

      await runUpdate(entry, { startedAt: AT('08:00').toISOString(), durationMinutes: 60 })

      expect(entry.startedAt?.toISOString()).toBe(AT('08:00').toISOString())
      expect(entry.endedAt?.toISOString()).toBe(AT('09:00').toISOString())
      expect(entry.durationMinutes).toBe(60)
    })

    it('walks the start back when the END arrives with a duration', async () => {
      const entry = entryRow()

      await runUpdate(entry, { endedAt: AT('12:00').toISOString(), durationMinutes: 30 })

      expect(entry.startedAt?.toISOString()).toBe(AT('11:30').toISOString())
      expect(entry.endedAt?.toISOString()).toBe(AT('12:00').toISOString())
      expect(entry.durationMinutes).toBe(30)
    })

    it('shifts the end and anchors the start when only a duration is sent', async () => {
      const entry = entryRow()

      await runUpdate(entry, { durationMinutes: 90 })

      expect(entry.startedAt?.toISOString()).toBe(AT('09:00').toISOString())
      expect(entry.endedAt?.toISOString()).toBe(AT('10:30').toISOString())
      expect(entry.durationMinutes).toBe(90)
    })

    it('never manufactures the missing clock — a duration edit does not stop a running timer', async () => {
      const entry = entryRow({ endedAt: null, durationMinutes: 0, roundedMinutes: 0 })

      await runUpdate(entry, { durationMinutes: 90 })

      expect(entry.endedAt).toBeNull()
      expect(entry.startedAt?.toISOString()).toBe(AT('09:00').toISOString())
      expect(entry.durationMinutes).toBe(90)
    })

    it('leaves a lone start alone when it moves with no counterpart to measure against', async () => {
      const entry = entryRow({ endedAt: null })

      await runUpdate(entry, { startedAt: AT('08:00').toISOString() })

      expect(entry.startedAt?.toISOString()).toBe(AT('08:00').toISOString())
      expect(entry.endedAt).toBeNull()
      expect(entry.durationMinutes).toBe(60)
    })

    it('leaves all three untouched when the write carries none of them', async () => {
      const entry = entryRow()
      const startedAt = entry.startedAt
      const endedAt = entry.endedAt

      await runUpdate(entry, { description: 'note only' }, ROUND_UP_QUARTER_HOUR)

      expect(entry.startedAt).toBe(startedAt)
      expect(entry.endedAt).toBe(endedAt)
      expect(entry.durationMinutes).toBe(60)
      expect(entry.roundedMinutes).toBe(60)
      expect(entry.notes).toBe('note only')
    })
  })

  describe('midnight crossing (D-8)', () => {
    it('stores an end earlier than its start on the NEXT day and leaves `date` on the starting day', async () => {
      const entry = entryRow()
      const date = entry.date

      await runUpdate(entry, {
        startedAt: AT('22:00').toISOString(),
        endedAt: AT('02:00').toISOString(),
      })

      expect(entry.endedAt?.toISOString()).toBe(AT('02:00', '2026-07-02').toISOString())
      expect(entry.durationMinutes).toBe(240)
      expect(entry.date).toBe(date)
    })

    it('leaves an end the caller already placed on the next day exactly where it was sent', async () => {
      const entry = entryRow()

      await runUpdate(entry, {
        startedAt: AT('22:00').toISOString(),
        endedAt: AT('02:00', '2026-07-02').toISOString(),
      })

      expect(entry.endedAt?.toISOString()).toBe(AT('02:00', '2026-07-02').toISOString())
      expect(entry.durationMinutes).toBe(240)
    })

    it('carries a duration-only edit over midnight rather than wrapping it back onto the same day', async () => {
      const entry = entryRow({ startedAt: AT('23:00'), endedAt: AT('23:30'), durationMinutes: 30 })

      await runUpdate(entry, { durationMinutes: 120 })

      expect(entry.endedAt?.toISOString()).toBe(AT('01:00', '2026-07-02').toISOString())
    })
  })

  describe('rounded minutes (D-7)', () => {
    it('recomputes the rounded twin when the CLOCKS changed the length of the work', async () => {
      const { roundMinutes } = await loadCommands()
      const entry = entryRow()

      await runUpdate(entry, { endedAt: AT('10:01').toISOString() }, ROUND_UP_QUARTER_HOUR)

      expect(entry.durationMinutes).toBe(61)
      expect(entry.roundedMinutes).toBe(75)
      expect(entry.roundedMinutes).toBe(roundMinutes(61, { unitMinutes: 15, direction: 'up' }))
    })

    it('recomputes it for a duration-only edit too', async () => {
      const entry = entryRow()

      await runUpdate(entry, { durationMinutes: 76 }, ROUND_UP_QUARTER_HOUR)

      expect(entry.roundedMinutes).toBe(90)
    })

    it('leaves the frozen rounded value alone when the clocks move without changing the length', async () => {
      const entry = entryRow({ roundedMinutes: 60 })

      await runUpdate(
        entry,
        { startedAt: AT('14:00').toISOString(), endedAt: AT('15:00').toISOString() },
        ROUND_UP_QUARTER_HOUR,
      )

      expect(entry.durationMinutes).toBe(60)
      expect(entry.roundedMinutes).toBe(60)
    })
  })

  // T4.10(b). `date` names the day the work started (D-8), so re-dating an entry
  // and leaving its clocks behind files a 09:00–10:00 span against a day it did
  // not happen on — the same self-contradicting triple as a duration that
  // disagrees with its span, one field over. Decision: the clocks move WITH the
  // entry, shifted by whole days so a stored UTC offset and a midnight crossing
  // both survive, and always subject to the two rules above them — no clock is
  // manufactured, and a running timer is left alone.
  describe('a date-only move (T4.10)', () => {
    it('re-anchors both clocks onto the new day, keeping their times', async () => {
      const entry = entryRow()

      await runUpdate(entry, { date: '2026-07-03' })

      expect(entry.startedAt?.toISOString()).toBe(AT('09:00', '2026-07-03').toISOString())
      expect(entry.endedAt?.toISOString()).toBe(AT('10:00', '2026-07-03').toISOString())
      expect(entry.durationMinutes).toBe(60)
    })

    it('keeps a midnight crossing crossing', async () => {
      const entry = entryRow({
        startedAt: AT('22:00'),
        endedAt: AT('02:00', '2026-07-02'),
        durationMinutes: 240,
        roundedMinutes: 240,
      })

      await runUpdate(entry, { date: '2026-07-05' })

      expect(entry.startedAt?.toISOString()).toBe(AT('22:00', '2026-07-05').toISOString())
      expect(entry.endedAt?.toISOString()).toBe(AT('02:00', '2026-07-06').toISOString())
    })

    it('leaves a running timer where it is — a re-date says nothing about when work began', async () => {
      const entry = entryRow({ endedAt: null, durationMinutes: 0, roundedMinutes: 0 })

      await runUpdate(entry, { date: '2026-07-03' })

      expect(entry.startedAt?.toISOString()).toBe(AT('09:00').toISOString())
      expect(entry.endedAt).toBeNull()
    })

    it('manufactures no clock for an entry that has none', async () => {
      const entry = entryRow({ startedAt: null, endedAt: null })

      await runUpdate(entry, { date: '2026-07-03' })

      expect(entry.startedAt).toBeNull()
      expect(entry.endedAt).toBeNull()
      expect(entry.durationMinutes).toBe(60)
    })

    it('does not restate the frozen rounded value: a move changes the day, not the length', async () => {
      const entry = entryRow({ endedAt: AT('10:01'), durationMinutes: 61, roundedMinutes: 61 })

      await runUpdate(entry, { date: '2026-07-03' }, ROUND_UP_QUARTER_HOUR)

      expect(entry.durationMinutes).toBe(61)
      expect(entry.roundedMinutes).toBe(61)
    })

    it('lets clocks the request sends explicitly win, rather than shifting them twice', async () => {
      // What the entry dialog sends: it rebuilds both clocks from the new date
      // itself, so the rebase must not move them again on top of that.
      const entry = entryRow()

      await runUpdate(entry, {
        date: '2026-07-03',
        startedAt: AT('08:00', '2026-07-03').toISOString(),
        endedAt: AT('09:30', '2026-07-03').toISOString(),
      })

      expect(entry.startedAt?.toISOString()).toBe(AT('08:00', '2026-07-03').toISOString())
      expect(entry.endedAt?.toISOString()).toBe(AT('09:30', '2026-07-03').toISOString())
      expect(entry.durationMinutes).toBe(90)
    })

    it('refuses the move on another tenant\'s entry and leaves its clocks untouched', async () => {
      const { update, entities } = await loadCommands()
      const entry = entryRow({ tenantId: OTHER_TENANT_ID })
      const world: World = { projects: [], entries: [entry] }
      const em = makeEm(world, entities)

      await expect(update.execute({ id: ENTRY_ID, date: '2026-07-03' }, makeCtx(em))).rejects.toMatchObject({
        status: 404,
      })
      expect(entry.startedAt?.toISOString()).toBe(AT('09:00').toISOString())
      expect(entry.endedAt?.toISOString()).toBe(AT('10:00').toISOString())
    })
  })

  describe('the audit trail', () => {
    it('names both clocks in the change set of a time correction', async () => {
      const { update, entities } = await loadCommands()
      const entry = entryRow()
      const world: World = { projects: [projectRow()], entries: [entry] }
      const em = makeEm(world, entities)
      const ctx = makeCtx(em)
      const input = {
        id: ENTRY_ID,
        startedAt: AT('08:00').toISOString(),
        endedAt: AT('09:30').toISOString(),
      }

      const snapshots = await update.prepare!(input, ctx)
      await update.execute(input, ctx)
      const log = await update.buildLog!({ snapshots, ctx })

      expect(log?.changes).toMatchObject({
        startedAt: { from: AT('09:00').toISOString(), to: AT('08:00').toISOString() },
        endedAt: { from: AT('10:00').toISOString(), to: AT('09:30').toISOString() },
        durationMinutes: { from: 60, to: 90 },
      })
    })
  })

  describe('scoping', () => {
    it('refuses a clock edit on another tenant\'s entry and leaves its times untouched', async () => {
      const { update, entities } = await loadCommands()
      const entry = entryRow({ tenantId: OTHER_TENANT_ID })
      const world: World = { projects: [], entries: [entry] }
      const em = makeEm(world, entities)

      await expect(
        update.execute({ id: ENTRY_ID, startedAt: AT('08:00').toISOString() }, makeCtx(em)),
      ).rejects.toMatchObject({ status: 404 })
      expect(entry.startedAt?.toISOString()).toBe(AT('09:00').toISOString())
      expect(entry.durationMinutes).toBe(60)
    })
  })
})
