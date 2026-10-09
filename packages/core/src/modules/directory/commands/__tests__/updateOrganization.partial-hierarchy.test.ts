/** @jest-environment node */

// A partial update (the sidebar-branding route sends only logo fields) must leave the
// organization where it is in the tree. Omitted `parentId` / `childIds` used to be read as
// "no parent" / "no children", which detached the organization and orphaned its children.
// Explicit `null` / `[]` still clear.

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
  }
})

import '@open-mercato/core/modules/directory/commands/organizations'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ROOT_ID = 'aaaa1111-0000-4000-8000-000000000001'
const MIDDLE_ID = 'aaaa1111-0000-4000-8000-000000000002'
const LEAF_ID = 'aaaa1111-0000-4000-8000-000000000003'
const OTHER_ROOT_ID = 'aaaa1111-0000-4000-8000-000000000004'

type OrgRow = {
  id: string
  tenant: string
  name: string
  slug: string | null
  logoUrl: string | null
  logoPreserveAspectRatio: boolean
  isActive: boolean
  deletedAt: Date | null
  parentId: string | null
  ancestorIds: string[]
  childIds: string[]
  descendantIds: string[]
}

function makeRow(id: string, name: string, tree: Partial<OrgRow>): OrgRow {
  return {
    id,
    tenant: TENANT_ID,
    name,
    slug: null,
    logoUrl: null,
    logoPreserveAspectRatio: true,
    isActive: true,
    deletedAt: null,
    parentId: null,
    ancestorIds: [],
    childIds: [],
    descendantIds: [],
    ...tree,
  }
}

function makeTree(): OrgRow[] {
  return [
    makeRow(ROOT_ID, 'Root', { childIds: [MIDDLE_ID], descendantIds: [MIDDLE_ID, LEAF_ID] }),
    makeRow(MIDDLE_ID, 'Middle', {
      parentId: ROOT_ID,
      ancestorIds: [ROOT_ID],
      childIds: [LEAF_ID],
      descendantIds: [LEAF_ID],
    }),
    makeRow(LEAF_ID, 'Leaf', { parentId: MIDDLE_ID, ancestorIds: [ROOT_ID, MIDDLE_ID] }),
    makeRow(OTHER_ROOT_ID, 'Other root', {}),
  ]
}

type RowFilter = {
  id?: string | { $in: string[] }
  parentId?: string
}

function matches(row: OrgRow, filter: RowFilter): boolean {
  if (row.deletedAt) return false
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
  }
}

function makeDataEngine(rows: OrgRow[]) {
  return {
    updateOrmEntity: jest.fn(async ({ where, apply }: { where: RowFilter; apply: (entity: OrgRow) => void }) => {
      const row = rows.find((candidate) => matches(candidate, where)) ?? null
      if (row) apply(row)
      return row
    }),
    setCustomFields: jest.fn(async () => {}),
  }
}

function makeCtx(em: ReturnType<typeof makeEm>, de: ReturnType<typeof makeDataEngine>) {
  return {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return de
        if (token === 'rbacService') return { loadAcl: async () => ({ isSuperAdmin: false }) }
        throw new Error(`[internal] Unexpected DI token: ${token}`)
      },
    },
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: MIDDLE_ID, isSuperAdmin: false },
  } as unknown as Parameters<CommandHandler['execute']>[1]
}

async function runUpdate(rows: OrgRow[], input: Record<string, unknown>) {
  const em = makeEm(rows)
  const de = makeDataEngine(rows)
  const handler = commandRegistry.get('directory.organizations.update') as CommandHandler
  await handler.execute(input, makeCtx(em, de))
}

function parentOf(rows: OrgRow[], id: string): string | null | undefined {
  return rows.find((row) => row.id === id)?.parentId
}

