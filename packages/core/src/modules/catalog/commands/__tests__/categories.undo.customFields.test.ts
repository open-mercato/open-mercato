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

const CATEGORY_ID = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const TENANT = '33333333-3333-4333-8333-333333333333'
const OTHER_ORG = '44444444-4444-4444-8444-444444444444'
const CATEGORY_ENTITY_ID = 'catalog:catalog_product_category'

type UndoHandler = (args: { logEntry: Record<string, unknown>; ctx: unknown }) => Promise<void>

function loadUpdateUndo(): UndoHandler {
  let command: { undo?: UndoHandler } | undefined
  jest.isolateModules(() => {
    require('../categories')
    command = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'catalog.categories.update')?.[0]
  })
  if (!command?.undo) throw new Error('catalog.categories.update undo not registered')
  return command.undo
}

function buildSnapshot(overrides: Record<string, unknown>) {
  return {
    id: CATEGORY_ID,
    organizationId: ORG,
    tenantId: TENANT,
    name: 'Books',
    slug: null,
    description: null,
    parentId: null,
    rootId: CATEGORY_ID,
    treePath: CATEGORY_ID,
    depth: 0,
    ancestorIds: [],
    childIds: [],
    descendantIds: [],
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function buildCtx(callerOrgId: string = ORG) {
  const record: Record<string, unknown> = {
    id: CATEGORY_ID,
    organizationId: ORG,
    tenantId: TENANT,
    name: 'Books renamed',
    deletedAt: null,
  }
  const em: Record<string, unknown> = {
    findOne: jest.fn().mockResolvedValue(record),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  }
  em.fork = jest.fn().mockReturnValue(em)
  const dataEngine = { markOrmEntityChange: jest.fn(), setCustomFields: jest.fn() }
  const ctx = {
    container: {
      resolve: jest.fn((token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return dataEngine
        return undefined
      }),
    },
    auth: { sub: 'user-1', tenantId: TENANT, orgId: callerOrgId },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  }
  return { ctx, record, em, dataEngine }
}

function buildLogEntry(beforeCustom: Record<string, unknown> | null, afterCustom: Record<string, unknown> | null) {
  return {
    commandPayload: {
      undo: {
        before: buildSnapshot({ custom: beforeCustom }),
        after: buildSnapshot({ name: 'Books renamed', custom: afterCustom }),
      },
    },
  }
}

describe('catalog.categories.update undo custom fields', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('writes the pre-update custom field values back', async () => {
    const undo = loadUpdateUndo()
    const { ctx, record, dataEngine } = buildCtx()

    await undo({
      logEntry: buildLogEntry(
        { season: 'winter', channels: ['web', 'store'] },
        { season: 'summer', channels: ['outlet'] },
      ),
      ctx,
    })

    expect(record.name).toBe('Books')
    expect(setCustomFieldsIfAny).toHaveBeenCalledTimes(1)
    expect(setCustomFieldsIfAny).toHaveBeenCalledWith({
      dataEngine,
      entityId: CATEGORY_ENTITY_ID,
      recordId: CATEGORY_ID,
      organizationId: ORG,
      tenantId: TENANT,
      values: { season: 'winter', channels: ['web', 'store'] },
    })
  })

  it('clears custom fields the update set for the first time', async () => {
    const undo = loadUpdateUndo()
    const { ctx } = buildCtx()

    await undo({
      logEntry: buildLogEntry(null, { season: 'summer', channels: ['outlet'] }),
      ctx,
    })

    expect(setCustomFieldsIfAny).toHaveBeenCalledTimes(1)
    expect(setCustomFieldsIfAny.mock.calls[0][0].values).toEqual({ season: null, channels: [] })
  })

  it('restores custom fields the update cleared', async () => {
    const undo = loadUpdateUndo()
    const { ctx } = buildCtx()

    await undo({
      logEntry: buildLogEntry({ season: 'winter', channels: ['web'] }, null),
      ctx,
    })

    expect(setCustomFieldsIfAny).toHaveBeenCalledTimes(1)
    expect(setCustomFieldsIfAny.mock.calls[0][0].values).toEqual({ season: 'winter', channels: ['web'] })
  })

  it('restores the pre-update values from a payload that has no after snapshot', async () => {
    const undo = loadUpdateUndo()
    const { ctx } = buildCtx()

    await undo({
      logEntry: {
        commandPayload: {
          undo: { before: buildSnapshot({ custom: { season: 'winter', channels: ['web'] } }) },
        },
      },
      ctx,
    })

    expect(setCustomFieldsIfAny).toHaveBeenCalledTimes(1)
    expect(setCustomFieldsIfAny.mock.calls[0][0].values).toEqual({ season: 'winter', channels: ['web'] })
  })

  it('propagates a failed custom field write to the caller', async () => {
    const undo = loadUpdateUndo()
    const { ctx } = buildCtx()
    setCustomFieldsIfAny.mockRejectedValueOnce(new Error('custom field validation failed'))

    await expect(
      undo({
        logEntry: buildLogEntry({ season: 'winter' }, { season: 'summer' }),
        ctx,
      }),
    ).rejects.toThrow('custom field validation failed')
    expect(setCustomFieldsIfAny).toHaveBeenCalledTimes(1)
  })

  it('skips the custom field write when neither snapshot carries custom values', async () => {
    const undo = loadUpdateUndo()
    const { ctx, record } = buildCtx()

    await undo({ logEntry: buildLogEntry(null, null), ctx })

    expect(record.name).toBe('Books')
    expect(setCustomFieldsIfAny).not.toHaveBeenCalled()
  })

  it('keeps unchanged values and the original types in the restore', async () => {
    const undo = loadUpdateUndo()
    const { ctx } = buildCtx()

    await undo({
      logEntry: buildLogEntry(
        { rank: 3, weight: 1.5, featured: true, launch: '2026-03-01' },
        { rank: 4, weight: 1.5, featured: false },
      ),
      ctx,
    })

    expect(setCustomFieldsIfAny).toHaveBeenCalledTimes(1)
    expect(setCustomFieldsIfAny.mock.calls[0][0].values).toStrictEqual({
      rank: 3,
      weight: 1.5,
      featured: true,
      launch: '2026-03-01',
    })
  })

  it('rejects an undo from another organization before touching the category or its custom fields', async () => {
    const undo = loadUpdateUndo()
    const { ctx, record, em } = buildCtx(OTHER_ORG)

    await expect(
      undo({
        logEntry: buildLogEntry({ season: 'winter' }, { season: 'summer' }),
        ctx,
      }),
    ).rejects.toMatchObject({ status: 403 })
    expect(record.name).toBe('Books renamed')
    expect(em.flush).not.toHaveBeenCalled()
    expect(setCustomFieldsIfAny).not.toHaveBeenCalled()
  })
})
