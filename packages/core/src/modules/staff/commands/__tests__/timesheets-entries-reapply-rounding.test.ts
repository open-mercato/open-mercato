/** @jest-environment node */
/**
 * T7.3 — retroactive rounding at the command layer.
 *
 * The single property this file exists to defend: a locked entry is not merely
 * skipped by an `if`, it is excluded by the query, so no future edit to the loop
 * can reach one. The rest pins the counts the ProgressJob reports and the fact
 * that the raw duration is never touched.
 */
import type { AwilixContainer } from 'awilix'

const emitCrudSideEffectsMock = jest.fn().mockResolvedValue(undefined)

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: (...args: unknown[]) => emitCrudSideEffectsMock(...args),
    emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/core/modules/staff/events', () => ({
  emitStaffEvent: jest.fn().mockResolvedValue(undefined),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT_ID = '11111111-1111-4111-8111-1111111111ff'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const ENTRY_A = '77777777-7777-4777-8777-77777777000a'
const ENTRY_B = '77777777-7777-4777-8777-77777777000b'
const ENTRY_C = '77777777-7777-4777-8777-77777777000c'

type EntryRow = Record<string, unknown> & {
  id: string
  tenantId: string
  organizationId: string
  durationMinutes: number
  roundedMinutes: number | null
  lockedReportId: string | null
  deletedAt: Date | null
}

type RegisteredCommand = { execute: (input: unknown, ctx: unknown) => Promise<unknown> }

type Loaded = {
  reapply: RegisteredCommand
  StaffTimeEntry: unknown
}

async function loadCommand(): Promise<Loaded> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-entries')
  const entities = await import('../../data/entities')
  return {
    reapply: commandRegistry.get('staff.timesheets.time_entries.reapply_rounding') as RegisteredCommand,
    StaffTimeEntry: entities.StaffTimeEntry,
  }
}

function entryRow(overrides: Partial<EntryRow> = {}): EntryRow {
  return {
    id: ENTRY_A,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    durationMinutes: 62,
    roundedMinutes: 62,
    lockedReportId: null,
    lockedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

type World = { entries: EntryRow[]; wheres: Record<string, unknown>[] }

function makeEm(world: World, StaffTimeEntry: unknown) {
  const em: Record<string, jest.Mock> = {
    fork: jest.fn(),
    find: jest.fn(async (cls: unknown, where: Record<string, unknown>) => {
      if (cls !== StaffTimeEntry) return []
      world.wheres.push(where)
      const ids = (where.id as { $in?: string[] } | undefined)?.$in ?? []
      return world.entries.filter(
        (row) =>
          ids.includes(row.id) &&
          row.deletedAt === null &&
          row.lockedReportId === null &&
          (where.tenantId === undefined || where.tenantId === null || row.tenantId === where.tenantId) &&
          (where.organizationId === undefined ||
            where.organizationId === null ||
            row.organizationId === where.organizationId),
      )
    }),
    flush: jest.fn(async () => {}),
  }
  em.fork.mockReturnValue(em)
  return em
}

function makeCtx(
  em: Record<string, jest.Mock>,
  options: { systemActor?: boolean; unitMinutes?: number; direction?: string } = {},
) {
  const settings = new Map<string, unknown>([
    ['rounding.unitMinutes', options.unitMinutes ?? 15],
    ['rounding.direction', options.direction ?? 'up'],
  ])
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'dataEngine') return { markOrmEntityChange: jest.fn() }
      if (name === 'moduleConfigService') {
        return {
          async getRecord(_moduleId: string, key: string) {
            if (!settings.has(key)) return null
            return { value: settings.get(key) }
          },
        }
      }
      throw new Error(`[internal] Unexpected resolve ${name}`)
    },
  } as unknown as AwilixContainer

  return {
    container,
    auth: null,
    systemActor: options.systemActor ?? true,
    organizationScope: {
      selectedId: ORG_ID,
      filterIds: [ORG_ID],
      allowedIds: [ORG_ID],
      tenantId: TENANT_ID,
    },
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  }
}