describe('directory.organizations.update — partial updates keep the hierarchy', () => {
  afterEach(() => jest.clearAllMocks())

  it('keeps parent and children when only branding fields are sent', async () => {
    const rows = makeTree()

    await runUpdate(rows, { id: MIDDLE_ID, tenantId: TENANT_ID, logoUrl: 'https://example.com/logo.png' })

    expect(rows.find((row) => row.id === MIDDLE_ID)?.logoUrl).toBe('https://example.com/logo.png')
    expect(parentOf(rows, MIDDLE_ID)).toBe(ROOT_ID)
    expect(parentOf(rows, LEAF_ID)).toBe(MIDDLE_ID)
  })

  it('keeps parent and children when only the name is sent', async () => {
    const rows = makeTree()

    await runUpdate(rows, { id: MIDDLE_ID, name: 'Renamed' })

    expect(rows.find((row) => row.id === MIDDLE_ID)?.name).toBe('Renamed')
    expect(parentOf(rows, MIDDLE_ID)).toBe(ROOT_ID)
    expect(parentOf(rows, LEAF_ID)).toBe(MIDDLE_ID)
  })

  it('keeps children when only parentId is sent', async () => {
    const rows = makeTree()

    await runUpdate(rows, { id: MIDDLE_ID, parentId: OTHER_ROOT_ID })

    expect(parentOf(rows, MIDDLE_ID)).toBe(OTHER_ROOT_ID)
    expect(parentOf(rows, LEAF_ID)).toBe(MIDDLE_ID)
  })

  it('keeps the parent when only childIds is sent', async () => {
    const rows = makeTree()

    await runUpdate(rows, { id: MIDDLE_ID, childIds: [] })

    expect(parentOf(rows, MIDDLE_ID)).toBe(ROOT_ID)
    expect(parentOf(rows, LEAF_ID)).toBeNull()
  })

  it('rejects the current parent as a child when parentId is omitted', async () => {
    const rows = makeTree()

    const rejection = await runUpdate(rows, { id: MIDDLE_ID, childIds: [ROOT_ID] }).catch((err: unknown) => err)

    expect(rejection).toBeInstanceOf(CrudHttpError)
    expect((rejection as CrudHttpError).status).toBe(400)
    expect((rejection as CrudHttpError).body).toEqual({ error: 'Child cannot equal parent' })
    expect(parentOf(rows, MIDDLE_ID)).toBe(ROOT_ID)
    expect(parentOf(rows, ROOT_ID)).toBeNull()
    expect(parentOf(rows, LEAF_ID)).toBe(MIDDLE_ID)
  })

  it('rejects a kept child as the new parent when childIds is omitted', async () => {
    const rows = makeTree()

    const rejection = await runUpdate(rows, { id: MIDDLE_ID, parentId: LEAF_ID }).catch((err: unknown) => err)

    expect(rejection).toBeInstanceOf(CrudHttpError)
    expect((rejection as CrudHttpError).status).toBe(400)
    expect((rejection as CrudHttpError).body).toEqual({ error: 'Cannot assign descendant as parent' })
    expect(parentOf(rows, MIDDLE_ID)).toBe(ROOT_ID)
    expect(parentOf(rows, LEAF_ID)).toBe(MIDDLE_ID)
  })

  it('still clears parent and children on explicit null and empty list', async () => {
    const rows = makeTree()

    await runUpdate(rows, { id: MIDDLE_ID, parentId: null, childIds: [] })

    expect(parentOf(rows, MIDDLE_ID)).toBeNull()
    expect(parentOf(rows, LEAF_ID)).toBeNull()
  })

  it('applies an explicit parent and child list as before', async () => {
    const rows = makeTree()

    await runUpdate(rows, { id: OTHER_ROOT_ID, parentId: ROOT_ID, childIds: [] })
    await runUpdate(rows, { id: MIDDLE_ID, parentId: ROOT_ID, childIds: [LEAF_ID] })

    expect(parentOf(rows, OTHER_ROOT_ID)).toBe(ROOT_ID)
    expect(parentOf(rows, MIDDLE_ID)).toBe(ROOT_ID)
    expect(parentOf(rows, LEAF_ID)).toBe(MIDDLE_ID)
  })
})
