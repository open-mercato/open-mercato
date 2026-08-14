/** @jest-environment node */
// T4.4 — the copy itself, exercised end to end through the command bus.
//
// The lock-gate file next door pins that a locked source is refused and that the
// duplicate command delegates to create rather than re-implementing the write.
// This file pins what T4.4 adds on top: the `date` and `durationMinutes`
// overrides US-D6 needs ("…I adjust the duration and the date"), and — because
// the fake bus here dispatches to the REAL create command instead of stubbing it
// — that every copy lands with a `rounded_minutes` computed from the tenant rule,
// which D-7 makes the only input to cost.
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
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const STAFF_MEMBER_ID = '44444444-4444-4444-8444-444444444444'
const PROJECT_ID = '55555555-5555-4555-8555-555555555555'
const TASK_ID = '66666666-6666-4666-8666-666666666666'
const ENTRY_ID = '77777777-7777-4777-8777-777777777777'
const COPY_ID = '77777777-7777-4777-8777-7777777777aa'
const TAG_ONE = '88888888-8888-4888-8888-000000000001'
const TAG_TWO = '88888888-8888-4888-8888-000000000002'

type EntryRow = Record<string, unknown> & { id: string; tenantId: string; organizationId: string }

type Entities = { StaffTimeEntry: unknown; StaffTimeProject: unknown; StaffTimeTask: unknown }

type RegisteredCommand = { execute: (input: unknown, ctx: unknown) => Promise<unknown> }

type Loaded = {
  registry: Map<string, RegisteredCommand> | { get: (id: string) => RegisteredCommand }
  duplicate: RegisteredCommand
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
    registry: commandRegistry as unknown as { get: (id: string) => RegisteredCommand },
    duplicate: commandRegistry.get('staff.timesheets.time_entries.duplicate') as RegisteredCommand,
    entities: {
      StaffTimeEntry: entities.StaffTimeEntry,
      StaffTimeProject: entities.StaffTimeProject,
      StaffTimeTask: entities.StaffTimeTask,
    },
    roundMinutes: rounding.roundMinutes,
  }
}

function entryRow(overrides: Partial<EntryRow> = {}): EntryRow {
  return {
    id: ENTRY_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    staffMemberId: STAFF_MEMBER_ID,
    date: new Date('2026-07-01T00:00:00.000Z'),
    durationMinutes: 95,
    roundedMinutes: 95,
    startedAt: new Date('2026-07-01T09:00:00.000Z'),
    endedAt: new Date('2026-07-01T10:35:00.000Z'),
    notes: 'Cart migration — price mapping fixes',
    timeProjectId: PROJECT_ID,
    taskId: TASK_ID,
    customerId: null,
    dealId: null,
    orderId: null,
    isBillable: true,
    rateOverrideAmount: null,
    rateCurrencyCode: 'PLN',
    lockedReportId: null,
    lockedAt: null,
    source: 'manual',
    deletedAt: null,
    ...overrides,
  }
}

type World = { entries: EntryRow[]; created: Record<string, unknown>[] }

