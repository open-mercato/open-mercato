/** @jest-environment node */
// T4.1 — the extended time-entry write path. What is pinned here is the part of
// the contract a later change could break silently:
//
//  * `duration_minutes` stays RAW and `rounded_minutes` is derived from the
//    tenant rule at write time (D-7), so a settings change cannot restate money
//    that was already reported (risk R1);
//  * `is_billable` falls back to the project first and the tenant second;
//  * `rate_currency_code` snapshots the project currency at write time;
//  * the note is accepted under `notes` OR `description`, `description` winning
//    (the precedence UPGRADE_NOTES.md published);
//  * `tagIds` goes through the tag commands, never through the junction table;
//  * a caller who cannot see a project cannot write to its entries.
import type { AwilixContainer } from 'awilix'

const mockEmitCrudSideEffects = jest.fn()
const mockResolveProjectAccess = jest.fn()
const mockGetStaffMemberByUserId = jest.fn()

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
const OTHER_MEMBER_ID = '44444444-4444-4444-8444-4444444444ff'
const PROJECT_ID = '55555555-5555-4555-8555-555555555555'
const HIDDEN_PROJECT_ID = '55555555-5555-4555-8555-5555555555ff'
const TASK_ID = '66666666-6666-4666-8666-666666666666'
const ENTRY_ID = '77777777-7777-4777-8777-777777777777'
const TAG_ONE = '88888888-8888-4888-8888-000000000001'
const TAG_TWO = '88888888-8888-4888-8888-000000000002'

type ProjectRow = {
  id: string
  tenantId: string
  organizationId: string
  currencyCode: string | null
  hourlyRate: string | null
  billableByDefault: boolean
  deletedAt: Date | null
}

type TaskRow = {
  id: string
  tenantId: string
  organizationId: string
  timeProjectId: string
  deletedAt: Date | null
}

type EntryRow = Record<string, unknown> & {
  id: string
  tenantId: string
  organizationId: string
  staffMemberId: string
}

type Entities = {
  StaffTimeEntry: unknown
  StaffTimeProject: unknown
  StaffTimeTask: unknown
}

type RegisteredCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
}

type Loaded = {
  create: RegisteredCommand
  update: RegisteredCommand
  entities: Entities
  roundMinutes: (raw: number, settings: { unitMinutes: 0 | 5 | 10 | 15; direction: 'up' | 'nearest' }) => number
}

// Re-import the entity classes from the *same* freshly-reset module registry the
// command uses, so the identity comparisons in the em fake line up.
async function loadCommands(): Promise<Loaded> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-entries')
  const entities = await import('../../data/entities')
  const rounding = await import('../../lib/time-tracking/rounding')
  return {
    create: commandRegistry.get('staff.timesheets.time_entries.create') as RegisteredCommand,
    update: commandRegistry.get('staff.timesheets.time_entries.update') as RegisteredCommand,
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
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

type World = {
  projects: ProjectRow[]
  tasks: TaskRow[]
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
      if (cls === entities.StaffTimeTask) {
        return world.tasks.find((row) => row.id === where.id && !row.deletedAt && matchesScope(row, where)) ?? null
      }
      if (cls === entities.StaffTimeEntry) {
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
      const created = { ...data, id: (data.id as string | undefined) ?? ENTRY_ID }
      if (cls === entities.StaffTimeEntry) world.created.push(created)
      return created
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => {}),
  }
  em.fork.mockReturnValue(em)
  return em
}

type CtxOptions = {
  manageAll?: boolean
  settings?: Record<string, unknown>
  tagResults?: { tagIds: string[] }[]
  withConfigService?: boolean
}