describe('staff.timesheets.time_entries.reapply_rounding', () => {
  beforeEach(() => {
    emitCrudSideEffectsMock.mockClear()
  })

  it('restates rounded minutes under the tenant rule without touching the raw duration', async () => {
    const { reapply, StaffTimeEntry } = await loadCommand()
    const world: World = { entries: [entryRow({ durationMinutes: 62, roundedMinutes: 62 })], wheres: [] }
    const em = makeEm(world, StaffTimeEntry)

    const result = (await reapply.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, entryIds: [ENTRY_A] },
      makeCtx(em),
    )) as { updatedCount: number; unchangedCount: number; skippedCount: number }

    expect(result).toEqual({ updatedCount: 1, unchangedCount: 0, skippedCount: 0 })
    expect(world.entries[0].roundedMinutes).toBe(75)
    expect(world.entries[0].durationMinutes).toBe(62)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('never loads a locked entry — the exclusion is in the query, not a branch', async () => {
    const { reapply, StaffTimeEntry } = await loadCommand()
    const locked = entryRow({ id: ENTRY_B, lockedReportId: 'report-1', roundedMinutes: 62 })
    const world: World = { entries: [entryRow(), locked], wheres: [] }
    const em = makeEm(world, StaffTimeEntry)

    const result = (await reapply.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, entryIds: [ENTRY_A, ENTRY_B] },
      makeCtx(em),
    )) as { updatedCount: number; skippedCount: number }

    expect(world.wheres[0].lockedReportId).toBeNull()
    expect(locked.roundedMinutes).toBe(62)
    expect(result.updatedCount).toBe(1)
    expect(result.skippedCount).toBe(1)
  })

  it('counts an entry already at the current rule as unchanged and does not flush it', async () => {
    const { reapply, StaffTimeEntry } = await loadCommand()
    const world: World = { entries: [entryRow({ durationMinutes: 60, roundedMinutes: 60 })], wheres: [] }
    const em = makeEm(world, StaffTimeEntry)

    const result = (await reapply.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, entryIds: [ENTRY_A] },
      makeCtx(em),
    )) as { updatedCount: number; unchangedCount: number }

    expect(result).toEqual({ updatedCount: 0, unchangedCount: 1, skippedCount: 0 })
    expect(em.flush).not.toHaveBeenCalled()
    expect(emitCrudSideEffectsMock).not.toHaveBeenCalled()
  })

  it('reindexes exactly the entries it changed', async () => {
    const { reapply, StaffTimeEntry } = await loadCommand()
    const world: World = {
      entries: [
        entryRow({ id: ENTRY_A, durationMinutes: 62, roundedMinutes: 62 }),
        entryRow({ id: ENTRY_B, durationMinutes: 60, roundedMinutes: 60 }),
        entryRow({ id: ENTRY_C, durationMinutes: 3, roundedMinutes: 3 }),
      ],
      wheres: [],
    }
    const em = makeEm(world, StaffTimeEntry)

    await reapply.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, entryIds: [ENTRY_A, ENTRY_B, ENTRY_C] },
      makeCtx(em),
    )

    expect(emitCrudSideEffectsMock).toHaveBeenCalledTimes(2)
    const touched = emitCrudSideEffectsMock.mock.calls.map(([args]) => (args as { entity: EntryRow }).entity.id)
    expect(touched.sort()).toEqual([ENTRY_A, ENTRY_C].sort())
  })

  it('leaves rounded minutes equal to the raw duration when rounding is off', async () => {
    const { reapply, StaffTimeEntry } = await loadCommand()
    const world: World = { entries: [entryRow({ durationMinutes: 62, roundedMinutes: 75 })], wheres: [] }
    const em = makeEm(world, StaffTimeEntry)

    await reapply.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, entryIds: [ENTRY_A] },
      makeCtx(em, { unitMinutes: 0 }),
    )

    expect(world.entries[0].roundedMinutes).toBe(62)
  })

  it('refuses an interactive caller that is neither the worker nor a super admin', async () => {
    const { reapply, StaffTimeEntry } = await loadCommand()
    const world: World = { entries: [entryRow()], wheres: [] }
    const em = makeEm(world, StaffTimeEntry)
    const ctx = { ...makeCtx(em, { systemActor: false }), auth: { sub: 'user-1', tenantId: TENANT_ID } }

    await expect(
      reapply.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, entryIds: [ENTRY_A] }, ctx),
    ).rejects.toMatchObject({ status: 403 })
    expect(em.find).not.toHaveBeenCalled()
  })

  it('scopes the load to the tenant and organization it was given', async () => {
    const { reapply, StaffTimeEntry } = await loadCommand()
    const foreign = entryRow({ id: ENTRY_B, tenantId: OTHER_TENANT_ID, roundedMinutes: 62 })
    const world: World = { entries: [entryRow(), foreign], wheres: [] }
    const em = makeEm(world, StaffTimeEntry)

    const result = (await reapply.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, entryIds: [ENTRY_A, ENTRY_B] },
      makeCtx(em),
    )) as { updatedCount: number; skippedCount: number }

    expect(world.wheres[0].tenantId).toBe(TENANT_ID)
    expect(world.wheres[0].organizationId).toBe(ORG_ID)
    expect(foreign.roundedMinutes).toBe(62)
    expect(result.skippedCount).toBe(1)
  })

  it('rejects a batch larger than the command caps', async () => {
    const { reapply, StaffTimeEntry } = await loadCommand()
    const em = makeEm({ entries: [], wheres: [] }, StaffTimeEntry)
    const tooMany = Array.from({ length: 501 }, (_, index) =>
      `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`,
    )

    await expect(
      reapply.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, entryIds: tooMany }, makeCtx(em)),
    ).rejects.toBeDefined()
  })
})
