export {}

// Subscriber unit test — mocks the module config check and builds a minimal
// in-memory `em`/`commandBus` so the handler's branching (enabled/disabled,
// sales-absent, idempotency) is exercised without a real database or the
// sales module being present. Mirrors the mocking style in
// `commands/__tests__/orders.test.ts`.

const isMtoAutoDraftEnabledMock = jest.fn()
jest.mock('../../lib/mtoAutoDraftConfig.js', () => ({
  isMtoAutoDraftEnabled: (...args: unknown[]) => isMtoAutoDraftEnabledMock(...args),
}))

import handle, { metadata } from '../sales-order-created-mto.js'
import { ProductPlanningParams, ProductionOrder } from '../../data/entities.js'

type EntityCtor = { name: string }

function makeMockEm() {
  const store = new Map<string, Array<Record<string, unknown>>>()

  function matches(row: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([key, value]) => {
      if (value && typeof value === 'object' && '$in' in (value as Record<string, unknown>)) {
        const list = (value as { $in: unknown[] }).$in
        return list.includes(row[key])
      }
      if (value === null) return row[key] === null || row[key] === undefined
      return row[key] === value
    })
  }

  function seed(EntityClass: EntityCtor, rows: Array<Record<string, unknown>>) {
    store.set(EntityClass.name, rows)
  }

  const em = {
    fork: jest.fn(() => em),
    find: jest.fn(async (EntityClass: EntityCtor, filter: Record<string, unknown> = {}) => {
      const rows = store.get(EntityClass.name) ?? []
      return rows.filter((row) => matches(row, filter))
    }),
  }

  return { em, seed }
}

function makeFakeSalesOrderLine(): EntityCtor {
  return Object.defineProperty(class {}, 'name', { value: 'SalesOrderLine' })
}
const FakeSalesOrderLine = makeFakeSalesOrderLine()

function makeResolver(overrides: {
  em: ReturnType<typeof makeMockEm>['em']
  commandBus: { execute: jest.Mock }
  salesOrderLine?: EntityCtor | undefined
}) {
  const { em, commandBus, salesOrderLine } = overrides
  return {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      if (name === 'commandBus') return commandBus
      if (name === 'SalesOrderLine') {
        if (!salesOrderLine) throw new Error('SalesOrderLine not registered')
        return salesOrderLine
      }
      throw new Error(`unexpected resolve: ${name}`)
    }),
  }
}

const basePayload = { id: 'order-1', tenantId: 'tenant-1', organizationId: 'org-1' }

describe('production:sales-order-mto-draft subscriber', () => {
  beforeEach(() => {
    isMtoAutoDraftEnabledMock.mockReset()
  })

  it('declares itself against sales.order.created as a persistent subscriber', () => {
    expect(metadata).toEqual({
      event: 'sales.order.created',
      persistent: true,
      id: 'production:sales-order-mto-draft',
    })
  })

  it('no-ops when the tenant has not opted in', async () => {
    isMtoAutoDraftEnabledMock.mockResolvedValue(false)
    const commandBus = { execute: jest.fn() }
    const { em } = makeMockEm()
    const ctx = makeResolver({ em, commandBus, salesOrderLine: FakeSalesOrderLine })

    await handle(basePayload, ctx)

    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('no-ops when sales is absent (no SalesOrderLine DI registration)', async () => {
    isMtoAutoDraftEnabledMock.mockResolvedValue(true)
    const commandBus = { execute: jest.fn() }
    const { em } = makeMockEm()
    const ctx = makeResolver({ em, commandBus, salesOrderLine: undefined })

    await expect(handle(basePayload, ctx)).resolves.toBeUndefined()
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('drafts a production order for every make-flagged line, skipping buy lines', async () => {
    isMtoAutoDraftEnabledMock.mockResolvedValue(true)
    const commandBus = { execute: jest.fn().mockResolvedValue({ result: { id: 'po-1' }, logEntry: null }) }
    const { em, seed } = makeMockEm()
    seed(FakeSalesOrderLine, [
      { id: 'line-make', order: 'order-1', productId: 'product-make', productVariantId: null, quantity: '5', quantityUnit: 'pcs', deletedAt: null },
      { id: 'line-buy', order: 'order-1', productId: 'product-buy', productVariantId: null, quantity: '3', quantityUnit: 'pcs', deletedAt: null },
    ])
    seed(ProductPlanningParams, [
      { id: 'pp-1', tenantId: 'tenant-1', organizationId: 'org-1', productId: 'product-make', procurement: 'make', deletedAt: null },
      { id: 'pp-2', tenantId: 'tenant-1', organizationId: 'org-1', productId: 'product-buy', procurement: 'buy', deletedAt: null },
    ])
    seed(ProductionOrder, [])
    const ctx = makeResolver({ em, commandBus, salesOrderLine: FakeSalesOrderLine })

    await handle(basePayload, ctx)

    expect(commandBus.execute).toHaveBeenCalledTimes(1)
    const [commandId, options] = commandBus.execute.mock.calls[0]
    expect(commandId).toBe('production.orders.create')
    expect(options.input).toMatchObject({
      productId: 'product-make',
      qtyPlanned: 5,
      uom: 'pcs',
      sourceType: 'sales_order',
      sourceId: 'order-1',
    })
    expect(options.ctx.systemActor).toBe(true)
  })

  it('is idempotent: skips a product that already has a draft order for this source', async () => {
    isMtoAutoDraftEnabledMock.mockResolvedValue(true)
    const commandBus = { execute: jest.fn() }
    const { em, seed } = makeMockEm()
    seed(FakeSalesOrderLine, [
      { id: 'line-make', order: 'order-1', productId: 'product-make', productVariantId: null, quantity: '5', quantityUnit: 'pcs', deletedAt: null },
    ])
    seed(ProductPlanningParams, [
      { id: 'pp-1', tenantId: 'tenant-1', organizationId: 'org-1', productId: 'product-make', procurement: 'make', deletedAt: null },
    ])
    seed(ProductionOrder, [
      {
        id: 'po-existing',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        sourceType: 'sales_order',
        sourceId: 'order-1',
        status: 'draft',
        productId: 'product-make',
        deletedAt: null,
      },
    ])
    const ctx = makeResolver({ em, commandBus, salesOrderLine: FakeSalesOrderLine })

    await handle(basePayload, ctx)

    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('no-ops when the order has no lines', async () => {
    isMtoAutoDraftEnabledMock.mockResolvedValue(true)
    const commandBus = { execute: jest.fn() }
    const { em, seed } = makeMockEm()
    seed(FakeSalesOrderLine, [])
    const ctx = makeResolver({ em, commandBus, salesOrderLine: FakeSalesOrderLine })

    await handle(basePayload, ctx)

    expect(commandBus.execute).not.toHaveBeenCalled()
  })
})
