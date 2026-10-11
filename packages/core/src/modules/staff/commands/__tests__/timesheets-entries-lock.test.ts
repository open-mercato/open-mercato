/** @jest-environment node */
// T4.2 / TC-TT-018 — the lock gate, at the layer risk R3 says it has to live at.
//
// An entry carrying `locked_report_id` has already been billed at its
// `rounded_minutes` (D-7), so nothing may move it: not the entry form, not the
// inline duration cell, not the grid bulk save, not duplicate. The command layer
// is where the refusal sits, so a write path added later inherits it instead of
// having to remember it — this file pins the three command-layer paths (update,
// delete, duplicate) and the bulk route's is pinned next to that route.
//
// It also pins the rounding hole T4.1 found on the timer path: a timer entry is
// created at zero minutes, and `rounded_minutes` left null there would price the
// whole entry at nothing.
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

jest.mock('@open-mercato/core/modules/staff/events', () => ({
  emitStaffEvent: jest.fn().mockResolvedValue(undefined),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT_ID = '11111111-1111-4111-8111-1111111111ff'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const STAFF_MEMBER_ID = '44444444-4444-4444-8444-444444444444'
const PROJECT_ID = '55555555-5555-4555-8555-555555555555'
const TASK_ID = '66666666-6666-4666-8666-666666666666'
const ENTRY_ID = '77777777-7777-4777-8777-777777777777'
const COPY_ID = '77777777-7777-4777-8777-7777777777aa'
const REPORT_ID = '99999999-9999-4999-8999-999999999999'
const TAG_ONE = '88888888-8888-4888-8888-000000000001'

type EntryRow = Record<string, unknown> & {
  id: string
  tenantId: string
  organizationId: string
  staffMemberId: string
}

type ProjectRow = {
  id: string
  tenantId: string
  organizationId: string
  currencyCode: string | null
  billableByDefault: boolean
  deletedAt: Date | null
}

type Entities = {
  StaffTimeEntry: unknown
  StaffTimeEntrySegment: unknown
  StaffTimeProject: unknown
  StaffTimeTask: unknown
}

type RegisteredCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
}

type Loaded = {
  update: RegisteredCommand
  remove: RegisteredCommand
  duplicate: RegisteredCommand
  startTimer: RegisteredCommand
  entities: Entities
  roundMinutes: (raw: number, settings: { unitMinutes: 0 | 5 | 10 | 15; direction: 'up' | 'nearest' }) => number
  lockedCode: string
}

// Re-import the entity classes from the *same* freshly-reset module registry the
// commands use, so the identity comparisons in the em fake line up.
async function loadCommands(): Promise<Loaded> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  const commands = await import('../timesheets-entries')
  const entities = await import('../../data/entities')
  const rounding = await import('../../lib/time-tracking/rounding')
  return {
    update: commandRegistry.get('staff.timesheets.time_entries.update') as RegisteredCommand,
    remove: commandRegistry.get('staff.timesheets.time_entries.delete') as RegisteredCommand,
    duplicate: commandRegistry.get('staff.timesheets.time_entries.duplicate') as RegisteredCommand,
    startTimer: commandRegistry.get('staff.timesheets.time_entries.start_timer') as RegisteredCommand,
    entities: {
      StaffTimeEntry: entities.StaffTimeEntry,
      StaffTimeEntrySegment: entities.StaffTimeEntrySegment,
      StaffTimeProject: entities.StaffTimeProject,
      StaffTimeTask: entities.StaffTimeTask,
    },
    roundMinutes: rounding.roundMinutes,
    lockedCode: commands.TIME_ENTRY_LOCKED_CODE,
  }
}

function projectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: PROJECT_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    currencyCode: 'PLN',
    billableByDefault: true,
    deletedAt: null,
    ...overrides,
  }
}