function makeCtx(em: unknown, options: CtxOptions = {}) {
  const busCalls: { commandId: string; input: Record<string, unknown> }[] = []
  const tagResults = options.tagResults ?? []
  let tagCall = 0
  const commandBus = {
    execute: jest.fn(async (commandId: string, opts: { input: Record<string, unknown> }) => {
      busCalls.push({ commandId, input: opts.input })
      const next = tagResults[tagCall++]
      return { result: next ?? { tagIds: (opts.input.tagIds as string[]) ?? [] }, logEntry: null }
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
        if (name === 'moduleConfigService') return options.withConfigService === false ? undefined : configService
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
  return { ctx, busCalls, commandBus }
}

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    staffMemberId: STAFF_MEMBER_ID,
    date: '2026-07-01',
    durationMinutes: 61,
    ...overrides,
  }
}

const MANAGES_ALL_PROJECTS = { canManageAll: true, projectIds: [], staffMemberId: STAFF_MEMBER_ID }

describe('staff timesheets extended time-entry write path (T4.1)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveProjectAccess.mockResolvedValue(MANAGES_ALL_PROJECTS)
    mockGetStaffMemberByUserId.mockResolvedValue({ id: STAFF_MEMBER_ID })
  })

  describe('create', () => {
    it('round-trips every new field onto the created row', async () => {
      const { create, entities } = await loadCommands()
      const world: World = {
        projects: [projectRow()],
        tasks: [{ id: TASK_ID, tenantId: TENANT_ID, organizationId: ORG_ID, timeProjectId: PROJECT_ID, deletedAt: null }],
        entries: [],
        created: [],
      }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em)

      await create.execute(
        createInput({
          timeProjectId: PROJECT_ID,
          taskId: TASK_ID,
          isBillable: false,
          rateOverrideAmount: 260,
          description: 'Cart migration',
        }),
        ctx,
      )

      expect(world.created[0]).toMatchObject({
        taskId: TASK_ID,
        timeProjectId: PROJECT_ID,
        isBillable: false,
        rateOverrideAmount: '260',
        rateCurrencyCode: 'PLN',
        notes: 'Cart migration',
        durationMinutes: 61,
      })
    })

    it('stores raw duration and the tenant-rounded minutes beside it (D-7)', async () => {
      const { create, entities, roundMinutes } = await loadCommands()
      const world: World = { projects: [projectRow()], tasks: [], entries: [], created: [] }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em, {
        settings: { 'rounding.unitMinutes': 15, 'rounding.direction': 'up' },
      })

      await create.execute(createInput({ timeProjectId: PROJECT_ID, durationMinutes: 61 }), ctx)

      expect(world.created[0].durationMinutes).toBe(61)
      expect(world.created[0].roundedMinutes).toBe(75)
      expect(world.created[0].roundedMinutes).toBe(roundMinutes(61, { unitMinutes: 15, direction: 'up' }))
    })

    it('honours the nearest direction rather than always rounding up', async () => {
      const { create, entities, roundMinutes } = await loadCommands()
      const world: World = { projects: [projectRow()], tasks: [], entries: [], created: [] }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em, {
        settings: { 'rounding.unitMinutes': 15, 'rounding.direction': 'nearest' },
      })

      await create.execute(createInput({ timeProjectId: PROJECT_ID, durationMinutes: 61 }), ctx)

      expect(world.created[0].roundedMinutes).toBe(60)
      expect(world.created[0].roundedMinutes).toBe(roundMinutes(61, { unitMinutes: 15, direction: 'nearest' }))
    })

    it('defaults isBillable from the project, not the tenant, when the project says so', async () => {
      const { create, entities } = await loadCommands()
      const world: World = {
        projects: [projectRow({ billableByDefault: false })],
        tasks: [],
        entries: [],
        created: [],
      }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em, { settings: { 'defaults.billable': true } })

      await create.execute(createInput({ timeProjectId: PROJECT_ID }), ctx)

      expect(world.created[0].isBillable).toBe(false)
    })

    it('falls back to the tenant billable default when the entry names no project', async () => {
      const { create, entities } = await loadCommands()
      const world: World = { projects: [], tasks: [], entries: [], created: [] }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em, { settings: { 'defaults.billable': false } })

      await create.execute(createInput(), ctx)

      expect(world.created[0].isBillable).toBe(false)
      expect(world.created[0].rateCurrencyCode).toBeNull()
    })

    it('snapshots the project currency at write time', async () => {
      const { create, entities } = await loadCommands()
      const world: World = { projects: [projectRow({ currencyCode: 'EUR' })], tasks: [], entries: [], created: [] }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em)

      await create.execute(createInput({ timeProjectId: PROJECT_ID }), ctx)

      expect(world.created[0].rateCurrencyCode).toBe('EUR')
    })

    it('accepts the note under `notes` and under `description`, with `description` winning', async () => {
      const { create, entities } = await loadCommands()
      const world: World = { projects: [], tasks: [], entries: [], created: [] }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em)

      await create.execute(createInput({ notes: 'legacy key' }), ctx)
      expect(world.created[0].notes).toBe('legacy key')

      world.created.length = 0
      await create.execute(createInput({ description: 'new key' }), ctx)
      expect(world.created[0].notes).toBe('new key')

      world.created.length = 0
      await create.execute(createInput({ notes: 'legacy key', description: 'new key' }), ctx)
      expect(world.created[0].notes).toBe('new key')
    })

    it('refuses a task that is not in scope rather than storing a dangling reference', async () => {
      const { create, entities } = await loadCommands()
      const world: World = { projects: [projectRow()], tasks: [], entries: [], created: [] }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em)

      await expect(
        create.execute(createInput({ timeProjectId: PROJECT_ID, taskId: TASK_ID }), ctx),
      ).rejects.toMatchObject({ status: 422 })
      expect(world.created).toHaveLength(0)
    })

    it('inherits the project from the task when the request names only a task', async () => {
      const { create, entities } = await loadCommands()
      const world: World = {
        projects: [projectRow({ currencyCode: 'EUR' })],
        tasks: [{ id: TASK_ID, tenantId: TENANT_ID, organizationId: ORG_ID, timeProjectId: PROJECT_ID, deletedAt: null }],
        entries: [],
        created: [],
      }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em)

      await create.execute(createInput({ taskId: TASK_ID }), ctx)

      expect(world.created[0].timeProjectId).toBe(PROJECT_ID)
      expect(world.created[0].rateCurrencyCode).toBe('EUR')
    })

    it('refuses a task that belongs to a different project than the entry', async () => {
      const { create, entities } = await loadCommands()
      const world: World = {
        projects: [projectRow(), projectRow({ id: HIDDEN_PROJECT_ID })],
        tasks: [
          { id: TASK_ID, tenantId: TENANT_ID, organizationId: ORG_ID, timeProjectId: HIDDEN_PROJECT_ID, deletedAt: null },
        ],
        entries: [],
        created: [],
      }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em)

      await expect(
        create.execute(createInput({ timeProjectId: PROJECT_ID, taskId: TASK_ID }), ctx),
      ).rejects.toMatchObject({ status: 422 })
      expect(world.created).toHaveLength(0)
    })

    it('assigns tags through the tag command instead of the junction table', async () => {
      const { create, entities } = await loadCommands()
      const world: World = { projects: [], tasks: [], entries: [], created: [] }
      const em = makeEm(world, entities)
      const { ctx, busCalls } = makeCtx(em, { tagResults: [{ tagIds: [TAG_ONE] }] })

      await create.execute(createInput({ tagIds: [TAG_ONE] }), ctx)

      expect(busCalls).toEqual([
        {
          commandId: 'staff.timesheets.tags.assign_entry',
          input: { tenantId: TENANT_ID, organizationId: ORG_ID, timeEntryId: ENTRY_ID, tagIds: [TAG_ONE] },
        },
      ])
    })

    it('refuses a project the caller cannot see', async () => {
      const { create, entities } = await loadCommands()
      mockResolveProjectAccess.mockResolvedValue({
        canManageAll: false,
        projectIds: [PROJECT_ID],
        staffMemberId: STAFF_MEMBER_ID,
      })
      const world: World = {
        projects: [projectRow({ id: HIDDEN_PROJECT_ID })],
        tasks: [],
        entries: [],
        created: [],
      }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em, { manageAll: false })

      await expect(create.execute(createInput({ timeProjectId: HIDDEN_PROJECT_ID }), ctx)).rejects.toMatchObject({
        status: 403,
      })
      expect(world.created).toHaveLength(0)
    })

    it('refuses a tenant other than the caller\'s', async () => {
      const { create, entities } = await loadCommands()
      const world: World = { projects: [], tasks: [], entries: [], created: [] }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em)

      await expect(create.execute(createInput({ tenantId: OTHER_TENANT_ID }), ctx)).rejects.toMatchObject({
        status: 403,
      })
      expect(world.created).toHaveLength(0)
    })
  })

  describe('update', () => {
    it('round-trips every new field onto the stored row', async () => {
      const { update, entities } = await loadCommands()
      const entry = entryRow()
      const world: World = {
        projects: [projectRow()],
        tasks: [{ id: TASK_ID, tenantId: TENANT_ID, organizationId: ORG_ID, timeProjectId: PROJECT_ID, deletedAt: null }],
        entries: [entry],
        created: [],
      }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em)

      await update.execute(
        {
          id: ENTRY_ID,
          taskId: TASK_ID,
          isBillable: false,
          rateOverrideAmount: 199.5,
          description: 'Reworked',
        },
        ctx,
      )

      expect(entry).toMatchObject({
        taskId: TASK_ID,
        isBillable: false,
        rateOverrideAmount: '199.5',
        notes: 'Reworked',
      })
    })

    it('recomputes the rounded minutes when the duration changes', async () => {
      const { update, entities, roundMinutes } = await loadCommands()
      const entry = entryRow({ durationMinutes: 60, roundedMinutes: 60 })
      const world: World = { projects: [projectRow()], tasks: [], entries: [entry], created: [] }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em, {
        settings: { 'rounding.unitMinutes': 15, 'rounding.direction': 'up' },
      })

      await update.execute({ id: ENTRY_ID, durationMinutes: 76 }, ctx)

      expect(entry.durationMinutes).toBe(76)
      expect(entry.roundedMinutes).toBe(90)
      expect(entry.roundedMinutes).toBe(roundMinutes(76, { unitMinutes: 15, direction: 'up' }))
    })

    it('leaves the frozen rounded minutes alone when the duration is not part of the write', async () => {
      const { update, entities } = await loadCommands()
      const entry = entryRow({ durationMinutes: 61, roundedMinutes: 61 })
      const world: World = { projects: [projectRow()], tasks: [], entries: [entry], created: [] }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em, {
        settings: { 'rounding.unitMinutes': 15, 'rounding.direction': 'up' },
      })

      await update.execute({ id: ENTRY_ID, description: 'note only' }, ctx)

      expect(entry.roundedMinutes).toBe(61)
      expect(entry.notes).toBe('note only')
    })

    it('re-snapshots the currency when the entry moves to another project', async () => {
      const { update, entities } = await loadCommands()
      const entry = entryRow({ rateCurrencyCode: 'PLN' })
      const world: World = {
        projects: [projectRow(), projectRow({ id: HIDDEN_PROJECT_ID, currencyCode: 'EUR' })],
        tasks: [],
        entries: [entry],
        created: [],
      }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em)

      await update.execute({ id: ENTRY_ID, timeProjectId: HIDDEN_PROJECT_ID }, ctx)

      expect(entry.timeProjectId).toBe(HIDDEN_PROJECT_ID)
      expect(entry.rateCurrencyCode).toBe('EUR')
    })

    it('lets `description` win over `notes` on update too', async () => {
      const { update, entities } = await loadCommands()
      const entry = entryRow()
      const world: World = { projects: [projectRow()], tasks: [], entries: [entry], created: [] }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em)

      await update.execute({ id: ENTRY_ID, notes: 'legacy key', description: 'new key' }, ctx)

      expect(entry.notes).toBe('new key')
    })

    it('replaces the tag set through the tag commands, unassigning what is no longer wanted', async () => {
      const { update, entities } = await loadCommands()
      const entry = entryRow()
      const world: World = { projects: [projectRow()], tasks: [], entries: [entry], created: [] }
      const em = makeEm(world, entities)
      // The assign command answers with the target's full tag list; the stale one
      // in that answer is what drives the follow-up unassign.
      const { ctx, busCalls } = makeCtx(em, { tagResults: [{ tagIds: [TAG_ONE, TAG_TWO] }] })

      await update.execute({ id: ENTRY_ID, tagIds: [TAG_ONE] }, ctx)

      expect(busCalls).toEqual([
        {
          commandId: 'staff.timesheets.tags.assign_entry',
          input: { tenantId: TENANT_ID, organizationId: ORG_ID, timeEntryId: ENTRY_ID, tagIds: [TAG_ONE] },
        },
        {
          commandId: 'staff.timesheets.tags.unassign_entry',
          input: { tenantId: TENANT_ID, organizationId: ORG_ID, timeEntryId: ENTRY_ID, tagIds: [TAG_TWO] },
        },
      ])
    })

    it('refuses a non-member writing to an entry on a project they cannot see', async () => {
      const { update, entities } = await loadCommands()
      mockResolveProjectAccess.mockResolvedValue({
        canManageAll: false,
        projectIds: [],
        staffMemberId: STAFF_MEMBER_ID,
      })
      const entry = entryRow({ timeProjectId: HIDDEN_PROJECT_ID })
      const world: World = {
        projects: [projectRow({ id: HIDDEN_PROJECT_ID })],
        tasks: [],
        entries: [entry],
        created: [],
      }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em, { manageAll: false })

      await expect(update.execute({ id: ENTRY_ID, durationMinutes: 30 }, ctx)).rejects.toMatchObject({ status: 403 })
      expect(entry.durationMinutes).toBe(60)
    })

    it('lets the member who logged a project-less entry edit it', async () => {
      const { update, entities } = await loadCommands()
      mockResolveProjectAccess.mockResolvedValue({
        canManageAll: false,
        projectIds: [],
        staffMemberId: STAFF_MEMBER_ID,
      })
      const entry = entryRow({ timeProjectId: null, rateCurrencyCode: null })
      const world: World = { projects: [], tasks: [], entries: [entry], created: [] }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em, { manageAll: false })

      await update.execute({ id: ENTRY_ID, durationMinutes: 30 }, ctx)

      expect(entry.durationMinutes).toBe(30)
    })

    it('refuses another member\'s project-less entry', async () => {
      const { update, entities } = await loadCommands()
      mockResolveProjectAccess.mockResolvedValue({
        canManageAll: false,
        projectIds: [],
        staffMemberId: OTHER_MEMBER_ID,
      })
      mockGetStaffMemberByUserId.mockResolvedValue({ id: OTHER_MEMBER_ID })
      const entry = entryRow({ timeProjectId: null })
      const world: World = { projects: [], tasks: [], entries: [entry], created: [] }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em, { manageAll: false })

      await expect(update.execute({ id: ENTRY_ID, durationMinutes: 30 }, ctx)).rejects.toMatchObject({ status: 403 })
    })

    it('scopes the entry lookup to the caller\'s tenant', async () => {
      const { update, entities } = await loadCommands()
      const entry = entryRow({ tenantId: OTHER_TENANT_ID })
      const world: World = { projects: [], tasks: [], entries: [entry], created: [] }
      const em = makeEm(world, entities)
      const { ctx } = makeCtx(em)

      await expect(update.execute({ id: ENTRY_ID, durationMinutes: 30 }, ctx)).rejects.toMatchObject({ status: 404 })
      expect(entry.durationMinutes).toBe(60)
    })
  })
})
