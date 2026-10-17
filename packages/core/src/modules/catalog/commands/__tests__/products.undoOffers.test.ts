export {}

const registerCommand = jest.fn()
const findWithDecryption = jest.fn()
const findOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

type OfferRow = {
  id: string
  channelId: string
  title: string
  description: string | null
  defaultMediaId: string | null
  defaultMediaUrl: string | null
  metadata: Record<string, unknown> | null
  isActive: boolean
}

type UndoHandler = { undo: (opts: { logEntry: unknown; ctx: unknown }) => Promise<void> }

const productId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const tenantId = '33333333-3333-4333-8333-333333333333'

function offer(id: string, channelId: string, overrides: Partial<OfferRow> = {}): OfferRow {
  return {
    id,
    channelId,
    title: `Offer ${id}`,
    description: null,
    defaultMediaId: null,
    defaultMediaUrl: null,
    metadata: null,
    isActive: true,
    ...overrides,
  }
}

function productSnapshot(offers: OfferRow[], title = 'Old title') {
  return {
    id: productId,
    organizationId,
    tenantId,
    title,
    subtitle: null,
    description: null,
    sku: null,
    handle: null,
    taxRateId: null,
    taxRate: null,
    productType: 'simple',
    statusEntryId: null,
    primaryCurrencyCode: null,
    defaultUnit: null,
    defaultSalesUnit: null,
    defaultSalesUnitQuantity: '1',
    weightValue: null,
    weightUnit: null,
    dimensions: null,
    metadata: null,
    customFieldsetCode: null,
    optionSchemaId: null,
    isConfigurable: false,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    offers: offers.map((entry) => ({ ...entry, metadata: entry.metadata ? { ...entry.metadata } : null })),
    categoryIds: [],
    tags: [],
    custom: {},
  }
}

function loadUpdateCommand(): UndoHandler {
  let command: UndoHandler | undefined
  jest.isolateModules(() => {
    require('../products')
    command = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'catalog.products.update')?.[0]
  })
  if (!command) throw new Error('catalog.products.update not registered')
  return command
}