function entryRow(overrides: Partial<EntryRow> = {}): EntryRow {
  return {
    id: ENTRY_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    staffMemberId: STAFF_MEMBER_ID,
    date: new Date('2026-07-01T00:00:00.000Z'),
    durationMinutes: 60,
    roundedMinutes: 60,
    startedAt: null,
    endedAt: null,
    notes: 'Discovery workshop',
    timeProjectId: PROJECT_ID,
    taskId: TASK_ID,
    customerId: null,
    dealId: null,
    orderId: null,
    isBillable: true,
    rateOverrideAmount: '260.0000',
    rateCurrencyCode: 'PLN',
    lockedReportId: null,
    lockedAt: null,
    source: 'manual',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

function lockedEntryRow(overrides: Partial<EntryRow> = {}): EntryRow {
  return entryRow({ lockedReportId: REPORT_ID, lockedAt: new Date('2026-08-01T09:00:00.000Z'), ...overrides })
}

type World = {
  projects: ProjectRow[]
  entries: EntryRow[]
  created: Record<string, unknown>[]
}

function matchesScope(row: { tenantId: string; organizationId: string }, where: Record<string, unknown>): boolean {
  if (where.tenantId !== undefined && where.tenantId !== null && row.tenantId !== where.tenantId) return false
  if (where.organizationId !== undefined && where.organizationId !== null && row.organizationId !== where.organizationId) {
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
        if (where.id === undefined) return null
        return (
          world.entries.find(
            (row) => row.id === where.id && !row.deletedAt && matchesScope(row as never, where),
          ) ?? null
        )
      }
      return null
    }),
    find: jest.fn(async () => []),
    create: jest.fn((cls: unknown, data: Record<string, unknown>) => {
      const created = { ...data, id: (data.id as string | undefined) ?? COPY_ID }
      if (cls === entities.StaffTimeEntry) world.created.push(created)
      return created
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => {}),
    transactional: jest.fn(async (cb: (trx: unknown) => Promise<unknown>) => cb(em)),
  }
  em.fork.mockReturnValue(em)
  return em
}

type CtxOptions = {
  manageAll?: boolean
  settings?: Record<string, unknown>
}

function makeCtx(em: unknown, options: CtxOptions = {}) {
  const busCalls: { commandId: string; input: Record<string, unknown> }[] = []
  const commandBus = {
    execute: jest.fn(async (commandId: string, opts: { input: Record<string, unknown> }) => {
      busCalls.push({ commandId, input: opts.input })
      if (commandId.endsWith('.create')) return { result: { timeEntryId: COPY_ID }, logEntry: null }
      return { result: { tagIds: (opts.input.tagIds as string[]) ?? [] }, logEntry: null }
    }),
  }
  const settings = options.settings ?? {}
  const configService = {
    getRecord: async (_moduleId: string, name: string) =>
      Object.prototype.hasOwnProperty.call(settings, name) ? { value: settings[name] } : null,
  }
  const ctx = {
    auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID },
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return null
        if (name === 'commandBus') return commandBus
        if (name === 'moduleConfigService') return configService
        if (name === 'rbacService') {
          return {
            userHasAllFeatures: async () => options.manageAll ?? true,
            getGrantedFeatures: async () => [],
          }
        }
        return null
      },
    } as unknown as AwilixContainer,
    selectedOrganizationId: null,
    organizationScope: null,
    organizationIds: null,
  }
  return { ctx, busCalls }
}

const MANAGES_ALL_PROJECTS = { canManageAll: true, projectIds: [], staffMemberId: STAFF_MEMBER_ID }

