export {}

const registerCommand = jest.fn()
const setCustomFieldsIfAny = jest.fn().mockResolvedValue(undefined)
const emitCrudSideEffects = jest.fn().mockResolvedValue(undefined)
const emitCrudUndoSideEffects = jest.fn().mockResolvedValue(undefined)
const findOneWithDecryption = jest.fn()
const findWithDecryption = jest.fn().mockResolvedValue([])

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
    emitCrudSideEffects,
    emitCrudUndoSideEffects,
  }
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (_em: unknown, phases: Array<() => unknown>) => {
    for (const phase of phases) await phase()
  },
}))

const SERVICE_ID = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const TENANT = '33333333-3333-4333-8333-333333333333'
const CATEGORY_ID = '44444444-4444-4444-8444-444444444444'
const SERVICE_ENTITY_ID = 'catalog:catalog_service'

type Handler = {
  id: string
  execute: (input: unknown, ctx: unknown) => Promise<{ serviceId: string }>
  undo?: (args: { logEntry: Record<string, unknown>; ctx: unknown }) => Promise<void>
  redo?: (args: { input: unknown; logEntry: Record<string, unknown>; ctx: unknown }) => Promise<{ serviceId: string }>
}

function loadCommand(id: string): Handler {
  let command: Handler | undefined
  jest.isolateModules(() => {
    require('../services')
    command = registerCommand.mock.calls.find(([cmd]) => cmd.id === id)?.[0]
  })
  if (!command) throw new Error(`${id} not registered`)
  return command
}

function buildSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: SERVICE_ID,
    organizationId: ORG,
    tenantId: TENANT,
    title: 'Workshop',
    description: null,
    scope: null,
    categoryId: null,
    defaultPriceAmount: '100.0000',
    defaultPriceCurrencyCode: 'USD',
    defaultMediaId: null,
    defaultMediaUrl: null,
    metadata: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    media: [],
    workRequirements: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        targetType: 'generic',
        targetId: null,
        labelSnapshot: 'Consultant',
        allocationMode: 'fixed_hours',
        allocationValue: '4.0000',
        sortOrder: 0,
        metadata: null,
      },
    ],
    custom: null,
    ...overrides,
  }
}

function buildCtx(record: Record<string, unknown> | null = null) {
  const created: Array<{ entity: string; data: Record<string, unknown> }> = []
  const em: Record<string, unknown> = {
    create: jest.fn((entity: { name: string }, data: Record<string, unknown>) => {
      created.push({ entity: entity.name, data })
      return { id: data.id ?? SERVICE_ID, ...data }
    }),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    nativeDelete: jest.fn().mockResolvedValue(0),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
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
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: null,
  }
  if (record) findOneWithDecryption.mockResolvedValue(record)
  return { ctx, em, created, dataEngine }
}

function buildRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: SERVICE_ID,
    organizationId: ORG,
    tenantId: TENANT,
    title: 'Workshop',
    description: null,
    scope: null,
    category: null,
    defaultPriceAmount: '100.0000',
    defaultPriceCurrencyCode: 'USD',
    defaultMediaId: null,
    defaultMediaUrl: null,
    metadata: null,
    isActive: true,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('catalog.services commands', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset().mockResolvedValue([])
  })

  it('creates a service with media, work requirements and custom fields', async () => {
    const command = loadCommand('catalog.services.create')
    const { ctx, created, dataEngine } = buildCtx()

    const result = await command.execute(
      {
        organizationId: ORG,
        tenantId: TENANT,
        title: '  Implementation workshop ',
        defaultPriceAmount: 125.5,
        defaultPriceCurrencyCode: 'USD',
        media: [{ fileId: '66666666-6666-4666-8666-666666666666', url: '/media/1.png', isDefault: true }],
        workRequirements: [
          { targetType: 'staff_role', targetId: '77777777-7777-4777-8777-777777777777', labelSnapshot: 'Lead', allocationMode: 'ratio', allocationValue: 0.5 },
        ],
        customFields: { priority: 'high' },
      },
      ctx,
    )

    expect(result.serviceId).toBe(SERVICE_ID)
    const service = created.find((entry) => entry.entity === 'CatalogService')
    expect(service?.data).toMatchObject({ title: 'Implementation workshop', defaultPriceAmount: '125.5', defaultPriceCurrencyCode: 'USD', category: null })
    expect(created.filter((entry) => entry.entity === 'CatalogServiceMedia')).toHaveLength(1)
    const requirement = created.find((entry) => entry.entity === 'CatalogServiceWorkRequirement')
    expect(requirement?.data).toMatchObject({ targetType: 'staff_role', allocationMode: 'ratio', allocationValue: '0.5', sortOrder: 0 })
    expect(setCustomFieldsIfAny).toHaveBeenCalledWith(
      expect.objectContaining({ dataEngine, entityId: SERVICE_ENTITY_ID, recordId: SERVICE_ID, values: { priority: 'high' } }),
    )
    expect(emitCrudSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'created', indexer: expect.objectContaining({ entityType: SERVICE_ENTITY_ID }) }),
    )
  })

  it('rejects a category that is not visible in the service scope', async () => {
    const command = loadCommand('catalog.services.create')
    const { ctx } = buildCtx()
    findOneWithDecryption.mockResolvedValue(null)

    await expect(
      command.execute({ organizationId: ORG, tenantId: TENANT, title: 'Workshop', categoryId: CATEGORY_ID }, ctx),
    ).rejects.toMatchObject({ status: 400 })
    expect(findOneWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ id: CATEGORY_ID, organizationId: ORG, tenantId: TENANT, deletedAt: null }),
      undefined,
      { organizationId: ORG, tenantId: TENANT },
    )
  })

  it('resolves the category before mutating scalars on update and writes custom fields', async () => {
    const command = loadCommand('catalog.services.update')
    const record = buildRecord()
    const { ctx } = buildCtx()
    let titleSeenDuringCategoryLookup: unknown
    findOneWithDecryption.mockImplementation(async (_em: unknown, entity: { name: string }) => {
      if (entity.name === 'CatalogService') return record
      titleSeenDuringCategoryLookup = record.title
      return { id: CATEGORY_ID }
    })

    await command.execute(
      { id: SERVICE_ID, title: 'Renamed', categoryId: CATEGORY_ID, customFields: { priority: 'low' } },
      ctx,
    )

    expect(titleSeenDuringCategoryLookup).toBe('Workshop')
    expect(record.title).toBe('Renamed')
    expect(record.category).toEqual({ id: CATEGORY_ID })
    expect(setCustomFieldsIfAny).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: SERVICE_ENTITY_ID, values: { priority: 'low' } }),
    )
  })

  it('leaves custom fields untouched when an update sends none', async () => {
    const command = loadCommand('catalog.services.update')
    const { ctx } = buildCtx(buildRecord())

    await command.execute({ id: SERVICE_ID, title: 'Renamed' }, ctx)

    expect(setCustomFieldsIfAny).not.toHaveBeenCalled()
  })

  it('restores the previous snapshot, children and custom fields on update undo', async () => {
    const command = loadCommand('catalog.services.update')
    const record = buildRecord({ title: 'Renamed', isActive: false })
    const { ctx, em, created } = buildCtx(record)

    await command.undo!({
      logEntry: {
        commandPayload: {
          undo: {
            before: buildSnapshot({ custom: { priority: 'high' } }),
            after: buildSnapshot({ title: 'Renamed', custom: { priority: 'low', owner: 'ops' } }),
          },
        },
      },
      ctx,
    })

    expect(record.title).toBe('Workshop')
    expect(record.isActive).toBe(true)
    expect(em.nativeDelete).toHaveBeenCalledTimes(2)
    expect(created.filter((entry) => entry.entity === 'CatalogServiceWorkRequirement')).toHaveLength(1)
    expect(setCustomFieldsIfAny).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: SERVICE_ENTITY_ID, values: { priority: 'high', owner: null } }),
    )
    expect(emitCrudUndoSideEffects).toHaveBeenCalledWith(expect.objectContaining({ action: 'updated' }))
  })

  it('soft-deletes the created service and clears its custom fields on create undo', async () => {
    const command = loadCommand('catalog.services.create')
    const record = buildRecord()
    const { ctx } = buildCtx(record)

    await command.undo!({
      logEntry: { commandPayload: { undo: { after: buildSnapshot({ custom: { priority: 'high' } }) } } },
      ctx,
    })

    expect(record.deletedAt).toBeInstanceOf(Date)
    expect(record.isActive).toBe(false)
    expect(setCustomFieldsIfAny).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: SERVICE_ENTITY_ID, values: { priority: null } }),
    )
    expect(emitCrudUndoSideEffects).toHaveBeenCalledWith(expect.objectContaining({ action: 'deleted' }))
  })

  it('archives on delete and brings the service back on delete undo', async () => {
    const command = loadCommand('catalog.services.delete')
    const record = buildRecord()
    const { ctx } = buildCtx(record)

    await command.execute({ id: SERVICE_ID }, ctx)
    expect(record.deletedAt).toBeInstanceOf(Date)
    expect(record.isActive).toBe(false)
    expect(emitCrudSideEffects).toHaveBeenCalledWith(expect.objectContaining({ action: 'deleted' }))

    await command.undo!({
      logEntry: { commandPayload: { undo: { before: buildSnapshot({ custom: { priority: 'high' } }) } } },
      ctx,
    })
    expect(record.deletedAt).toBeNull()
    expect(record.isActive).toBe(true)
    expect(setCustomFieldsIfAny).toHaveBeenLastCalledWith(
      expect.objectContaining({ values: { priority: 'high' } }),
    )
    expect(emitCrudUndoSideEffects).toHaveBeenCalledWith(expect.objectContaining({ action: 'created' }))
  })

  it('refuses to update a service from another organization', async () => {
    const command = loadCommand('catalog.services.update')
    const { ctx } = buildCtx(buildRecord({ organizationId: '88888888-8888-4888-8888-888888888888' }))

    await expect(command.execute({ id: SERVICE_ID, title: 'Renamed' }, ctx)).rejects.toBeDefined()
    expect(setCustomFieldsIfAny).not.toHaveBeenCalled()
  })

  it('redoes an undone create by restoring the original service id, children and custom fields', async () => {
    const command = loadCommand('catalog.services.create')
    const record = buildRecord({ deletedAt: new Date('2026-01-02T00:00:00.000Z'), isActive: false })
    const { ctx, em, created } = buildCtx(record)
    const snapshot = buildSnapshot({ custom: { priority: 'high' } })

    const result = await command.redo!({
      input: {},
      logEntry: { resourceId: SERVICE_ID, commandPayload: { undo: { after: snapshot } }, snapshotAfter: snapshot },
      ctx,
    })

    expect(result).toEqual({ serviceId: SERVICE_ID })
    expect(created.filter((entry) => entry.entity === 'CatalogService')).toHaveLength(0)
    expect(record.deletedAt).toBeNull()
    expect(record.isActive).toBe(true)
    expect(em.nativeDelete).toHaveBeenCalledTimes(2)
    expect(created.filter((entry) => entry.entity === 'CatalogServiceWorkRequirement')).toHaveLength(1)
    expect(setCustomFieldsIfAny).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: SERVICE_ENTITY_ID, recordId: SERVICE_ID, values: { priority: 'high' } }),
    )
    expect(emitCrudSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'created', indexer: expect.objectContaining({ entityType: SERVICE_ENTITY_ID }) }),
    )
  })

  it('moves the default media to a surviving item when the media list is replaced', async () => {
    const command = loadCommand('catalog.services.update')
    const record = buildRecord({ defaultMediaId: 'old-file', defaultMediaUrl: '/old.png' })
    const { ctx } = buildCtx(record)

    await command.execute(
      {
        id: SERVICE_ID,
        media: [
          { fileId: '66666666-6666-4666-8666-666666666666', url: '/new-a.png' },
          { fileId: '77777777-7777-4777-8777-777777777777', url: '/new-b.png', isDefault: true },
        ],
      },
      ctx,
    )

    expect(record.defaultMediaId).toBe('77777777-7777-4777-8777-777777777777')
    expect(record.defaultMediaUrl).toBe('/new-b.png')
  })

  it('keeps the default media when it is still part of the replaced list', async () => {
    const command = loadCommand('catalog.services.update')
    const keptFile = '66666666-6666-4666-8666-666666666666'
    const record = buildRecord({ defaultMediaId: keptFile, defaultMediaUrl: '/kept.png' })
    const { ctx } = buildCtx(record)

    await command.execute(
      {
        id: SERVICE_ID,
        media: [
          { fileId: '77777777-7777-4777-8777-777777777777', url: '/other.png', isDefault: true },
          { fileId: keptFile, url: '/kept.png' },
        ],
      },
      ctx,
    )

    expect(record.defaultMediaId).toBe(keptFile)
    expect(record.defaultMediaUrl).toBe('/kept.png')
  })

  it('answers a missing service with a translated 404', async () => {
    const command = loadCommand('catalog.services.update')
    const { ctx } = buildCtx()
    findOneWithDecryption.mockResolvedValue(null)

    await expect(command.execute({ id: SERVICE_ID, title: 'Renamed' }, ctx)).rejects.toMatchObject({
      status: 404,
      body: { error: 'Service not found' },
    })
  })
})