function makeEm(world: World, entities: Entities) {
  const em: Record<string, jest.Mock> = {
    fork: jest.fn(),
    findOne: jest.fn(async (cls: unknown, where: Record<string, unknown>) => {
      if (cls === entities.StaffTimeProject) {
        if (where.id !== PROJECT_ID) return null
        return {
          id: PROJECT_ID,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          currencyCode: 'PLN',
          billableByDefault: true,
          deletedAt: null,
        }
      }
      if (cls === entities.StaffTimeTask) {
        if (where.id !== TASK_ID) return null
        return { id: TASK_ID, tenantId: TENANT_ID, organizationId: ORG_ID, timeProjectId: PROJECT_ID, deletedAt: null }
      }
      if (cls === entities.StaffTimeEntry) {
        if (where.id === undefined) return null
        return (
          world.entries.find(
            (row) =>
              row.id === where.id &&
              !row.deletedAt &&
              (where.tenantId === undefined || where.tenantId === null || row.tenantId === where.tenantId) &&
              (where.organizationId === undefined ||
                where.organizationId === null ||
                row.organizationId === where.organizationId),
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

type CtxOptions = { manageAll?: boolean; settings?: Record<string, unknown> }

/**
 * Unlike the lock-gate harness, this bus DISPATCHES `.create` to the registered
 * command instead of answering with a canned id — that is what makes the rounding
 * assertion below a real one rather than a restatement of the fake.
 */
function makeCtx(em: unknown, loaded: Loaded, options: CtxOptions = {}) {
  const busCalls: { commandId: string; input: Record<string, unknown> }[] = []
  const commandBus = {
    execute: jest.fn(async (commandId: string, opts: { input: Record<string, unknown>; ctx: unknown }) => {
      busCalls.push({ commandId, input: opts.input })
      if (commandId.endsWith('.create')) {
        const create = loaded.registry.get(commandId)
        return { result: await create.execute(opts.input, opts.ctx), logEntry: null }
      }
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

describe('staff timesheets duplicate command (T4.4 / US-D6)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveProjectAccess.mockResolvedValue(MANAGES_ALL_PROJECTS)
    mockGetStaffMemberByUserId.mockResolvedValue({ id: STAFF_MEMBER_ID })
  })

  it('carries task, description, billable and tags onto the copy', async () => {
    const loaded = await loadCommands()
    const world: World = { entries: [entryRow({ isBillable: false })], created: [] }
    const em = makeEm(world, loaded.entities)
    const { ctx, busCalls } = makeCtx(em, loaded)

    await loaded.duplicate.execute({ id: ENTRY_ID, tagIds: [TAG_ONE, TAG_TWO] }, ctx)

    expect(world.created).toHaveLength(1)
    expect(world.created[0]).toMatchObject({
      taskId: TASK_ID,
      timeProjectId: PROJECT_ID,
      notes: 'Cart migration — price mapping fixes',
      isBillable: false,
      staffMemberId: STAFF_MEMBER_ID,
    })
    // Tags reach the tag command, never the junction table.
    const assign = busCalls.find((call) => call.commandId.includes('tags'))
    expect(assign?.input).toMatchObject({ timeEntryId: COPY_ID, tagIds: [TAG_ONE, TAG_TWO] })
  })

  it('applies the date and durationMinutes overrides in one call (US-D6)', async () => {
    const loaded = await loadCommands()
    const world: World = { entries: [entryRow()], created: [] }
    const em = makeEm(world, loaded.entities)
    const { ctx } = makeCtx(em, loaded)

    await loaded.duplicate.execute({ id: ENTRY_ID, date: '2026-07-08', durationMinutes: 45 }, ctx)

    expect(world.created).toHaveLength(1)
    expect(world.created[0].durationMinutes).toBe(45)
    expect(String((world.created[0].date as Date).toISOString()).slice(0, 10)).toBe('2026-07-08')
    // The source is untouched: an override moves the copy, never the original.
    expect(world.entries[0].durationMinutes).toBe(95)
    expect((world.entries[0].date as Date).toISOString().slice(0, 10)).toBe('2026-07-01')
  })

  it('keeps the source duration and day when neither override is sent', async () => {
    const loaded = await loadCommands()
    const world: World = { entries: [entryRow()], created: [] }
    const em = makeEm(world, loaded.entities)
    const { ctx } = makeCtx(em, loaded)

    await loaded.duplicate.execute({ id: ENTRY_ID }, ctx)

    expect(world.created[0].durationMinutes).toBe(95)
    expect((world.created[0].date as Date).toISOString().slice(0, 10)).toBe('2026-07-01')
  })

  it('writes rounded_minutes on the copy from the tenant rule, not from the source (D-7)', async () => {
    const loaded = await loadCommands()
    const world: World = { entries: [entryRow()], created: [] }
    const em = makeEm(world, loaded.entities)
    const { ctx } = makeCtx(em, loaded, {
      settings: { 'rounding.unitMinutes': 15, 'rounding.direction': 'up' },
    })

    await loaded.duplicate.execute({ id: ENTRY_ID, durationMinutes: 95 }, ctx)

    expect(world.created[0].roundedMinutes).toBe(loaded.roundMinutes(95, { unitMinutes: 15, direction: 'up' }))
    expect(world.created[0].roundedMinutes).toBe(105)
    // Not the source's stale 95: an overridden duration cannot inherit a rounded
    // twin that no longer describes it.
    expect(world.created[0].roundedMinutes).not.toBe(world.entries[0].roundedMinutes)
  })

  it('rounds an overridden duration rather than the source duration', async () => {
    const loaded = await loadCommands()
    const world: World = { entries: [entryRow()], created: [] }
    const em = makeEm(world, loaded.entities)
    const { ctx } = makeCtx(em, loaded, {
      settings: { 'rounding.unitMinutes': 15, 'rounding.direction': 'up' },
    })

    await loaded.duplicate.execute({ id: ENTRY_ID, durationMinutes: 20 }, ctx)

    expect(world.created[0].durationMinutes).toBe(20)
    expect(world.created[0].roundedMinutes).toBe(30)
  })

  it('does not carry the timer stamps over, so a copy cannot overlap its source (US-D7)', async () => {
    const loaded = await loadCommands()
    const world: World = { entries: [entryRow()], created: [] }
    const em = makeEm(world, loaded.entities)
    const { ctx } = makeCtx(em, loaded)

    await loaded.duplicate.execute({ id: ENTRY_ID }, ctx)

    expect(world.created[0].startedAt).toBeNull()
    expect(world.created[0].endedAt).toBeNull()
    expect(world.created[0].source).toBe('manual')
  })
})