describe('staff timesheets lock gate (T4.2 / TC-TT-018)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveProjectAccess.mockResolvedValue(MANAGES_ALL_PROJECTS)
    mockGetStaffMemberByUserId.mockResolvedValue({ id: STAFF_MEMBER_ID })
  })

  describe('update — the entry form and the inline duration cell', () => {
    it('refuses to change the duration of a locked entry and names the report that closed it', async () => {
      const { update, entities, lockedCode } = await loadCommands()
      const entry = lockedEntryRow()
      const world: World = { projects: [projectRow()], entries: [entry], created: [] }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em)

      const error = await update.execute({ id: ENTRY_ID, durationMinutes: 240 }, ctx).catch((err) => err)

      expect(error).toMatchObject({ status: 409 })
      expect(error.body).toMatchObject({
        code: lockedCode,
        lockedReportId: REPORT_ID,
        lockedEntryIds: [ENTRY_ID],
        lockedReportIds: [REPORT_ID],
      })
      // The value the closed report billed is untouched, rounded twin included.
      expect(entry.durationMinutes).toBe(60)
      expect(entry.roundedMinutes).toBe(60)
      expect(em.flush).not.toHaveBeenCalled()
    })

    it('uses the same `time_entry_locked` code the tag commands already refuse with', async () => {
      const { lockedCode } = await loadCommands()
      const tags = await import('../timesheets-tags')

      expect(lockedCode).toBe('time_entry_locked')
      expect(lockedCode).toBe(tags.TAG_TARGET_LOCKED_CODE)
    })

    it.each([
      ['the billable flag', { isBillable: false }],
      ['the rate override', { rateOverrideAmount: 1 }],
      ['the task', { taskId: TASK_ID }],
      ['the tag set', { tagIds: [TAG_ONE] }],
      ['the day', { date: '2026-07-02' }],
      // T4.9 added the two clocks to the update schema; the gate runs before a
      // single field is read off the request, so they are frozen with the rest.
      ['the start clock', { startedAt: '2026-07-01T08:00:00.000Z' }],
      ['the end clock', { endedAt: '2026-07-01T11:00:00.000Z' }],
    ])('refuses to change %s of a locked entry', async (_label, patch) => {
      const { update, entities } = await loadCommands()
      const entry = lockedEntryRow()
      const world: World = { projects: [projectRow()], entries: [entry], created: [] }
      const em = makeEm(world, entities)
      const { ctx, busCalls } = makeCtx(em)

      await expect(update.execute({ id: ENTRY_ID, ...patch }, ctx)).rejects.toMatchObject({ status: 409 })
      // In particular the tag write never reaches the tag commands.
      expect(busCalls).toHaveLength(0)
    })

    it('refuses a manage_all caller too — no permission unfreezes a billed entry', async () => {
      const { update, entities } = await loadCommands()
      const entry = lockedEntryRow()
      const world: World = { projects: [projectRow()], entries: [entry], created: [] }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em, { manageAll: true })

      await expect(update.execute({ id: ENTRY_ID, durationMinutes: 5 }, ctx)).rejects.toMatchObject({ status: 409 })
      expect(entry.durationMinutes).toBe(60)
    })

    it('still lets an unlocked entry through, so the refusal is the lock and not the harness', async () => {
      const { update, entities } = await loadCommands()
      const entry = entryRow()
      const world: World = { projects: [projectRow()], entries: [entry], created: [] }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em)

      await update.execute({ id: ENTRY_ID, durationMinutes: 240 }, ctx)

      expect(entry.durationMinutes).toBe(240)
    })
  })

  describe('delete', () => {
    it('refuses to soft-delete a locked entry', async () => {
      const { remove, entities, lockedCode } = await loadCommands()
      const entry = lockedEntryRow()
      const world: World = { projects: [projectRow()], entries: [entry], created: [] }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em)

      const error = await remove.execute({ id: ENTRY_ID }, ctx).catch((err) => err)

      expect(error).toMatchObject({ status: 409 })
      expect(error.body).toMatchObject({ code: lockedCode, lockedReportId: REPORT_ID })
      expect(entry.deletedAt).toBeNull()
      expect(em.flush).not.toHaveBeenCalled()
    })

    it('still deletes an unlocked entry', async () => {
      const { remove, entities } = await loadCommands()
      const entry = entryRow()
      const world: World = { projects: [projectRow()], entries: [entry], created: [] }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em)

      await remove.execute({ id: ENTRY_ID }, ctx)

      expect(entry.deletedAt).toBeInstanceOf(Date)
    })
  })

  describe('duplicate', () => {
    it('refuses to copy a locked entry and issues no create', async () => {
      const { duplicate, entities, lockedCode } = await loadCommands()
      const entry = lockedEntryRow()
      const world: World = { projects: [projectRow()], entries: [entry], created: [] }
      const em = makeEm(world, entities)
      const { ctx, busCalls } = makeCtx(em)

      const error = await duplicate.execute({ id: ENTRY_ID }, ctx).catch((err) => err)

      expect(error).toMatchObject({ status: 409 })
      expect(error.body).toMatchObject({ code: lockedCode, lockedReportId: REPORT_ID })
      expect(busCalls).toHaveLength(0)
      expect(world.created).toHaveLength(0)
    })

    it('copies an unlocked entry through the create command, carrying task, note, billable and rate', async () => {
      const { duplicate, entities } = await loadCommands()
      const entry = entryRow({ isBillable: false })
      const world: World = { projects: [projectRow()], entries: [entry], created: [] }
      const em = makeEm(world, entities)
      const { ctx, busCalls } = makeCtx(em)

      const result = (await duplicate.execute({ id: ENTRY_ID, date: '2026-07-08' }, ctx)) as {
        timeEntryId: string
      }

      expect(result.timeEntryId).toBe(COPY_ID)
      expect(busCalls).toHaveLength(1)
      expect(busCalls[0].commandId).toBe('staff.timesheets.time_entries.create')
      expect(busCalls[0].input).toMatchObject({
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        staffMemberId: STAFF_MEMBER_ID,
        timeProjectId: PROJECT_ID,
        taskId: TASK_ID,
        durationMinutes: 60,
        isBillable: false,
        rateOverrideAmount: 260,
        description: 'Discovery workshop',
        source: 'manual',
      })
      // A copy is typed, not timed — carrying the timestamps over would
      // manufacture an overlap with the entry it came from.
      expect(busCalls[0].input.startedAt).toBeUndefined()
      expect(busCalls[0].input.endedAt).toBeUndefined()
    })
  })

  describe('tenant isolation', () => {
    it.each([
      ['update', (cmd: Loaded) => cmd.update, { id: ENTRY_ID, durationMinutes: 30 }],
      ['delete', (cmd: Loaded) => cmd.remove, { id: ENTRY_ID }],
      ['duplicate', (cmd: Loaded) => cmd.duplicate, { id: ENTRY_ID }],
    ])("answers 404 rather than leaking another tenant's lock through %s", async (_label, pick, input) => {
      const loaded = await loadCommands()
      const entry = lockedEntryRow({ tenantId: OTHER_TENANT_ID })
      const world: World = { projects: [], entries: [entry], created: [] }
      const em = makeEm(world, loaded.entities)
      const { ctx } = makeCtx(em)

      const error = await pick(loaded).execute(input, ctx).catch((err) => err)

      // 404, not 409: a foreign entry must not disclose that it exists, is
      // locked, or which report locked it.
      expect(error).toMatchObject({ status: 404 })
      expect(error.body?.lockedReportId).toBeUndefined()
      expect(entry.deletedAt).toBeNull()
    })
  })

  describe('rounded_minutes on the timer path', () => {
    it('seeds a zero-duration timer entry with a rounded value rather than null (D-7)', async () => {
      const { startTimer, entities, roundMinutes } = await loadCommands()
      const world: World = { projects: [projectRow()], entries: [], created: [] }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em, {
        settings: { 'rounding.unitMinutes': 15, 'rounding.direction': 'up' },
      })

      await startTimer.execute(
        {
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          staffMemberId: STAFF_MEMBER_ID,
          date: '2026-07-01',
          timeProjectId: PROJECT_ID,
        },
        ctx,
      )

      expect(world.created).toHaveLength(1)
      expect(world.created[0].durationMinutes).toBe(0)
      expect(world.created[0].roundedMinutes).not.toBeNull()
      expect(world.created[0].roundedMinutes).toBe(roundMinutes(0, { unitMinutes: 15, direction: 'up' }))
      expect(world.created[0].roundedMinutes).toBe(0)
    })

    it('falls back to the documented defaults when the tenant settings cannot be read', async () => {
      const { startTimer, entities, roundMinutes } = await loadCommands()
      const world: World = { projects: [projectRow()], entries: [], created: [] }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em)

      await startTimer.execute(
        {
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          staffMemberId: STAFF_MEMBER_ID,
          date: '2026-07-01',
          timeProjectId: PROJECT_ID,
        },
        ctx,
      )

      expect(world.created[0].roundedMinutes).toBe(roundMinutes(0, { unitMinutes: 0, direction: 'up' }))
    })
  })
})
