// #8404 regression coverage. The subscriber orchestrates `CustomerCreditLedgerEntry` lookups
// against a fake `EntityManager` (same pattern as the sibling
// `order-cancelled-credit-release.test.ts`) and delegates the actual reserve/link calls to
// `createCustomerCreditService` — mocked here so this file proves the subscriber's OWN
// decision logic (which reservations qualify, the fresh idempotency key, the skip rules)
// without re-exercising `reserveCredit`'s own group/terms resolution (covered by
// `services/__tests__/customerCreditService.test.ts`).

import { randomUUID } from 'crypto'
import { CustomerCreditAccount, CustomerCreditLedgerEntry } from '../../data/entities'

const reserveCreditMock = jest.fn()
const linkCreditReservationToOrderMock = jest.fn()
jest.mock('../../services/customerCreditService', () => ({
  createCustomerCreditService: () => ({
    reserveCredit: reserveCreditMock,
    linkCreditReservationToOrder: linkCreditReservationToOrderMock,
  }),
}))

const reportErrorMock = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: reportErrorMock }),
}))

import handle from '../order-confirmed-credit-reinstate'

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
  findOne: (entity: Function, where: Row) => Promise<Row | null>
  find: (entity: Function, where: Row) => Promise<Row[]>
  fork: () => FakeEm
}

function createFakeEm(): { em: FakeEm; tables: Map<Function, Row[]> } {
  const tables = new Map<Function, Row[]>()
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
    fork: () => em,
  }
  return { em, tables }
}

function asEm(fake: FakeEm): import('@mikro-orm/postgresql').EntityManager {
  return fake as unknown as import('@mikro-orm/postgresql').EntityManager
}

function buildCtx(em: FakeEm) {
  return { resolve: <T = unknown>(name: string) => (name === 'em' ? (asEm(em) as unknown as T) : (undefined as T)) }
}

function seedReleasedReservation(tables: Map<Function, Row[]>, overrides: Partial<Row> = {}) {
  const account: Row = {
    id: randomUUID(),
    tenantId: TENANT,
    organizationId: ORG,
    customerId: CUSTOMER_ID,
    currencyCode: 'USD',
  }
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
    ...overrides,
  }
  const releaseEntry: Row = {
    id: randomUUID(),
    tenantId: TENANT,
    organizationId: ORG,
    creditAccountId: account.id,
    entryType: 'release',
    amount: '-80.00',
    relatedEntryId: reserveEntry.id,
    idempotencyKey: `release:${reserveEntry.idempotencyKey}`,
  }
  tables.set(CustomerCreditAccount, [account])
  tables.set(CustomerCreditLedgerEntry, [reserveEntry, releaseEntry])
  return { account, reserveEntry, releaseEntry }
}

