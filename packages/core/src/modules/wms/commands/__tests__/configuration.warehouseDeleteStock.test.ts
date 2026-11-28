/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { InventoryBalance, Warehouse } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('../../events', () => ({
  emitWmsEvent: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (emInstance: { findOne: (...args: unknown[]) => unknown }, entity: unknown, filters: unknown) =>
    emInstance.findOne(entity, filters),
  findWithDecryption: (emInstance: { find: (...args: unknown[]) => unknown }, entity: unknown, filters: unknown) =>
    emInstance.find(entity, filters),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const WAREHOUSE_ID = '33333333-3333-4333-8333-333333333333'

function buildWarehouse() {
  return {
    id: WAREHOUSE_ID,
    organizationId: ORG,
    tenantId: TENANT,
    name: 'Overflow DC',
    code: 'OVERFLOW',
    isActive: true,
    isPrimary: false,
    deletedAt: null as Date | null,
    addressLine1: null,
    city: null,
    postalCode: null,
    country: null,
    timezone: null,
    metadata: null,
    createdAt: new Date('2026-04-15T00:00:00.000Z'),
    updatedAt: new Date('2026-04-15T00:00:00.000Z'),
  }
}

function createStore(stockedBalance: { id: string } | null) {
  const warehouse = buildWarehouse()
  const balanceQueries: Array<Record<string, unknown>> = []
  const em = {
    findOne: jest.fn(async (entity: unknown, filters: Record<string, unknown>) => {
      if (entity === Warehouse) {
        const visible = warehouse.deletedAt === null || !('deletedAt' in filters)
        return filters.id === warehouse.id && visible ? warehouse : null
      }
      if (entity === InventoryBalance) {
        balanceQueries.push(filters)
        return stockedBalance
      }
      throw new Error('unexpected entity')
    }),
    find: jest.fn(async () => []),
    nativeUpdate: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
  }
  return { em, warehouse, balanceQueries }
}

function createCtx(em: ReturnType<typeof createStore>['em']) {
  return {
    auth: { sub: '99999999-9999-4999-8999-999999999999', tenantId: TENANT, orgId: ORG },
    selectedOrganizationId: ORG,
    container: {
      resolve: (name: string) => {
        if (name === 'em') return { fork: () => em }
        if (name === 'dataEngine') {
          return {
            setCustomFields: jest.fn().mockResolvedValue(undefined),
            markOrmEntityChange: jest.fn(),
            flushOrmEntityChanges: jest.fn().mockResolvedValue(undefined),
          }
        }
        if (name === 'rbacService') return { userHasAllFeatures: async () => true }
        throw new Error(`unexpected resolve: ${name}`)
      },
    },
  }
}

type WarehouseHandler = {
  execute: (input: { id: string }, ctx: ReturnType<typeof createCtx>) => Promise<{ warehouseId: string }>
  undo: (params: {
    input: Record<string, never>
    logEntry: { commandPayload: { undo: { after: ReturnType<typeof buildWarehouse> } } }
    ctx: ReturnType<typeof createCtx>
    undoToken: string
  }) => Promise<void>
}

function getHandler(id: 'wms.warehouses.delete' | 'wms.warehouses.create'): WarehouseHandler {
  return commandRegistry.get(id) as unknown as WarehouseHandler
}

describe('wms.warehouses.delete stock guard', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../configuration')
  })

  it('looks up live non-zero balances of the warehouse within its tenant and organization', async () => {
    const store = createStore(null)

    await getHandler('wms.warehouses.delete').execute({ id: WAREHOUSE_ID }, createCtx(store.em))

    expect(store.balanceQueries).toEqual([
      {
        warehouse: WAREHOUSE_ID,
        tenantId: TENANT,
        organizationId: ORG,
        deletedAt: null,
        $or: [
          { quantityOnHand: { $ne: '0' } },
          { quantityReserved: { $ne: '0' } },
          { quantityAllocated: { $ne: '0' } },
        ],
      },
    ])
    expect(store.warehouse.deletedAt).toBeInstanceOf(Date)
    expect(store.em.flush).toHaveBeenCalled()
  })

  it('refuses with 409 and leaves the warehouse live when it still holds stock', async () => {
    const store = createStore({ id: '66666666-6666-4666-8666-666666666666' })

    const failure = await getHandler('wms.warehouses.delete')
      .execute({ id: WAREHOUSE_ID }, createCtx(store.em))
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CrudHttpError)
    expect((failure as CrudHttpError).status).toBe(409)
    expect((failure as CrudHttpError).body).toMatchObject({ code: 'warehouse_has_stock' })
    expect(store.warehouse.deletedAt).toBeNull()
    expect(store.em.flush).not.toHaveBeenCalled()
  })

  it('refuses to undo the creation of a warehouse that has received stock since', async () => {
    const store = createStore({ id: '66666666-6666-4666-8666-666666666666' })

    const failure = await getHandler('wms.warehouses.create')
      .undo({
        input: {},
        logEntry: { commandPayload: { undo: { after: buildWarehouse() } } },
        ctx: createCtx(store.em),
        undoToken: 'undo-create',
      })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CrudHttpError)
    expect((failure as CrudHttpError).status).toBe(409)
    expect(store.warehouse.deletedAt).toBeNull()
    expect(store.em.flush).not.toHaveBeenCalled()
  })

  it('does not check stock when undoing the creation of a warehouse that is already archived', async () => {
    const store = createStore({ id: '66666666-6666-4666-8666-666666666666' })
    store.warehouse.deletedAt = new Date('2026-05-01T00:00:00.000Z')

    await getHandler('wms.warehouses.create').undo({
      input: {},
      logEntry: { commandPayload: { undo: { after: buildWarehouse() } } },
      ctx: createCtx(store.em),
      undoToken: 'undo-create',
    })

    expect(store.balanceQueries).toEqual([])
    expect(store.em.flush).toHaveBeenCalled()
  })
})
