/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import {
  InventoryBalance,
  InventoryLot,
  InventoryMovement,
  InventoryReservation,
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
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333'
const WAREHOUSE_ID = '55555555-5555-4555-8555-555555555555'
const LOCATION_A = '66666666-6666-4666-8666-666666666661'
const LOCATION_B = '66666666-6666-4666-8666-666666666662'
const VARIANT_ID = '77777777-7777-4777-8777-777777777777'
const REFERENCE_ID = '88888888-8888-4888-8888-888888888888'
const USER_ID = '99999999-9999-4999-8999-999999999999'
const ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const TRANSACTION_CONTEXT = { kind: 'transaction-context' }

type ProfileFixture = {
  catalogProductId: string
  catalogVariantId: string | null
  trackLot: boolean
  trackSerial: boolean
  trackExpiration: boolean
  defaultStrategy: 'fifo' | 'lifo' | 'fefo'
}

function makeProfile(overrides: Partial<ProfileFixture> = {}) {
  return {
    id: 'profile-1',
    tenantId: TENANT,
    organizationId: ORG,
    catalogProductId: PRODUCT_ID,
    catalogVariantId: null,
    trackLot: false,
    trackSerial: false,
    trackExpiration: false,
    defaultStrategy: 'fifo',
    ...overrides,
  }
}

function createEm() {
  const execute = jest.fn(async () => [{ product_id: PRODUCT_ID }])
  const em = {
    findOne: jest.fn(),
    create: jest.fn((_entity: unknown, payload: Record<string, unknown>) => ({
      id: 'generated-id',
      ...payload,
    })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    getConnection: jest.fn(() => ({ execute })),
    getTransactionContext: jest.fn(() => TRANSACTION_CONTEXT),
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
        if (name === 'rbacService') return { userHasAllFeatures: async () => true }
        throw new Error(`Unexpected resolve: ${name}`)
      },
    },
    auth: { sub: USER_ID, tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

function makeBalance(overrides: Record<string, unknown> = {}) {
  return {
    id: 'balance-1',
    tenantId: TENANT,
    organizationId: ORG,
    warehouse: { id: WAREHOUSE_ID },
    location: { id: LOCATION_A },
    catalogVariantId: VARIANT_ID,
    lot: null,
    serialNumber: null,
    quantityOnHand: '10',
    quantityReserved: '0',
    quantityAllocated: '0',
    createdAt: new Date('2024-01-01'),
    ...overrides,
  }
}

function resolveProfile(
  where: Record<string, unknown>,
  profiles: { variant: ReturnType<typeof makeProfile> | null; product: ReturnType<typeof makeProfile> | null },
) {
  if (where.catalogVariantId === VARIANT_ID) return profiles.variant
  if (where.catalogProductId === PRODUCT_ID && where.catalogVariantId === null) return profiles.product
  return null
}

function mockReceiveLookups(profiles: {
  variant: ReturnType<typeof makeProfile> | null
  product: ReturnType<typeof makeProfile> | null
}) {
  const balance = makeBalance()
  findOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
    if (entity === Warehouse) return { id: WAREHOUSE_ID, tenantId: TENANT, organizationId: ORG }
    if (entity === WarehouseLocation) {
      return { id: LOCATION_A, tenantId: TENANT, organizationId: ORG, warehouse: { id: WAREHOUSE_ID } }
    }
    if (entity === InventoryBalance) return balance
    if (entity === InventoryMovement) return null
    if (entity === ProductInventoryProfile) return resolveProfile(where, profiles)
    return null
  })
  findWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
    if (entity === InventoryBalance) return [balance]
    return []
  })
}

function receive(em: ReturnType<typeof createEm>['em']) {
  return commandRegistry.get('wms.inventory.receive')!.execute!(
    {
      organizationId: ORG,
      tenantId: TENANT,
      warehouseId: WAREHOUSE_ID,
      locationId: LOCATION_A,
      catalogVariantId: VARIANT_ID,
      quantity: 3,
      referenceType: 'manual',
      referenceId: REFERENCE_ID,
      performedBy: USER_ID,
    },
    createCtx(em),
  )
}

describe('wms inventory actions honor product-level inventory profiles', () => {
  beforeAll(async () => {
    await import('../inventory-actions')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
  })

  it('rejects a receipt without a lot when only the product-level profile requires lot tracking', async () => {
    const { em, execute } = createEm()
    mockReceiveLookups({ variant: null, product: makeProfile({ trackLot: true }) })

    await expect(receive(em)).rejects.toMatchObject({ status: 422, body: { error: 'lot_required' } })
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('from catalog_product_variants'),
      [VARIANT_ID, ORG, TENANT],
      'all',
      TRANSACTION_CONTEXT,
    )
    expect(em.persist).not.toHaveBeenCalled()
  })

  it('rejects a receipt without a serial number when only the product-level profile requires serial tracking', async () => {
    const { em } = createEm()
    mockReceiveLookups({ variant: null, product: makeProfile({ trackSerial: true }) })

    await expect(receive(em)).rejects.toMatchObject({ status: 422, body: { error: 'serial_required' } })
  })

  it('lets a variant-level profile override a stricter product-level profile on receipt', async () => {
    const { em, execute } = createEm()
    mockReceiveLookups({
      variant: makeProfile({ catalogVariantId: VARIANT_ID, trackLot: false }),
      product: makeProfile({ trackLot: true }),
    })

    await expect(receive(em)).resolves.toMatchObject({ movementId: expect.any(String) })
    expect(execute).not.toHaveBeenCalled()
  })

  it('allocates a reservation FEFO when only the product-level profile tracks expiration', async () => {
    const { em } = createEm()
    const olderLaterExpiry = makeBalance({
      id: 'balance-older',
      location: { id: LOCATION_A },
      lot: { id: 'lot-late', status: 'available', expiresAt: new Date('2099-12-31') } as unknown as InventoryLot,
      createdAt: new Date('2024-01-01'),
    })
    const newerEarlierExpiry = makeBalance({
      id: 'balance-newer',
      location: { id: LOCATION_B },
      lot: { id: 'lot-early', status: 'available', expiresAt: new Date('2099-01-31') } as unknown as InventoryLot,
      createdAt: new Date('2024-06-01'),
    })
    const profiles = { variant: null, product: makeProfile({ trackExpiration: true }) }

    findOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === Warehouse) return { id: WAREHOUSE_ID, tenantId: TENANT, organizationId: ORG }
      if (entity === InventoryReservation) return null
      if (entity === ProductInventoryProfile) return resolveProfile(where, profiles)
      if (entity === InventoryBalance) {
        if (where?.location === LOCATION_A) return olderLaterExpiry
        if (where?.location === LOCATION_B) return newerEarlierExpiry
      }
      return null
    })
    findWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === InventoryBalance) return [olderLaterExpiry, newerEarlierExpiry]
      return []
    })

    await commandRegistry.get('wms.inventory.reserve')!.execute!(
      {
        organizationId: ORG,
        tenantId: TENANT,
        warehouseId: WAREHOUSE_ID,
        catalogVariantId: VARIANT_ID,
        quantity: 5,
        sourceType: 'order',
        sourceId: ORDER_ID,
        performedBy: USER_ID,
      },
      createCtx(em),
    )

    expect(Number(newerEarlierExpiry.quantityReserved)).toBe(5)
    expect(Number(olderLaterExpiry.quantityReserved)).toBe(0)
  })
})
