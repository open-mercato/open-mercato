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

type WarehouseRecord = {
  id: string
  organizationId: string
  tenantId: string
  name: string
  code: string
  isActive: boolean
  isPrimary: boolean
  deletedAt: Date | null
  addressLine1: string | null
  city: string | null
  postalCode: string | null
  country: string | null
  timezone: string | null
  metadata: unknown
  createdAt: Date
  updatedAt: Date
}

type BalanceRecord = {
  id: string
  warehouse: string
  organizationId: string
  tenantId: string
  quantityOnHand: string
  quantityReserved: string
  quantityAllocated: string
  deletedAt: Date | null
}

type QuantityKey = 'quantityOnHand' | 'quantityReserved' | 'quantityAllocated'
type BalanceFilters = {
  warehouse?: string
  organizationId?: string
  tenantId?: string
  deletedAt?: null
  $or?: Array<Partial<Record<QuantityKey, { $ne: string }>>>
}

function buildWarehouse(): WarehouseRecord {
  return {
    id: WAREHOUSE_ID,
    organizationId: ORG,
    tenantId: TENANT,
    name: 'Overflow DC',
    code: 'OVERFLOW',
    isActive: true,
    isPrimary: false,
    deletedAt: null,
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

function buildBalance(overrides: Partial<BalanceRecord>): BalanceRecord {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    warehouse: WAREHOUSE_ID,
    organizationId: ORG,
    tenantId: TENANT,
    quantityOnHand: '0.0000',
    quantityReserved: '0.0000',
    quantityAllocated: '0.0000',
    deletedAt: null,
    ...overrides,
  }
}

function matchesBalance(record: BalanceRecord, filters: BalanceFilters): boolean {
  if (filters.warehouse !== undefined && record.warehouse !== filters.warehouse) return false
  if (filters.organizationId !== undefined && record.organizationId !== filters.organizationId) return false
  if (filters.tenantId !== undefined && record.tenantId !== filters.tenantId) return false
  if (filters.deletedAt === null && record.deletedAt !== null) return false
  if (filters.$or) {
    return filters.$or.some((clause) =>
      (Object.entries(clause) as Array<[QuantityKey, { $ne: string }]>).every(
        ([key, condition]) => Number(record[key]) !== Number(condition.$ne),
      ),
    )
  }
  return true
}

function createStore(balances: BalanceRecord[]) {
  const warehouse = buildWarehouse()
  const balanceQueries: BalanceFilters[] = []

  const em = {
    findOne: jest.fn(async (entity: unknown, filters: Record<string, unknown>) => {
      if (entity === Warehouse) {
        if (filters.id !== warehouse.id) return null
        if (filters.deletedAt === null && warehouse.deletedAt !== null) return null
        return warehouse
      }
      if (entity === InventoryBalance) {
        const balanceFilters = filters as BalanceFilters
        balanceQueries.push(balanceFilters)
        return balances.find((record) => matchesBalance(record, balanceFilters)) ?? null
      }
      throw new Error('unexpected entity')
    }),
    find: jest.fn(async () => []),
    nativeUpdate: jest.fn(async () => undefined),
    create: jest.fn(),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
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

type DeleteHandler = {
  execute: (input: { id: string }, ctx: ReturnType<typeof createCtx>) => Promise<{ warehouseId: string }>
}

type CreateUndoHandler = {
  undo: (params: {
    input: Record<string, never>
    logEntry: { commandPayload: { undo: { after: WarehouseRecord } } }
    ctx: ReturnType<typeof createCtx>
    undoToken: string
  }) => Promise<void>
}

function getDeleteHandler(): DeleteHandler {
  return commandRegistry.get('wms.warehouses.delete') as unknown as DeleteHandler
}

function getCreateUndoHandler(): CreateUndoHandler {
  return commandRegistry.get('wms.warehouses.create') as unknown as CreateUndoHandler
}

describe('wms.warehouses.delete stock guard', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../configuration')
  })

  it.each([
    ['on-hand', { quantityOnHand: '5.0000' }],
    ['reserved', { quantityReserved: '2.0000' }],
    ['allocated', { quantityAllocated: '1.0000' }],
  ])('refuses to archive a warehouse that still has %s stock', async (_label, quantities) => {
    const store = createStore([buildBalance(quantities)])

    const failure = await getDeleteHandler().execute({ id: WAREHOUSE_ID }, createCtx(store.em)).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CrudHttpError)
    expect((failure as CrudHttpError).status).toBe(409)
    expect(store.warehouse.deletedAt).toBeNull()
    expect(store.em.flush).not.toHaveBeenCalled()
  })

  it('scopes the stock lookup to the warehouse tenant, organization and live balances', async () => {
    const store = createStore([buildBalance({ quantityOnHand: '5.0000', tenantId: '55555555-5555-4555-8555-555555555555' })])

    await getDeleteHandler().execute({ id: WAREHOUSE_ID }, createCtx(store.em))

    expect(store.balanceQueries).toHaveLength(1)
    expect(store.balanceQueries[0]).toMatchObject({
      warehouse: WAREHOUSE_ID,
      tenantId: TENANT,
      organizationId: ORG,
      deletedAt: null,
    })
    expect(store.warehouse.deletedAt).toBeInstanceOf(Date)
  })

  it('archives a warehouse whose balances are all zero or soft-deleted', async () => {
    const store = createStore([
      buildBalance({}),
      buildBalance({ id: '77777777-7777-4777-8777-777777777777', quantityOnHand: '3.0000', deletedAt: new Date() }),
    ])

    const result = await getDeleteHandler().execute({ id: WAREHOUSE_ID }, createCtx(store.em))

    expect(result).toEqual({ warehouseId: WAREHOUSE_ID })
    expect(store.warehouse.deletedAt).toBeInstanceOf(Date)
    expect(store.em.flush).toHaveBeenCalled()
  })

  it('refuses to undo the creation of a warehouse that has received stock since', async () => {
    const store = createStore([buildBalance({ quantityOnHand: '4.0000' })])

    const failure = await getCreateUndoHandler()
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
})
