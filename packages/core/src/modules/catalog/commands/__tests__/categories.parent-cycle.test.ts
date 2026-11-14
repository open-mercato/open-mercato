/** @jest-environment node */

export {}

const registerCommand = jest.fn()
const rebuildCategoryHierarchyForOrganization = jest.fn(async () => undefined)

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (_em: unknown, phases: Array<() => unknown | Promise<unknown>>) => {
    for (const phase of phases) await phase()
  },
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    setCustomFieldsIfAny: jest.fn(async () => undefined),
    emitCrudSideEffects: jest.fn(async () => undefined),
    emitCrudUndoSideEffects: jest.fn(async () => undefined),
  }
})

jest.mock('../../lib/categoryHierarchy', () => {
  const actual = jest.requireActual('../../lib/categoryHierarchy')
  return {
    ...actual,
    rebuildCategoryHierarchyForOrganization,
  }
})

const ORG = '22222222-2222-4222-8222-222222222222'
const TENANT = '33333333-3333-4333-8333-333333333333'
const CAT_A = 'aaaa1111-0000-4000-8000-000000000001'
const CAT_B = 'aaaa1111-0000-4000-8000-000000000002'
const CAT_C = 'aaaa1111-0000-4000-8000-000000000003'
const PARENT_CYCLE_CODE = 'catalog.categories.errors.parentCycle'
const REPLAY_CYCLE_CODE = 'catalog.categories.errors.replayCycle'

type CategoryRow = {
  id: string
  organizationId: string
  tenantId: string
  name: string
  slug: string | null
  description: string | null
  parentId: string | null
  isActive: boolean
  deletedAt: Date | null
}

type CommandLike = {
  execute: (input: Record<string, unknown>, ctx: unknown) => Promise<unknown>
  undo: (args: { logEntry: Record<string, unknown>; ctx: unknown }) => Promise<void>
}

function loadUpdateCommand(): CommandLike {
  let command: CommandLike | undefined
  jest.isolateModules(() => {
    require('../categories')
    command = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'catalog.categories.update')?.[0]
  })
  if (!command) throw new Error('[internal] catalog.categories.update not registered')
  return command
}

function row(id: string, parentId: string | null): CategoryRow {
  return {
    id,
    organizationId: ORG,
    tenantId: TENANT,
    name: id,
    slug: null,
    description: null,
    parentId,
    isActive: true,
    deletedAt: null,
  }
}

function matches(candidate: CategoryRow, filter: Record<string, unknown>): boolean {
  if (filter.deletedAt === null && candidate.deletedAt) return false
  if (typeof filter.id === 'string' && candidate.id !== filter.id) return false
  if (typeof filter.organizationId === 'string' && candidate.organizationId !== filter.organizationId) return false
  if (typeof filter.tenantId === 'string' && candidate.tenantId !== filter.tenantId) return false
  return true
}

