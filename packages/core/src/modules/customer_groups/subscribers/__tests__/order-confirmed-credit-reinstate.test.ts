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
  ...jest.requireActual('../../services/customerCreditService'),
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
  execute: (sql: string, params?: unknown[]) => Promise<unknown>
  getConnection: () => { execute: (sql: string, params?: unknown[]) => Promise<Row[]> }
  transactional: <T>(cb: (tx: FakeEm) => Promise<T>) => Promise<T>
}

// #8268 review Major 3: the subscriber now fences on the order's CURRENT status (a raw
// `select status from sales_orders ...`) before reinstating, so a stale/redelivered
// confirmation does not reinstate credit for an order that was cancelled again (or
// deleted) afterward. Defaults to `'confirmed'` so every pre-existing test below — written
// when the order's live status was never queried — keeps exercising the "order really is
// live" path unchanged; only the new stale-redelivery tests override it.
function createFakeEm(options: { orderStatus?: string | null } = {}): { em: FakeEm; tables: Map<Function, Row[]> } {
  const orderStatus = options.orderStatus === undefined ? 'confirmed' : options.orderStatus
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
    execute: async (sql: string, params?: unknown[]) => (sql.includes('from sales_orders') ? em.getConnection().execute(sql, params) : []),
    getConnection: () => ({
      execute: async () => (orderStatus == null ? [] : [{ status: orderStatus }]),
    }),
    // #8268 review Major 6: `order-confirmed-credit-reinstate.ts` now wraps its logic in
    // `em.transactional` to take the advisory lock — this fake has no real transaction
    // semantics (no competing writers to isolate), so it just invokes the callback.
    transactional: async (cb) => cb(em),
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

  // #9073: no longer gated on `previousStatus` at all — the loop below already scopes to
  // only THIS order's own un-reinstated release, so a released reservation is reinstated
  // whichever status immediately preceded the confirmation.
  it('reinstates a released reservation regardless of the payload previousStatus value', async () => {
    const { em, tables } = createFakeEm()
    const { account, reserveEntry } = seedReleasedReservation(tables)
    reserveCreditMock.mockResolvedValue({ reserved: true, released: false, entry: null, check: { reason: 'ok' } })

    await handle(
      { orderId: ORDER_ID, previousStatus: 'draft', tenantId: TENANT, organizationId: ORG },
      buildCtx(em),
    )

    expect(reserveCreditMock).toHaveBeenCalledWith({
      scope: { tenantId: TENANT, organizationId: ORG },
      buyer: { customerId: account.customerId },
      currencyCode: account.currencyCode,
      amount: reserveEntry.amount,
      sourceType: 'order',
      sourceId: ORDER_ID,
      idempotencyKey: `reinstate:${reserveEntry.idempotencyKey}`,
    })
  })

  // #9073: the QA-reported shape — Canceled → On hold → Confirmed. The final
  // `sales.order.confirmed` event's `previousStatus` is `on_hold`, not `canceled`, and
  // must still reinstate.
  it('reinstates a released reservation when the order was revived through an intermediate status', async () => {
    const { em, tables } = createFakeEm()
    const { reserveEntry } = seedReleasedReservation(tables)
    reserveCreditMock.mockResolvedValue({ reserved: true, released: false, entry: null, check: { reason: 'ok' } })

    await handle(
      { orderId: ORDER_ID, previousStatus: 'on_hold', tenantId: TENANT, organizationId: ORG },
      buildCtx(em),
    )

    expect(reserveCreditMock).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: `reinstate:${reserveEntry.idempotencyKey}` }),
    )
  })

  // #8268 review Major 1: a partial settlement before cancellation leaves
  // `releaseCredit` freeing only the OPEN remainder, not the original reserved amount
  // — reinstating the full original would overstate exposure by the already-settled
  // slice (or wrongly refuse reinstatement against a now-tight limit).
  it('reinstates only the amount the release actually freed, not the original reservation amount', async () => {
    const { em, tables } = createFakeEm()
    const { account, reserveEntry } = seedReleasedReservation(tables, {
      amount: '100.00',
      idempotencyKey: 'reserve-key-partial',
    })
    // Overwrite the auto-generated full release with a PARTIAL one (reserve 100, settle
    // 40 beforehand, cancel releases only the remaining 60).
    const releaseEntries = (tables.get(CustomerCreditLedgerEntry) ?? []).map((row) =>
      row.entryType === 'release' ? { ...row, amount: '-60.00' } : row,
    )
    tables.set(CustomerCreditLedgerEntry, releaseEntries)
    reserveCreditMock.mockResolvedValue({ reserved: true, released: false, entry: null, check: { reason: 'ok' } })

    await handle(
      { orderId: ORDER_ID, previousStatus: 'canceled', tenantId: TENANT, organizationId: ORG },
      buildCtx(em),
    )

    expect(reserveCreditMock).toHaveBeenCalledWith({
      scope: { tenantId: TENANT, organizationId: ORG },
      buyer: { customerId: account.customerId },
      currencyCode: account.currencyCode,
      amount: '60.00',
      sourceType: 'order',
      sourceId: ORDER_ID,
      idempotencyKey: `reinstate:${reserveEntry.idempotencyKey}`,
    })
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

  it('#8268 review Major 3: does not reinstate credit when a delayed confirmation is delivered after the order was cancelled again', async () => {
    // Order A was confirmed, then cancelled again BEFORE this confirmation event's
    // redelivery finally arrives — the order's live status is `canceled` once more, so
    // the reservation `order-cancelled-credit-release.ts` already released must not be
    // reinstated by this stale event.
    const { em, tables } = createFakeEm({ orderStatus: 'canceled' })
    seedReleasedReservation(tables)

    await handle(
      { orderId: ORDER_ID, previousStatus: 'canceled', tenantId: TENANT, organizationId: ORG },
      buildCtx(em),
    )

    expect(reserveCreditMock).not.toHaveBeenCalled()
    expect(linkCreditReservationToOrderMock).not.toHaveBeenCalled()
  })

  it('#8268 review Major 3: does not reinstate credit for a delayed confirmation once the order no longer exists', async () => {
    const { em, tables } = createFakeEm({ orderStatus: null })
    seedReleasedReservation(tables)

    await handle(
      { orderId: ORDER_ID, previousStatus: 'canceled', tenantId: TENANT, organizationId: ORG },
      buildCtx(em),
    )

    expect(reserveCreditMock).not.toHaveBeenCalled()
    expect(linkCreditReservationToOrderMock).not.toHaveBeenCalled()
  })

  it('#8268 review Major 3 (re-review): treats the \'cancelled\' spelling the same as \'canceled\' when checking for a stale/live order', async () => {
    const { em, tables } = createFakeEm({ orderStatus: 'cancelled' })
    seedReleasedReservation(tables)

    await handle(
      { orderId: ORDER_ID, previousStatus: 'canceled', tenantId: TENANT, organizationId: ORG },
      buildCtx(em),
    )

    expect(reserveCreditMock).not.toHaveBeenCalled()
    expect(linkCreditReservationToOrderMock).not.toHaveBeenCalled()
  })
})
