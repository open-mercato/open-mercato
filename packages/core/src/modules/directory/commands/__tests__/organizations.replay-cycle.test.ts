/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (
    _em: unknown,
    phases: Array<() => unknown | Promise<unknown>>,
  ) => {
    for (const phase of phases) await phase()
  },
}))

jest.mock('@open-mercato/core/modules/directory/lib/hierarchy', () => {
  const actual = jest.requireActual('@open-mercato/core/modules/directory/lib/hierarchy')
  return {
    ...actual,
    rebuildHierarchyForTenant: jest.fn(async () => {}),
  }
})

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn(async () => {}),
    emitCrudUndoSideEffects: jest.fn(async () => {}),
  }
})

import '@open-mercato/core/modules/directory/commands/organizations'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { CommandUndoLogEntry } from '@open-mercato/shared/lib/commands/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { rebuildHierarchyForTenant } from '@open-mercato/core/modules/directory/lib/hierarchy'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_A = 'aaaa1111-0000-4000-8000-000000000001'
const ORG_B = 'aaaa1111-0000-4000-8000-000000000002'
const ORG_P = 'aaaa1111-0000-4000-8000-000000000003'
const ORG_X = 'aaaa1111-0000-4000-8000-000000000004'
const ORG_C = 'aaaa1111-0000-4000-8000-000000000005'
const ORG_N = 'aaaa1111-0000-4000-8000-000000000006'
const REPLAY_CYCLE_CODE = 'directory.organizations.errors.replayCycle'

const rebuildMock = rebuildHierarchyForTenant as jest.MockedFunction<typeof rebuildHierarchyForTenant>

type OrgRow = {
  id: string
  tenant: string
  name: string
  slug: string | null
  isActive: boolean
  deletedAt: Date | null
  parentId: string | null
  ancestorIds: string[]
  childIds: string[]
  descendantIds: string[]
}

type ChildParent = { childId: string; parentId: string | null }

type UndoSnapshot = {
  id: string
  tenantId: string
  name: string
  slug: string | null
  isActive: boolean
  parentId: string | null
  childParents: ChildParent[]
}

function makeRow(id: string, parentId: string | null, overrides: Partial<OrgRow> = {}): OrgRow {
  return {
    id,
    tenant: TENANT_ID,
    name: id,
    slug: null,
    isActive: true,
    deletedAt: null,
    parentId,
    ancestorIds: [],
    childIds: [],
    descendantIds: [],
    ...overrides,
  }
}

function makeSnapshot(id: string, parentId: string | null, childParents: ChildParent[] = []): UndoSnapshot {
  return { id, tenantId: TENANT_ID, name: id, slug: null, isActive: true, parentId, childParents }
}

type RowFilter = {
  id?: string | { $in: string[] }
  parentId?: string
  deletedAt?: null
}

function matches(row: OrgRow, filter: RowFilter): boolean {
  if (filter.deletedAt === null && row.deletedAt) return false
  if (typeof filter.id === 'string' && row.id !== filter.id) return false
  if (filter.id && typeof filter.id === 'object' && !filter.id.$in.includes(row.id)) return false
  if (filter.parentId !== undefined && row.parentId !== filter.parentId) return false
  return true
}

function makeEm(rows: OrgRow[]) {
  return {
    findOne: jest.fn(async (_entity: unknown, filter: RowFilter) => rows.find((row) => matches(row, filter)) ?? null),
    find: jest.fn(async (_entity: unknown, filter: RowFilter) => rows.filter((row) => matches(row, filter))),
    flush: jest.fn(async () => {}),
    persist: jest.fn(() => ({ flush: jest.fn(async () => {}) })),
    getReference: jest.fn((_entity: unknown, id: string) => id),
  }
}

function makeDataEngine(rows: OrgRow[]) {
  return {
    updateOrmEntity: jest.fn(async ({ where, apply }: { where: RowFilter; apply: (entity: OrgRow) => void }) => {
      const row = rows.find((candidate) => matches(candidate, where)) ?? null
      if (row) apply(row)
      return row
    }),
    createOrmEntity: jest.fn(async ({ data }: { data: { id: string; parentId: string | null } }) => {
      const row = makeRow(data.id, data.parentId)
      rows.push(row)
      return row
    }),
    deleteOrmEntity: jest.fn(async ({ where }: { where: RowFilter }) => {
      const index = rows.findIndex((candidate) => matches(candidate, where))
      if (index < 0) return null
      const [removed] = rows.splice(index, 1)
      return removed
    }),
    setCustomFields: jest.fn(async () => {}),
  }
}

function makeCtx(rows: OrgRow[]) {
  const em = makeEm(rows)
  const de = makeDataEngine(rows)
  return {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return de
        if (token === 'rbacService') return { loadAcl: async () => ({ isSuperAdmin: false }) }
        throw new Error(`[internal] Unexpected DI token: ${token}`)
      },
    },
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_A, isSuperAdmin: false },
  } as unknown as Parameters<CommandHandler['execute']>[1]
}

function logEntry(undo: Record<string, unknown>): CommandUndoLogEntry {
  return { commandPayload: { undo } }
}

async function replay(commandId: string, operation: 'undo' | 'redo', entry: CommandUndoLogEntry, rows: OrgRow[]) {
  const handler = commandRegistry.get(commandId) as CommandHandler
  const run = operation === 'undo' ? handler.undo : handler.redo
  await run!({ input: {}, logEntry: entry, ctx: makeCtx(rows) })
}

