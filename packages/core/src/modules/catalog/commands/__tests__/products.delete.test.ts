export {}

import { CatalogOffer, CatalogProductVariant } from '../../data/entities'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

const registerCommand = jest.fn()
const emitCatalogQueryIndexEvent = jest.fn().mockResolvedValue(undefined)
const setCustomFieldsIfAny = jest.fn().mockResolvedValue(undefined)
const loadCustomFieldSnapshot = jest.fn().mockResolvedValue({})

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

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/customFieldSnapshots')
  return {
    ...actual,
    loadCustomFieldSnapshot,
  }
})

jest.mock('../shared', () => {
  const actual = jest.requireActual('../shared')
  return {
    ...actual,
    emitCatalogQueryIndexEvent,
  }
})

describe('catalog.products.delete', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('emits reindex events for variants when a product is deleted', async () => {
    let deleteCommand: any
    jest.isolateModules(() => {
      require('../products')
      deleteCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'catalog.products.delete')?.[0]
    })
    expect(deleteCommand).toBeDefined()

    const variants = [
      { id: 'variant-1', organizationId: 'org-1', tenantId: 'tenant-1' },
      { id: 'variant-2', organizationId: 'org-1', tenantId: 'tenant-1' },
    ]
    const now = new Date()
    const em = {
      findOne: jest.fn().mockResolvedValue({
        id: 'prod-1',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        title: 'Test product',
        subtitle: null,
        description: null,
        sku: null,
        handle: null,
        taxRateId: null,
        taxRate: null,
        productType: 'standard',
        statusEntryId: null,
        primaryCurrencyCode: null,
        defaultUnit: null,
        defaultMediaId: null,
        defaultMediaUrl: null,
        weightValue: null,
        weightUnit: null,
        dimensions: null,
        metadata: null,
        isConfigurable: false,
        isActive: true,
        optionSchemaTemplate: null,
        customFieldsetCode: null,
        createdAt: now,
        updatedAt: now,
      }),
      find: jest.fn().mockImplementation((entity) => {
        const name = typeof entity === 'function' ? entity.name : ''
        if (name === CatalogProductVariant.name) return Promise.resolve(variants)
        if (name === CatalogOffer.name) return Promise.resolve([])
        return Promise.resolve([])
      }),
      nativeDelete: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
      fork: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
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

    await deleteCommand.execute({ id: 'prod-1' }, ctx)

    expect(emitCatalogQueryIndexEvent).toHaveBeenCalledTimes(variants.length)
    const payloads = emitCatalogQueryIndexEvent.mock.calls.map(([, payload]) => payload)
    expect(payloads).toEqual([
      expect.objectContaining({
        entityType: E.catalog.catalog_product_variant,
        recordId: 'variant-1',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        action: 'deleted',
      }),
      expect.objectContaining({
        entityType: E.catalog.catalog_product_variant,
        recordId: 'variant-2',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        action: 'deleted',
      }),
    ])
  })
})
