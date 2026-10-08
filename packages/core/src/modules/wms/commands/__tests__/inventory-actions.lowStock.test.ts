/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { emitWmsEvent } from '../../events'
import {
  InventoryBalance,
  InventoryMovement,
  ProductInventoryProfile,
  Warehouse,
  WarehouseLocation,
} from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn(async () => undefined),
}))

jest.mock('../../events', () => ({
  emitWmsEvent: jest.fn(async () => undefined),
}))

const findOneWithDecryption = jest.fn()
const findWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const WAREHOUSE_ID = '55555555-5555-4555-8555-555555555555'
const LOCATION_ID = '66666666-6666-4666-8666-666666666666'
const VARIANT_ID = '77777777-7777-4777-8777-777777777777'
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333'
const USER_ID = '99999999-9999-4999-8999-999999999999'
const REFERENCE_ID = '88888888-8888-4888-8888-888888888888'

function createEm(variantRows: Array<{ product_id: string | null }>) {
  const execute = jest.fn(async () => variantRows)
  const em = {
    findOne: jest.fn(),
    create: jest.fn((_entity: unknown, payload: Record<string, unknown>) => ({
      id: 'movement-1',
      ...payload,
    })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    getConnection: jest.fn(() => ({ execute })),
    fork: jest.fn(),
    transactional: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(
    async (cb: (trx: typeof em) => Promise<unknown>) => cb(em),
  )
  return { em, execute }
}

function createCtx(em: ReturnType<typeof createEm>['em']) {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return {}
        throw new Error(`Unexpected resolve: ${name}`)
      },
    },
    auth: { sub: USER_ID, tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

function buildBalance() {
  return {
    id: 'balance-1',
    tenantId: TENANT,
    organizationId: ORG,
    warehouse: { id: WAREHOUSE_ID },
    location: { id: LOCATION_ID },
    catalogVariantId: VARIANT_ID,
    lot: null,
    serialNumber: null,
    quantityOnHand: '10',
    quantityReserved: '0',
    quantityAllocated: '0',
  }
}

function mockLookups(
  balance: ReturnType<typeof buildBalance>,
  profiles: { variant: Record<string, unknown> | null; product: Record<string, unknown> | null },
) {
  findOneWithDecryption.mockImplementation((_em, entity, where: Record<string, unknown>) => {
    if (entity === Warehouse) return { id: WAREHOUSE_ID, tenantId: TENANT, organizationId: ORG }
    if (entity === WarehouseLocation) {
      return { id: LOCATION_ID, tenantId: TENANT, organizationId: ORG, warehouse: { id: WAREHOUSE_ID } }
    }
    if (entity === InventoryBalance) return balance
    if (entity === InventoryMovement) return null
    if (entity === ProductInventoryProfile) {
      if (where.catalogVariantId === VARIANT_ID) return profiles.variant
      if (where.catalogProductId === PRODUCT_ID && where.catalogVariantId === null) return profiles.product
    }
    return null
  })
  findWithDecryption.mockImplementation(async (_em, entity) => {
    if (entity === InventoryBalance) return [balance]
    return []
  })
}

async function adjustDown(em: ReturnType<typeof createEm>['em'], delta: number) {
  const handler = commandRegistry.get('wms.inventory.adjust')
  await handler!.execute!(
    {
      organizationId: ORG,
      tenantId: TENANT,
      warehouseId: WAREHOUSE_ID,
      locationId: LOCATION_ID,
      catalogVariantId: VARIANT_ID,
      delta,
      reason: 'damage',
      referenceId: REFERENCE_ID,
      performedBy: USER_ID,
    },
    createCtx(em),
  )
  await new Promise((resolve) => setImmediate(resolve))
}

function lowStockEmissions() {
  return (emitWmsEvent as jest.Mock).mock.calls.filter(([eventId]) => eventId === 'wms.inventory.low_stock')
}

describe('wms inventory low stock event profile resolution', () => {
  beforeAll(async () => {
    await import('../inventory-actions')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
    ;(emitWmsEvent as jest.Mock).mockClear()
  })

  it('emits low stock from a product-level profile when the variant has no profile of its own', async () => {
    const { em, execute } = createEm([{ product_id: PRODUCT_ID }])
    const balance = buildBalance()
    mockLookups(balance, {
      variant: null,
      product: {
        tenantId: TENANT,
        organizationId: ORG,
        catalogProductId: PRODUCT_ID,
        catalogVariantId: null,
        reorderPoint: '10',
        safetyStock: '5',
      },
    })

    await adjustDown(em, -8)

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('select product_id from catalog_product_variants'),
      [VARIANT_ID, ORG, TENANT],
    )
    expect(lowStockEmissions()).toEqual([
      [
        'wms.inventory.low_stock',
        expect.objectContaining({
          catalogVariantId: VARIANT_ID,
          availableQuantity: '2',
          state: 'below_safety_stock',
          tenantId: TENANT,
          organizationId: ORG,
        }),
      ],
    ])
  })

  it('keeps the variant-level profile authoritative and skips the product lookup', async () => {
    const { em, execute } = createEm([{ product_id: PRODUCT_ID }])
    const balance = buildBalance()
    mockLookups(balance, {
      variant: {
        tenantId: TENANT,
        organizationId: ORG,
        catalogProductId: PRODUCT_ID,
        catalogVariantId: VARIANT_ID,
        reorderPoint: '1',
        safetyStock: '0',
      },
      product: {
        tenantId: TENANT,
        organizationId: ORG,
        catalogProductId: PRODUCT_ID,
        catalogVariantId: null,
        reorderPoint: '10',
        safetyStock: '5',
      },
    })

    await adjustDown(em, -8)

    expect(execute).not.toHaveBeenCalled()
    expect(lowStockEmissions()).toEqual([])
  })

  it('emits nothing when neither a variant nor a product-level profile exists', async () => {
    const { em } = createEm([{ product_id: PRODUCT_ID }])
    const balance = buildBalance()
    mockLookups(balance, { variant: null, product: null })

    await adjustDown(em, -8)

    expect(lowStockEmissions()).toEqual([])
  })
})
