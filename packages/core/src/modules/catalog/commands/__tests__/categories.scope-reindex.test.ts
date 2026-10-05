export {}

const registerCommand = jest.fn()
const setCustomFieldsIfAny = jest.fn().mockResolvedValue(undefined)

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    setCustomFieldsIfAny,
  }
})

const ORG = '22222222-2222-4222-8222-222222222222'
const TENANT = '33333333-3333-4333-8333-333333333333'
const CATEGORY_ID = '11111111-1111-4111-8111-111111111111'
const OLD_PARENT = '44444444-4444-4444-8444-444444444444'
const NEW_PARENT = '55555555-5555-4555-8555-555555555555'
const CHILD = '66666666-6666-4666-8666-666666666666'

type CommandLike = {
  execute: (input: Record<string, unknown>, ctx: unknown) => Promise<unknown>
  undo: (args: { logEntry: unknown; ctx: unknown }) => Promise<void>
}

type MarkedChange = {
  action: string
  identifiers: { id: string; organizationId: string; tenantId: string }
  events: { buildPayload: (ctx: { identifiers: MarkedChange['identifiers'] }) => Record<string, unknown> }
}

function loadCommand(id: string): CommandLike {
  let command: unknown
  jest.isolateModules(() => {
    require('../categories')
    command = registerCommand.mock.calls.find(([cmd]) => cmd.id === id)?.[0]
  })
  if (!command) throw new Error(`[internal] command ${id} not registered`)
  return command as CommandLike
}

function buildRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: CATEGORY_ID,
    organizationId: ORG,
    tenantId: TENANT,
    name: 'Books',
    slug: null,
    description: null,
    parentId: OLD_PARENT,
    rootId: OLD_PARENT,
    treePath: null,
    depth: 1,
    ancestorIds: [OLD_PARENT],
    childIds: [CHILD],
    descendantIds: [CHILD],
    isActive: true,
    deletedAt: null,
    ...overrides,
  }
}

function buildEm(record: Record<string, unknown>) {
  const em: Record<string, unknown> = {
    findOne: jest.fn(async (_entity: unknown, where: { id?: string }) => {
      if (where?.id === CATEGORY_ID) return record
      if (where?.id === NEW_PARENT || where?.id === OLD_PARENT) return { id: where.id }
      return null
    }),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  }
  em.fork = jest.fn().mockReturnValue(em)
  return em
}

function buildCtx(em: Record<string, unknown>) {
  const dataEngine = { markOrmEntityChange: jest.fn(), setCustomFields: jest.fn() }
  return {
    ctx: {
      container: {
        resolve: jest.fn((token: string) => {
          if (token === 'em') return em
          if (token === 'dataEngine') return dataEngine
          return undefined
        }),
      },
      auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG },
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    },
    dataEngine,
  }
}

function emittedPayload(dataEngine: { markOrmEntityChange: jest.Mock }): Record<string, unknown> {
  expect(dataEngine.markOrmEntityChange).toHaveBeenCalledTimes(1)
  const change = dataEngine.markOrmEntityChange.mock.calls[0][0] as MarkedChange
  expect(change.action).toBe('updated')
  return change.events.buildPayload({ identifiers: change.identifiers })
}

describe('catalog category commands — scope_keys reindex signal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('flags a re-parent with hierarchyChanged and the pre-move subtree', async () => {
    const command = loadCommand('catalog.categories.update')
    const { ctx, dataEngine } = buildCtx(buildEm(buildRecord()))

    await command.execute({ id: CATEGORY_ID, parentId: NEW_PARENT }, ctx)

    expect(emittedPayload(dataEngine)).toEqual({
      id: CATEGORY_ID,
      organizationId: ORG,
      tenantId: TENANT,
      hierarchyChanged: true,
      previousDescendantIds: [CHILD],
    })
  })

  it('keeps the plain payload when the parent did not change', async () => {
    const command = loadCommand('catalog.categories.update')
    const { ctx, dataEngine } = buildCtx(buildEm(buildRecord()))

    await command.execute({ id: CATEGORY_ID, name: 'Novels', parentId: OLD_PARENT }, ctx)

    expect(emittedPayload(dataEngine)).toEqual({ id: CATEGORY_ID, organizationId: ORG, tenantId: TENANT })
  })

  it('signals a hierarchy change when undo reverts a re-parent', async () => {
    const command = loadCommand('catalog.categories.update')
    const { ctx, dataEngine } = buildCtx(buildEm(buildRecord({ parentId: NEW_PARENT })))
    const before = buildRecord({ createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    const after = { ...before, parentId: NEW_PARENT, descendantIds: [CHILD] }

    await command.undo({ logEntry: { commandPayload: { undo: { before, after } } }, ctx })

    expect(emittedPayload(dataEngine)).toEqual(expect.objectContaining({ hierarchyChanged: true, previousDescendantIds: [CHILD] }))
  })

  it('emits nothing new when undo reverts a rename only', async () => {
    const command = loadCommand('catalog.categories.update')
    const { ctx, dataEngine } = buildCtx(buildEm(buildRecord()))
    const before = buildRecord({ createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    const after = { ...before, name: 'Novels' }

    await command.undo({ logEntry: { commandPayload: { undo: { before, after } } }, ctx })

    expect(dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
  })

  it('signals a hierarchy change when undo restores a deleted category', async () => {
    const command = loadCommand('catalog.categories.delete')
    const { ctx, dataEngine } = buildCtx(buildEm(buildRecord({ deletedAt: new Date() })))
    const before = buildRecord({ createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })

    await command.undo({ logEntry: { commandPayload: { undo: { before } } }, ctx })

    expect(emittedPayload(dataEngine)).toEqual(expect.objectContaining({
      id: CATEGORY_ID,
      hierarchyChanged: true,
      previousDescendantIds: [CHILD],
    }))
  })
})