function buildCtx(rows: CategoryRow[]) {
  const em: Record<string, unknown> = {
    findOne: jest.fn(async (_entity: unknown, filter: Record<string, unknown>) =>
      rows.find((candidate) => matches(candidate, filter)) ?? null,
    ),
    find: jest.fn(async (_entity: unknown, filter: Record<string, unknown>) =>
      rows.filter((candidate) => matches(candidate, filter)),
    ),
    create: jest.fn(),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  em.fork = jest.fn(() => em)
  const dataEngine = { markOrmEntityChange: jest.fn(), setCustomFields: jest.fn() }
  return {
    container: {
      resolve: jest.fn((token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return dataEngine
        return undefined
      }),
    },
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
    em,
  }
}

function snapshot(id: string, parentId: string | null) {
  return {
    id,
    organizationId: ORG,
    tenantId: TENANT,
    name: id,
    slug: null,
    description: null,
    parentId,
    rootId: parentId ?? id,
    treePath: parentId ? `${parentId}/${id}` : id,
    depth: parentId ? 1 : 0,
    ancestorIds: parentId ? [parentId] : [],
    childIds: [],
    descendantIds: [],
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function updateLogEntry(id: string, beforeParentId: string | null, afterParentId: string | null) {
  return {
    commandPayload: {
      undo: {
        before: snapshot(id, beforeParentId),
        after: snapshot(id, afterParentId),
      },
    },
  }
}

async function expectCrudError(promise: Promise<unknown>, status: number, code: string) {
  await expect(promise).rejects.toMatchObject({ status, body: { code } })
}

describe('catalog.categories.update — parent cycles', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('refuses to move a category under its own child', async () => {
    const rows = [row(CAT_A, null), row(CAT_B, CAT_A)]
    const command = loadUpdateCommand()

    await expectCrudError(command.execute({ id: CAT_A, parentId: CAT_B }, buildCtx(rows)), 400, PARENT_CYCLE_CODE)
    expect(rebuildCategoryHierarchyForOrganization).not.toHaveBeenCalled()
  })

  it('refuses to move a category under a deeper descendant', async () => {
    const rows = [row(CAT_A, null), row(CAT_B, CAT_A), row(CAT_C, CAT_B)]
    const command = loadUpdateCommand()

    await expectCrudError(command.execute({ id: CAT_A, parentId: CAT_C }, buildCtx(rows)), 400, PARENT_CYCLE_CODE)
    expect(rebuildCategoryHierarchyForOrganization).not.toHaveBeenCalled()
  })

  it('still moves a category under an unrelated parent', async () => {
    const rows = [row(CAT_A, null), row(CAT_B, CAT_A), row(CAT_C, null)]
    const command = loadUpdateCommand()

    await expect(command.execute({ id: CAT_B, parentId: CAT_C }, buildCtx(rows))).resolves.toEqual({ categoryId: CAT_B })
    expect(rows[1].parentId).toBe(CAT_C)
    expect(rebuildCategoryHierarchyForOrganization).toHaveBeenCalledTimes(1)
  })

  it('does not run the cycle check when the parent is cleared or left unchanged', async () => {
    const rows = [row(CAT_A, CAT_B), row(CAT_B, CAT_A), row(CAT_C, CAT_A)]
    const command = loadUpdateCommand()
    const ctx = buildCtx(rows)

    await expect(command.execute({ id: CAT_A, name: 'Renamed', parentId: CAT_B }, ctx)).resolves.toEqual({ categoryId: CAT_A })
    await expect(command.execute({ id: CAT_C, parentId: null }, ctx)).resolves.toEqual({ categoryId: CAT_C })
    expect(rows[2].parentId).toBeNull()
    expect(ctx.em.find).not.toHaveBeenCalled()
    expect(rebuildCategoryHierarchyForOrganization).toHaveBeenCalledTimes(2)
  })

  it('clears the parent when the category itself is chosen, whatever the id case', async () => {
    const rows = [row(CAT_A, CAT_B), row(CAT_B, null)]
    const command = loadUpdateCommand()

    await expect(command.execute({ id: CAT_A, parentId: CAT_A.toUpperCase() }, buildCtx(rows))).resolves.toEqual({ categoryId: CAT_A })
    expect(rows[0].parentId).toBeNull()
    expect(rebuildCategoryHierarchyForOrganization).toHaveBeenCalledTimes(1)
  })

  it('does not run the cycle check on an undo that keeps the current parent', async () => {
    const rows = [row(CAT_A, CAT_B), row(CAT_B, CAT_A)]
    const command = loadUpdateCommand()
    const ctx = buildCtx(rows)

    await command.undo({ logEntry: updateLogEntry(CAT_A, CAT_B, CAT_B), ctx })

    expect(rows[0].parentId).toBe(CAT_B)
    expect(ctx.em.find).not.toHaveBeenCalled()
    expect(rebuildCategoryHierarchyForOrganization).toHaveBeenCalledTimes(1)
  })

  it('refuses an undo whose restored parent is now a descendant', async () => {
    const rows = [row(CAT_A, null), row(CAT_B, CAT_A)]
    const command = loadUpdateCommand()

    await expectCrudError(
      command.undo({ logEntry: updateLogEntry(CAT_A, CAT_B, null), ctx: buildCtx(rows) }),
      409,
      REPLAY_CYCLE_CODE,
    )
    expect(rebuildCategoryHierarchyForOrganization).not.toHaveBeenCalled()
  })

  it('restores the previous parent when it is still a safe ancestor', async () => {
    const rows = [row(CAT_A, null), row(CAT_B, null)]
    const command = loadUpdateCommand()

    await command.undo({ logEntry: updateLogEntry(CAT_A, CAT_B, null), ctx: buildCtx(rows) })

    expect(rows[0].parentId).toBe(CAT_B)
    expect(rebuildCategoryHierarchyForOrganization).toHaveBeenCalledTimes(1)
  })
})
