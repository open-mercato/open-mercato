/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import {
  InventoryBalance,
  InventoryMovement,
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
const USER_ID = '99999999-9999-4999-8999-999999999999'
const REFERENCE_ID = '88888888-8888-4888-8888-888888888888'
const MOVEMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function createEm() {
  const em = {
    findOne: jest.fn(),
    create: jest.fn((_entity: unknown, payload: Record<string, unknown>) => ({
      id: 'generated-id',
      ...payload,
    })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    fork: jest.fn(),
    transactional: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(
    async (cb: (trx: typeof em) => Promise<unknown>) => cb(em),
  )
  return em
}

function createCtx(em: ReturnType<typeof createEm>) {
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

function baseFixtures(balanceOnHand: string) {
  const balance = {
    id: 'balance-1',
    tenantId: TENANT,
    organizationId: ORG,
    warehouse: { id: WAREHOUSE_ID },
    location: { id: LOCATION_ID },
    catalogVariantId: VARIANT_ID,
    lot: null,
    serialNumber: null,
    quantityOnHand: balanceOnHand,
    quantityReserved: '0',
    quantityAllocated: '0',
  }
  const existingMovement = {
    id: MOVEMENT_ID,
    tenantId: TENANT,
    organizationId: ORG,
    lot: null,
    quantity: '3',
  }
  return { balance, existingMovement }
}

function mockWarehouseLocationBalance(
  balance: ReturnType<typeof baseFixtures>['balance'],
  onMovement: (where: Record<string, unknown> | undefined) => unknown,
) {
  findOneWithDecryption.mockImplementation(async (_em, entity, where) => {
    if (entity === Warehouse) {
      return { id: WAREHOUSE_ID, tenantId: TENANT, organizationId: ORG, deletedAt: null }
    }
    if (entity === WarehouseLocation) {
      return {
        id: LOCATION_ID,
        tenantId: TENANT,
        organizationId: ORG,
        warehouse: { id: WAREHOUSE_ID },
        deletedAt: null,
        isActive: true,
      }
    }
    if (entity === InventoryBalance) return balance
    if (entity === InventoryMovement) {
      return onMovement(where as Record<string, unknown> | undefined)
    }
    return null
  })
}

describe('wms inventory adjust / cycle-count idempotent replay', () => {
  beforeAll(async () => {
    await import('../inventory-actions')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
  })

  it('adjust does not skew balance when unique-constraint race returns existing movement', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const { balance, existingMovement } = baseFixtures('10')
    let idempotencyLookups = 0

    mockWarehouseLocationBalance(balance, (where) => {
      if (where && 'idempotencyKey' in where) {
        idempotencyLookups += 1
        // 1: adjust early find — miss
        // 2: persistMovement early find — miss
        // 3+: unique-race recovery find — hit
        if (idempotencyLookups <= 2) return null
        return existingMovement
      }
      return null
    })

    em.create.mockImplementation(() => {
      throw Object.assign(new Error('unique'), {
        code: '23505',
        name: 'UniqueConstraintViolationException',
      })
    })

    const handler = commandRegistry.get('wms.inventory.adjust')
    const result = await handler!.execute(
      {
        organizationId: ORG,
        tenantId: TENANT,
        warehouseId: WAREHOUSE_ID,
        locationId: LOCATION_ID,
        catalogVariantId: VARIANT_ID,
        delta: 3,
        reason: 'correction',
        referenceType: 'manual',
        referenceId: REFERENCE_ID,
        performedBy: USER_ID,
      },
      ctx as never,
    )

    expect(result).toEqual({ movementId: MOVEMENT_ID })
    expect(balance.quantityOnHand).toBe('10')
  })

  it('cycle-count does not skew balance when unique-constraint race returns existing movement', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const { balance, existingMovement } = baseFixtures('10')
    let idempotencyLookups = 0

    mockWarehouseLocationBalance(balance, (where) => {
      if (where && 'idempotencyKey' in where) {
        idempotencyLookups += 1
        if (idempotencyLookups <= 2) return null
        return existingMovement
      }
      // resolveReceivedAtForBalance — no prior movement
      return null
    })

    em.create.mockImplementation(() => {
      throw Object.assign(new Error('unique'), {
        code: '23505',
        name: 'UniqueConstraintViolationException',
      })
    })

    const handler = commandRegistry.get('wms.inventory.cycleCount')
    const result = await handler!.execute(
      {
        organizationId: ORG,
        tenantId: TENANT,
        warehouseId: WAREHOUSE_ID,
        locationId: LOCATION_ID,
        catalogVariantId: VARIANT_ID,
        countedQuantity: 13,
        autoAdjust: true,
        reason: 'cycle count',
        referenceId: REFERENCE_ID,
        performedBy: USER_ID,
      },
      ctx as never,
    )

    expect(result).toEqual({ adjustmentDelta: '3', movementId: MOVEMENT_ID })
    expect(balance.quantityOnHand).toBe('10')
  })
})
