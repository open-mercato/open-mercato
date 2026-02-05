export {}

import { CatalogOffer, CatalogProductCategoryAssignment } from '../../data/entities'

const registerCommand = jest.fn()
const findWithDecryption = jest.fn().mockImplementation(async (...args: unknown[]) => {
  const ctx = (findWithDecryption as any).__ctx as { events: string[] } | undefined
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
    let updateCommand: any
    jest.isolateModules(() => {
      require('../products')
      updateCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'catalog.products.update')?.[0]
    })
    expect(updateCommand).toBeDefined()

    const events: string[] = []
    ;(findWithDecryption as any).__ctx = { events }

    const record = {
      id: 'prod-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
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
      find: jest.fn().mockImplementation(async (entity: any) => {
        const name = typeof entity === 'function' ? entity.name : String(entity)
        events.push(`find:${name}`)
        return []
      }),
      create: jest.fn().mockImplementation((_entity: any, payload: any) => payload),
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
      auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' },
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }

    await updateCommand.execute(
      {
        id: 'prod-1',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
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
})