function createHarness(current: OfferRow[]) {
  const rows: OfferRow[] = current.map((entry) => ({ ...entry }))
  const removed: OfferRow[] = []
  const created: OfferRow[] = []
  const events: string[] = []
  const record = { ...productSnapshot([]), optionSchemaTemplate: null, createdAt: new Date(), updatedAt: new Date() }
  const em = {
    findOne: jest.fn().mockResolvedValue(record),
    find: jest.fn().mockImplementation(async (entity: unknown) => {
      const name = typeof entity === 'function' ? (entity as { name: string }).name : String(entity)
      if (name === 'CatalogOffer') return rows.slice()
      return []
    }),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockImplementation((entity: unknown, payload: Record<string, unknown>) => {
      const name = typeof entity === 'function' ? (entity as { name: string }).name : String(entity)
      if (name !== 'CatalogOffer') return payload
      const row = offer(String(payload.id), String(payload.channelId))
      created.push(row)
      events.push(`create:${row.id}`)
      return row
    }),
    remove: jest.fn().mockImplementation((entity: OfferRow) => {
      removed.push(entity)
      events.push(`remove:${entity.id}`)
    }),
    persist: jest.fn(),
    flush: jest.fn().mockImplementation(async () => {
      events.push(`flush:${rows.map((row) => `${row.id}@${row.channelId}`).join(',')}`)
    }),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn(),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  const ctx = {
    container: {
      resolve: jest.fn((token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return { markOrmEntityChange: jest.fn() }
        return undefined
      }),
    },
    auth: { sub: 'user-1', tenantId, orgId: organizationId },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  }
  findOneWithDecryption.mockResolvedValue(record)
  findWithDecryption.mockResolvedValue([])
  const byId = (id: string) => rows.find((row) => row.id === id)
  return { ctx, removed, created, byId, events }
}

async function undoUpdate(beforeOffers: OfferRow[], afterOffers: OfferRow[], current: OfferRow[]) {
  const harness = createHarness(current)
  const logEntry = {
    payload: {
      undo: {
        before: productSnapshot(beforeOffers),
        after: productSnapshot(afterOffers, 'New title'),
      },
    },
  }
  await loadUpdateCommand().undo({ logEntry, ctx: harness.ctx })
  return harness
}

describe('catalog.products.update undo — offers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('keeps an offer that was added after the update', async () => {
    const offerA = offer('offer-a', 'web')
    const later = offer('offer-b', 'retail')
    const { removed } = await undoUpdate([offerA], [offerA], [offerA, later])
    expect(removed.map((row) => row.id)).toEqual([])
  })

  it('keeps a later edit to an offer the update did not change', async () => {
    const offerA = offer('offer-a', 'web', { title: 'Original' })
    const { byId, removed } = await undoUpdate([offerA], [offerA], [{ ...offerA, title: 'Edited later' }])
    expect(byId('offer-a')?.title).toBe('Edited later')
    expect(removed).toHaveLength(0)
  })

  it('does not resurrect an offer that was deleted after the update', async () => {
    const offerA = offer('offer-a', 'web')
    const { created } = await undoUpdate([offerA], [offerA], [])
    expect(created).toHaveLength(0)
  })

  it('removes an offer the update created when it is unchanged since', async () => {
    const added = offer('offer-c', 'retail')
    const { removed } = await undoUpdate([], [added], [added])
    expect(Array.from(new Set(removed.map((row) => row.id)))).toEqual(['offer-c'])
  })

  it('keeps an offer the update created when it was edited afterwards', async () => {
    const added = offer('offer-c', 'retail')
    const { removed } = await undoUpdate([], [added], [{ ...added, title: 'Edited later' }])
    expect(removed).toHaveLength(0)
  })

  it('reverts an offer the update edited when it is unchanged since', async () => {
    const beforeOffer = offer('offer-a', 'web', { title: 'Before', metadata: { a: 1, b: 2 } })
    const afterOffer = { ...beforeOffer, title: 'After', metadata: { a: 1, b: 3 } }
    const { byId } = await undoUpdate([beforeOffer], [afterOffer], [{ ...afterOffer, metadata: { b: 3, a: 1 } }])
    expect(byId('offer-a')?.title).toBe('Before')
    expect(byId('offer-a')?.metadata).toEqual({ a: 1, b: 2 })
  })

  it('keeps a later edit to an offer the update edited', async () => {
    const beforeOffer = offer('offer-a', 'web', { title: 'Before' })
    const afterOffer = { ...beforeOffer, title: 'After' }
    const { byId } = await undoUpdate([beforeOffer], [afterOffer], [{ ...afterOffer, title: 'Edited later' }])
    expect(byId('offer-a')?.title).toBe('Edited later')
  })

  it('recreates an offer the update removed', async () => {
    const removedByUpdate = offer('offer-a', 'web', { title: 'Restore me' })
    const { created } = await undoUpdate([removedByUpdate], [], [])
    expect(created.map((row) => [row.id, row.channelId, row.title])).toEqual([['offer-a', 'web', 'Restore me']])
  })

  it('keeps a newer offer that took the channel of an offer the update removed', async () => {
    const removedByUpdate = offer('offer-a', 'web')
    const newer = offer('offer-d', 'web')
    const { created, removed } = await undoUpdate([removedByUpdate], [], [newer])
    expect(removed).toHaveLength(0)
    expect(created).toHaveLength(0)
  })

  it('flushes the removal before moving an offer back onto the freed channel', async () => {
    const beforeA = offer('offer-a', 'web')
    const afterA = { ...beforeA, channelId: 'retail' }
    const addedOnWeb = offer('offer-c', 'web')
    const { byId, events } = await undoUpdate([beforeA], [afterA, addedOnWeb], [afterA, addedOnWeb])
    expect(byId('offer-a')?.channelId).toBe('web')
    const removeIndex = events.indexOf('remove:offer-c')
    expect(removeIndex).toBeGreaterThanOrEqual(0)
    expect(events[removeIndex + 1]?.startsWith('flush:')).toBe(true)
  })

  it('moves an offer off a channel before recreating the removed offer that owned it', async () => {
    const beforeA = offer('offer-a', 'web')
    const beforeB = offer('offer-b', 'retail')
    const afterA = { ...beforeA, channelId: 'retail' }
    const { byId, created, events } = await undoUpdate([beforeA, beforeB], [afterA], [afterA])
    expect(byId('offer-a')?.channelId).toBe('web')
    expect(created.map((row) => [row.id, row.channelId])).toEqual([['offer-b', 'retail']])
    const createIndex = events.indexOf('create:offer-b')
    expect(events.slice(0, createIndex)).toContain('flush:offer-a@web')
  })
})
