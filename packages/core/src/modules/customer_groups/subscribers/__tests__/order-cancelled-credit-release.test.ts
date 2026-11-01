// Release 5 Phase 3 (D-R5-2, Step 1.8) — `sales.order.cancelled` → release the order's
// unsettled credit reservation. Runs against the same hand-built, in-memory fake
// `EntityManager` as `services/__tests__/customerCreditService.test.ts` (no real database),
// exercising the REAL `createCustomerCreditService`/`releaseCredit` so the idempotency
// proof below is end to end, not a mocked assertion.

import { randomUUID } from 'crypto'
import handle from '../order-cancelled-credit-release'
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
}

function createFakeEm(): { em: FakeEm; tables: Map<Function, Row[]> } {
  const tables = new Map<Function, Row[]>()
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
  }
  return { em, tables }
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

describe('customer_groups order-cancelled-credit-release subscriber', () => {
  it('releases the open amount of the order\'s linked reservation', async () => {
    const { em, tables } = createFakeEm()
    seedReservedOrder(tables)

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG }, buildCtx(em))

    const entries = tables.get(CustomerCreditLedgerEntry) ?? []
    const releaseEntries = entries.filter((row) => row.entryType === 'release')
    expect(releaseEntries).toHaveLength(1)
    expect(releaseEntries[0].amount).toBe('-80.00')
    expect(releaseEntries[0].idempotencyKey).toBe('release:reserve-key-1')
    expect(releaseEntries[0].relatedEntryId).toBe(entries.find((row) => row.entryType === 'reserve')?.id)
  })

  it('records the order number, not the order id, as the release reason', async () => {
    const { em, tables } = createFakeEm()
    seedReservedOrder(tables)

    await handle({ orderId: ORDER_ID, orderNumber: 'ORDER-20261030-00001', tenantId: TENANT, organizationId: ORG }, buildCtx(em))

    const release = (tables.get(CustomerCreditLedgerEntry) ?? []).find((row) => row.entryType === 'release')
    const stored = JSON.stringify(release)
    expect(stored).toContain('sales.order.cancelled:ORDER-20261030-00001')
    expect(stored).not.toContain(`sales.order.cancelled:${ORDER_ID}`)
  })

  it('is idempotent on redelivery — a second cancellation event does not double-release', async () => {
    const { em, tables } = createFakeEm()
    seedReservedOrder(tables)
    const ctx = buildCtx(em)

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG }, ctx)
    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG }, ctx)

    const entries = tables.get(CustomerCreditLedgerEntry) ?? []
    expect(entries.filter((row) => row.entryType === 'release')).toHaveLength(1)
  })

  it('does not release an amount already fully settled', async () => {
    const { em, tables } = createFakeEm()
    const { account, reserveEntry } = seedReservedOrder(tables)
    const settleEntry: Row = {
      id: randomUUID(),
      tenantId: TENANT,
      organizationId: ORG,
      creditAccountId: account.id,
      entryType: 'settle',
      amount: '-80.00',
      sourceType: 'payment',
      sourceId: 'payment-1',
      relatedEntryId: reserveEntry.id,
      idempotencyKey: 'settle-key-1',
      balanceAfter: '0.00',
      createdByActorType: 'system',
    }
    tables.set(CustomerCreditLedgerEntry, [reserveEntry, settleEntry])

    await handle({ orderId: ORDER_ID, tenantId: TENANT, organizationId: ORG }, buildCtx(em))

    const entries = tables.get(CustomerCreditLedgerEntry) ?? []
    expect(entries.filter((row) => row.entryType === 'release')).toHaveLength(0)
  })

  it('is a no-op when the cancelled order has no linked reservation', async () => {
    const { em, tables } = createFakeEm()
    tables.set(CustomerCreditLedgerEntry, [])

    await expect(
      handle({ orderId: 'order-without-reservation', tenantId: TENANT, organizationId: ORG }, buildCtx(em)),
    ).resolves.toBeUndefined()

    expect(tables.get(CustomerCreditLedgerEntry) ?? []).toHaveLength(0)
  })

  it('skips an incomplete payload without throwing', async () => {
    const { em } = createFakeEm()
    await expect(handle({ orderId: ORDER_ID }, buildCtx(em))).resolves.toBeUndefined()
  })
})
