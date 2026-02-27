export {}

import { CatalogOffer, CatalogProductCategoryAssignment } from '../../data/entities'

const registerCommand = jest.fn()
const findWithDecryption = jest.fn().mockImplementation(async (...args: unknown[]) => {
  const ctx = (findWithDecryption as unknown as Record<string, unknown>).__ctx as { events: string[] } | undefined
  ctx?.events.push('findWithDecryption')
  return []
})
const findOneWithDecryption = jest.fn().mockResolvedValue(null)

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

describe('catalog.products.update', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('flushes product changes before syncing offers/categories/tags', async () => {
    let updateCommand: unknown
    jest.isolateModules(() => {
      require('../products')
      updateCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'catalog.products.update')?.[0]
    })
    expect(updateCommand).toBeDefined()

    const events: string[] = []
    ;(findWithDecryption as unknown as Record<string, unknown>).__ctx = { events }

    const record = {
      id: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      tenantId: '33333333-3333-4333-8333-333333333333',
      title: 'Old title',
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
      defaultMediaId: null,
      defaultMediaUrl: null,
      weightValue: null,
      weightUnit: null,
      dimensions: null,
      metadata: null,
      customFieldsetCode: null,
      optionSchemaTemplate: null,
      isConfigurable: false,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const em = {
      findOne: jest.fn().mockImplementation(async () => {
        events.push('findOne')
        return record
      }),
      find: jest.fn().mockImplementation(async (entity: unknown) => {
        const name = typeof entity === 'function' ? (entity as { name: string }).name : String(entity)
        events.push(`find:${name}`)
        return []
      }),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation((_entity: unknown, payload: unknown) => payload),
      remove: jest.fn(),
      persist: jest.fn(),
      flush: jest.fn().mockImplementation(async () => {
        events.push('flush')
      }),
      fork: jest.fn(),
    }
    em.fork.mockReturnValue(em)

    const dataEngine = {
      markOrmEntityChange: jest.fn(),
    }

    const container = {
      resolve: jest.fn((token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return dataEngine
        return undefined
      }),
    }

    const ctx = {
      container,
      auth: {
        sub: 'user-1',
        tenantId: '33333333-3333-4333-8333-333333333333',
        orgId: '22222222-2222-4222-8222-222222222222',
      },
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }

    findOneWithDecryption.mockResolvedValue(record)

    await (updateCommand as { execute: (payload: Record<string, unknown>, ctx: unknown) => Promise<void> }).execute(
      {
        id: '11111111-1111-4111-8111-111111111111',
        organizationId: '22222222-2222-4222-8222-222222222222',
        tenantId: '33333333-3333-4333-8333-333333333333',
        title: 'New title',
        offers: [],
        categoryIds: [],
        tags: [],
      },
      ctx
    )

    const firstFlush = events.indexOf('flush')
    const firstFind = events.findIndex((entry) => entry.startsWith('find:'))
    const firstFindWithDecryption = events.indexOf('findWithDecryption')

    expect(firstFlush).toBeGreaterThan(-1)
    expect(firstFind).toBeGreaterThan(-1)
    expect(firstFlush).toBeLessThan(firstFind)
    expect(firstFlush).toBeLessThan(firstFindWithDecryption)
    expect(events).toContain(`find:${CatalogOffer.name}`)
    expect(events).toContain(`find:${CatalogProductCategoryAssignment.name}`)
  })

  it('rejects clearing base unit when default sales unit is configured', async () => {
    let updateCommand: unknown
    jest.isolateModules(() => {
      require('../products')
      updateCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'catalog.products.update')?.[0]
    })
    expect(updateCommand).toBeDefined()

    const record = {
      id: '11111111-1111-4111-8111-111111111112',
      organizationId: '22222222-2222-4222-8222-222222222222',
      tenantId: '33333333-3333-4333-8333-333333333333',
      title: 'Old title',
      subtitle: null,
      description: null,
      sku: null,
      handle: null,
      taxRateId: null,
      taxRate: null,
      productType: 'simple',
      statusEntryId: null,
      primaryCurrencyCode: null,
      defaultUnit: 'm2',
      defaultSalesUnit: 'pkg',
      defaultSalesUnitQuantity: '1',
      uomRoundingScale: 4,
      uomRoundingMode: 'half_up',
      unitPriceEnabled: false,
      unitPriceReferenceUnit: null,
      unitPriceBaseQuantity: null,
      defaultMediaId: null,
      defaultMediaUrl: null,
      weightValue: null,
      weightUnit: null,
      dimensions: null,
      metadata: null,
      customFieldsetCode: null,
      optionSchemaTemplate: null,
      isConfigurable: false,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const em = {
      findOne: jest.fn().mockResolvedValue(record),
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation((_entity: unknown, payload: unknown) => payload),
      remove: jest.fn(),
      persist: jest.fn(),
      flush: jest.fn(),
      fork: jest.fn(),
    }
    em.fork.mockReturnValue(em)

    const dataEngine = {
      markOrmEntityChange: jest.fn(),
    }

    const container = {
      resolve: jest.fn((token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return dataEngine
        return undefined
      }),
    }

    const ctx = {
      container,
      auth: {
        sub: 'user-1',
        tenantId: '33333333-3333-4333-8333-333333333333',
        orgId: '22222222-2222-4222-8222-222222222222',
      },
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }

    findOneWithDecryption.mockResolvedValue(record)

    await expect(
      (updateCommand as { execute: (payload: Record<string, unknown>, ctx: unknown) => Promise<void> }).execute(
        {
          id: '11111111-1111-4111-8111-111111111112',
          organizationId: '22222222-2222-4222-8222-222222222222',
          tenantId: '33333333-3333-4333-8333-333333333333',
          defaultUnit: null,
        },
        ctx,
      ),
    ).rejects.toMatchObject({
      status: 400,
      body: { error: 'uom.default_unit_missing' },
    })
  })
})
