// #8406: deleting an on-account order left its credit reserved forever — nothing
// subscribed to `sales.order.deleted` to release it. This subscriber reuses
// `order-cancelled-credit-release.ts`'s exact release logic; this file proves it fires
// correctly off the `sales.order.deleted` event and is idempotent, same shape as the
// sibling's own test for `sales.order.cancelled`.

import { randomUUID } from 'crypto'
import handle, { metadata } from '../order-deleted-credit-release'
import { CustomerCreditAccount, CustomerCreditLedgerEntry } from '../../data/entities'

const TENANT = 'tenant-1'
const ORG = 'org-1'
const ORDER_ID = 'order-1'
const CUSTOMER_ID = 'customer-1'

type Row = Record<string, unknown>

function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key]
    if (condition === null) return value === null || value === undefined
    if (condition && typeof condition === 'object' && '$in' in (condition as Row)) {
      return ((condition as Row).$in as unknown[]).includes(value)
    }
    return value === condition
  })
}

type FakeEm = {
  findOne: (entity: Function, where: Row, options?: unknown) => Promise<Row | null>
  find: (entity: Function, where: Row) => Promise<Row[]>
  create: (entity: Function, data: Row) => Row
  persist: (row: Row) => void
  flush: () => Promise<void>
  begin: () => Promise<void>
  commit: () => Promise<void>
  rollback: () => Promise<void>
  isInTransaction: () => boolean
  fork: () => FakeEm
  getConnection: () => { execute: (sql: string, params?: unknown[]) => Promise<Row[]> }
  execute: (sql: string, params?: unknown[]) => Promise<unknown>
  transactional: <T>(cb: (tx: FakeEm) => Promise<T>) => Promise<T>
}

// Sentinel table standing in for `sales_orders` — the deleted-event guard runs a raw SQL
// existence check against it (never imports the `sales` entity, matching this module's
// no-upstream-dependency convention). Empty by default (order genuinely deleted); tests
// that need to simulate "the order was restored by undo" push a row into it.
function createFakeEm(): { em: FakeEm; tables: Map<Function, Row[]>; salesOrders: Row[] } {
  const tables = new Map<Function, Row[]>()
  const salesOrders: Row[] = []
  let inTransaction = false
  let pendingCreates: Array<{ entity: Function; row: Row }> = []

  function tableFor(entity: Function): Row[] {
    let rows = tables.get(entity)
    if (!rows) {
      rows = []
      tables.set(entity, rows)
    }
    return rows
  }

  const em: FakeEm = {
    findOne: async (entity, where) => tableFor(entity).find((row) => matchesWhere(row, where)) ?? null,
    find: async (entity, where) => tableFor(entity).filter((row) => matchesWhere(row, where)),
    create: (entity, data) => {
      const row: Row = { id: randomUUID(), ...data }
      pendingCreates.push({ entity, row })
      return row
    },
    persist: () => {},
    flush: async () => {
      const toApply = pendingCreates
      pendingCreates = []
      for (const { entity, row } of toApply) tableFor(entity).push(row)
    },
    begin: async () => {
      inTransaction = true
    },
    commit: async () => {
      inTransaction = false
    },
    rollback: async () => {
      inTransaction = false
    },
    isInTransaction: () => inTransaction,
    fork: () => em,
    getConnection: () => ({
      execute: async (sql: string) => {
        if (sql.includes('from sales_orders')) return salesOrders
        return []
      },
    }),
    execute: async () => [],
    transactional: async (cb) => {
      await em.begin()
      try {
        const result = await cb(em)
        await em.commit()
        return result
      } catch (err) {
        await em.rollback()
        throw err
      }
    },
  }
  return { em, tables, salesOrders }
}

function asEm(fake: FakeEm): import('@mikro-orm/postgresql').EntityManager {
  return fake as unknown as import('@mikro-orm/postgresql').EntityManager
}

function seedReservedOrder(tables: Map<Function, Row[]>, overrides: Partial<Row> = {}) {
  const account: Row = {
    id: randomUUID(),
    tenantId: TENANT,
    organizationId: ORG,
    customerId: CUSTOMER_ID,
    currencyCode: 'USD',
    creditLimit: '500.00',
    isOnHold: false,
    deletedAt: null,
  }
  tables.set(CustomerCreditAccount, [account])

  const reserveEntry: Row = {
    id: randomUUID(),
    tenantId: TENANT,
    organizationId: ORG,
    creditAccountId: account.id,
    entryType: 'reserve',
    amount: '80.00',
    sourceType: 'checkout',
    sourceId: 'session-1',
    linkedOrderId: ORDER_ID,
    idempotencyKey: 'reserve-key-1',
    balanceAfter: '80.00',
    createdByActorType: 'system',
    ...overrides,
  }
  tables.set(CustomerCreditLedgerEntry, [reserveEntry])
  return { account, reserveEntry }
}

function buildCtx(em: FakeEm) {
  return { resolve: <T = unknown>(name: string) => (name === 'em' ? (asEm(em) as unknown as T) : (undefined as T)) }
}

describe('customer_groups order-deleted-credit-release subscriber', () => {
  it('declares itself on sales.order.deleted', () => {
    expect(metadata.event).toBe('sales.order.deleted')
  })

  it('releases the open amount of the deleted order\'s linked reservation', async () => {
    const { em, tables } = createFakeEm()
    seedReservedOrder(tables)

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG }, buildCtx(em))

    const entries = tables.get(CustomerCreditLedgerEntry) ?? []
    const releaseEntries = entries.filter((row) => row.entryType === 'release')
    expect(releaseEntries).toHaveLength(1)
    expect(releaseEntries[0].amount).toBe('-80.00')
    expect(releaseEntries[0].idempotencyKey).toBe('release:reserve-key-1')
  })

  it('records the deletion event, not the cancellation event, as the release reason', async () => {
    const { em, tables } = createFakeEm()
    seedReservedOrder(tables)

    await handle({ orderId: ORDER_ID, orderNumber: 'ORDER-20261030-00001', tenantId: TENANT, organizationId: ORG }, buildCtx(em))

    const release = (tables.get(CustomerCreditLedgerEntry) ?? []).find((row) => row.entryType === 'release')
    expect(JSON.stringify(release)).toContain('sales.order.deleted:ORDER-20261030-00001')
  })

  it('is idempotent on redelivery — a second deletion event does not double-release', async () => {
    const { em, tables } = createFakeEm()
    seedReservedOrder(tables)
    const ctx = buildCtx(em)

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG }, ctx)
    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG }, ctx)

    const entries = tables.get(CustomerCreditLedgerEntry) ?? []
    expect(entries.filter((row) => row.entryType === 'release')).toHaveLength(1)
  })

  it('is a no-op when the deleted order had no linked reservation', async () => {
    const { em } = createFakeEm()

    await expect(
      handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG }, buildCtx(em)),
    ).resolves.toBeUndefined()
  })

  it('#8268 review Major 2: skips a stale redelivery once the order has been restored by undo', async () => {
    const { em, tables, salesOrders } = createFakeEm()
    seedReservedOrder(tables)
    // Simulate undo-of-delete: the order row exists again (re-created by
    // `restoreOrderGraph`) by the time this persistent event is redelivered.
    salesOrders.push({ id: ORDER_ID, tenantId: TENANT, organizationId: ORG })

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG }, buildCtx(em))

    const entries = tables.get(CustomerCreditLedgerEntry) ?? []
    expect(entries.filter((row) => row.entryType === 'release')).toHaveLength(0)
  })
})