describe('customer_groups order-confirmed-credit-reinstate subscriber', () => {
  beforeEach(() => {
    reserveCreditMock.mockReset()
    linkCreditReservationToOrderMock.mockReset()
    reportErrorMock.mockReset()
  })

  it('reinstates a released reservation under a fresh key when the order leaves cancelled', async () => {
    const { em, tables } = createFakeEm()
    const { account, reserveEntry } = seedReleasedReservation(tables)
    reserveCreditMock.mockResolvedValue({ reserved: true, released: false, entry: null, check: { reason: 'ok' } })

    await handle(
      { orderId: ORDER_ID, previousStatus: 'canceled', tenantId: TENANT, organizationId: ORG },
      buildCtx(em),
    )

    expect(reserveCreditMock).toHaveBeenCalledTimes(1)
    expect(reserveCreditMock).toHaveBeenCalledWith({
      scope: { tenantId: TENANT, organizationId: ORG },
      buyer: { customerId: account.customerId },
      currencyCode: account.currencyCode,
      amount: reserveEntry.amount,
      sourceType: 'order',
      sourceId: ORDER_ID,
      idempotencyKey: `reinstate:${reserveEntry.idempotencyKey}`,
    })
    expect(linkCreditReservationToOrderMock).toHaveBeenCalledWith({
      scope: { tenantId: TENANT, organizationId: ORG },
      idempotencyKey: `reinstate:${reserveEntry.idempotencyKey}`,
      orderId: ORDER_ID,
    })
  })

  it('does nothing when the order did not come from a cancelled status', async () => {
    const { em, tables } = createFakeEm()
    seedReleasedReservation(tables)

    await handle(
      { orderId: ORDER_ID, previousStatus: 'draft', tenantId: TENANT, organizationId: ORG },
      buildCtx(em),
    )

    expect(reserveCreditMock).not.toHaveBeenCalled()
  })

  it('skips a reservation that is still active (never released)', async () => {
    const { em, tables } = createFakeEm()
    const account: Row = { id: randomUUID(), tenantId: TENANT, organizationId: ORG, customerId: CUSTOMER_ID, currencyCode: 'USD' }
    const reserveEntry: Row = {
      id: randomUUID(),
      tenantId: TENANT,
      organizationId: ORG,
      creditAccountId: account.id,
      entryType: 'reserve',
      amount: '80.00',
      linkedOrderId: ORDER_ID,
      idempotencyKey: 'reserve-key-1',
    }
    tables.set(CustomerCreditAccount, [account])
    tables.set(CustomerCreditLedgerEntry, [reserveEntry])

    await handle(
      { orderId: ORDER_ID, previousStatus: 'cancelled', tenantId: TENANT, organizationId: ORG },
      buildCtx(em),
    )

    expect(reserveCreditMock).not.toHaveBeenCalled()
  })

  it('is idempotent on redelivery — a reservation already reinstated is not reinstated twice', async () => {
    const { em, tables } = createFakeEm()
    const { reserveEntry, account } = seedReleasedReservation(tables)
    const reinstatedEntry: Row = {
      id: randomUUID(),
      tenantId: TENANT,
      organizationId: ORG,
      creditAccountId: account.id,
      entryType: 'reserve',
      amount: reserveEntry.amount,
      linkedOrderId: ORDER_ID,
      idempotencyKey: `reinstate:${reserveEntry.idempotencyKey}`,
    }
    tables.set(CustomerCreditLedgerEntry, [...(tables.get(CustomerCreditLedgerEntry) ?? []), reinstatedEntry])

    await handle(
      { orderId: ORDER_ID, previousStatus: 'canceled', tenantId: TENANT, organizationId: ORG },
      buildCtx(em),
    )

    expect(reserveCreditMock).not.toHaveBeenCalled()
  })

  it('is a no-op when the order has no linked reservation at all', async () => {
    const { em } = createFakeEm()

    await expect(
      handle({ orderId: ORDER_ID, previousStatus: 'canceled', tenantId: TENANT, organizationId: ORG }, buildCtx(em)),
    ).resolves.toBeUndefined()

    expect(reserveCreditMock).not.toHaveBeenCalled()
  })

  // #8268 review Major 4(a): a prior pass can have committed `reserveCredit` and then died
  // (or thrown) before `linkCreditReservationToOrder` ran. The reinstate entry exists
  // (idempotency key matched) but was never linked — a bare skip-on-replay would leave it
  // unlinked forever, so the next cancel could never find it to release again.
  it('links an already-reinstated-but-unlinked entry on replay, instead of skipping it forever', async () => {
    const { em, tables } = createFakeEm()
    const { reserveEntry, account } = seedReleasedReservation(tables)
    const reinstatedButUnlinkedEntry: Row = {
      id: randomUUID(),
      tenantId: TENANT,
      organizationId: ORG,
      creditAccountId: account.id,
      entryType: 'reserve',
      amount: reserveEntry.amount,
      linkedOrderId: null,
      idempotencyKey: `reinstate:${reserveEntry.idempotencyKey}`,
    }
    tables.set(CustomerCreditLedgerEntry, [...(tables.get(CustomerCreditLedgerEntry) ?? []), reinstatedButUnlinkedEntry])

    await handle(
      { orderId: ORDER_ID, previousStatus: 'canceled', tenantId: TENANT, organizationId: ORG },
      buildCtx(em),
    )

    expect(reserveCreditMock).not.toHaveBeenCalled()
    expect(linkCreditReservationToOrderMock).toHaveBeenCalledWith({
      scope: { tenantId: TENANT, organizationId: ORG },
      idempotencyKey: `reinstate:${reserveEntry.idempotencyKey}`,
      orderId: ORDER_ID,
    })
  })

  // #8268 review Major 4(b): the undo already committed before this subscriber runs, so a
  // business refusal (limit exceeded, account on hold) leaves the order live with no
  // credit hold. It must be observable beyond a log line.
  it('reports a business refusal to telemetry instead of only logging it', async () => {
    const { em, tables } = createFakeEm()
    seedReleasedReservation(tables)
    reserveCreditMock.mockResolvedValue({
      reserved: false,
      released: false,
      entry: null,
      check: { reason: 'limit_exceeded' },
    })

    await handle(
      { orderId: ORDER_ID, previousStatus: 'canceled', tenantId: TENANT, organizationId: ORG },
      buildCtx(em),
    )

    expect(linkCreditReservationToOrderMock).not.toHaveBeenCalled()
    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        module: 'customer_groups',
        code: 'customer_groups.order_confirmed_credit_reinstate_refused',
        attributes: expect.objectContaining({ orderId: ORDER_ID, reason: 'limit_exceeded' }),
      }),
    )
  })
})