function parentOf(rows: OrgRow[], id: string): string | null | undefined {
  return rows.find((row) => row.id === id)?.parentId
}

async function expectReplayCycleRefusal(run: Promise<unknown>) {
  const rejection = await run.catch((err: unknown) => err)
  expect(rejection).toBeInstanceOf(CrudHttpError)
  expect((rejection as CrudHttpError).status).toBe(409)
  expect((rejection as CrudHttpError).body).toEqual({
    error: "The organization hierarchy changed since this action, so it can't be reverted without making an organization its own ancestor.",
    code: REPLAY_CYCLE_CODE,
  })
  expect(rebuildMock).not.toHaveBeenCalled()
}

describe('directory.organizations replay refuses to write a parent cycle', () => {
  afterEach(() => jest.clearAllMocks())

  it('update undo refuses when the restored parent became a descendant', async () => {
    const rows = [makeRow(ORG_B, null), makeRow(ORG_A, ORG_B)]
    const entry = logEntry({ before: makeSnapshot(ORG_B, ORG_A), after: makeSnapshot(ORG_B, null) })

    await expectReplayCycleRefusal(replay('directory.organizations.update', 'undo', entry, rows))
  })

  it('update undo still restores the parent when no cycle results', async () => {
    const rows = [makeRow(ORG_A, null), makeRow(ORG_B, null)]
    const entry = logEntry({ before: makeSnapshot(ORG_B, ORG_A), after: makeSnapshot(ORG_B, null) })

    await replay('directory.organizations.update', 'undo', entry, rows)

    expect(parentOf(rows, ORG_B)).toBe(ORG_A)
    expect(rebuildMock).toHaveBeenCalledTimes(1)
  })

  it('update undo refuses when a restored child parent closes the cycle', async () => {
    const rows = [makeRow(ORG_C, null), makeRow(ORG_P, ORG_C), makeRow(ORG_X, ORG_P)]
    const entry = logEntry({
      before: makeSnapshot(ORG_X, ORG_P, [{ childId: ORG_C, parentId: ORG_X }]),
      after: makeSnapshot(ORG_X, ORG_P, [{ childId: ORG_C, parentId: null }]),
    })

    await expectReplayCycleRefusal(replay('directory.organizations.update', 'undo', entry, rows))
  })

  it('delete undo refuses when a restored child parent closes the cycle', async () => {
    const rows = [
      makeRow(ORG_C, null),
      makeRow(ORG_P, ORG_C),
      makeRow(ORG_X, null, { deletedAt: new Date('2026-10-01T00:00:00.000Z'), isActive: false }),
    ]
    const entry = logEntry({ before: makeSnapshot(ORG_X, ORG_P, [{ childId: ORG_C, parentId: ORG_X }]) })

    await expectReplayCycleRefusal(replay('directory.organizations.delete', 'undo', entry, rows))
  })

  it('create undo refuses when a restored child parent closes the cycle', async () => {
    const rows = [makeRow(ORG_N, null), makeRow(ORG_C, ORG_N), makeRow(ORG_P, ORG_C)]
    const entry = logEntry({
      after: makeSnapshot(ORG_N, null, [{ childId: ORG_C, parentId: ORG_N }]),
      childrenBefore: [{ childId: ORG_C, parentId: ORG_P }],
    })

    await expectReplayCycleRefusal(replay('directory.organizations.create', 'undo', entry, rows))
  })

  it('create redo refuses when the restored parent became a descendant of a restored child', async () => {
    const rows = [makeRow(ORG_C, null), makeRow(ORG_P, ORG_C)]
    const entry = logEntry({
      after: makeSnapshot(ORG_N, ORG_P, [{ childId: ORG_C, parentId: ORG_N }]),
      childrenBefore: [{ childId: ORG_C, parentId: null }],
    })

    await expectReplayCycleRefusal(replay('directory.organizations.create', 'redo', entry, rows))
  })

  it('delete undo still revives the organization and its children when no cycle results', async () => {
    const rows = [
      makeRow(ORG_P, null),
      makeRow(ORG_C, ORG_P),
      makeRow(ORG_X, null, { deletedAt: new Date('2026-10-01T00:00:00.000Z'), isActive: false }),
    ]
    const entry = logEntry({ before: makeSnapshot(ORG_X, ORG_P, [{ childId: ORG_C, parentId: ORG_X }]) })

    await replay('directory.organizations.delete', 'undo', entry, rows)

    expect(parentOf(rows, ORG_X)).toBe(ORG_P)
    expect(parentOf(rows, ORG_C)).toBe(ORG_X)
    expect(rebuildMock).toHaveBeenCalledTimes(1)
  })

  it('create redo still recreates the organization under its parent when no cycle results', async () => {
    const rows = [makeRow(ORG_P, null), makeRow(ORG_C, null)]
    const entry = logEntry({
      after: makeSnapshot(ORG_N, ORG_P, [{ childId: ORG_C, parentId: ORG_N }]),
      childrenBefore: [{ childId: ORG_C, parentId: null }],
    })

    await replay('directory.organizations.create', 'redo', entry, rows)

    expect(parentOf(rows, ORG_N)).toBe(ORG_P)
    expect(parentOf(rows, ORG_C)).toBe(ORG_N)
    expect(rebuildMock).toHaveBeenCalledTimes(1)
  })
})
