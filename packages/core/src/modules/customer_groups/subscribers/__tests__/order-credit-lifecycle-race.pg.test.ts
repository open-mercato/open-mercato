/**
 * #8268 review Major 6: `order-cancelled-credit-release.ts` and
 * `order-confirmed-credit-reinstate.ts` now serialize their entire check-then-act
 * sequence behind `pg_advisory_xact_lock(hashtextextended('customer_groups_credit_
 * lifecycle:<orderId>', 0))` so a delayed/redelivered release can never observe (and
 * re-release) a reservation the reinstate subscriber created while it was paused, or vice
 * versa. A mocked EntityManager cannot demonstrate that two real Postgres connections
 * actually block each other on this key — that needs a live database.
 *
 * Two things are proven here, both against a real PostgreSQL:
 *
 * 1. The production `handleOrderCreditRelease` handler genuinely contends on this lock
 *    key, not just in source — a concurrent transaction that takes the SAME key first
 *    (simulating `order-confirmed-credit-reinstate.ts` mid-reinstate) measurably delays
 *    the handler's own completion until that transaction commits, and the handler's
 *    reservations read then reflects every row the delayed transaction committed, never a
 *    stale pre-commit snapshot.
 * 2. The exact lock primitive the credit (and promotions) lifecycle subscribers share
 *    really serializes two independent connections on the same key: the second
 *    acquisition cannot complete before the first transaction holding it commits.
 *
 * (`releaseCredit`'s own `CustomerCreditAccount` row lock already prevents a SIMPLE
 * double-release from two concurrent redeliveries of the exact same call on its own —
 * that pre-existing protection is not what this file is proving.)
 *
 * Gated on OM_CUSTOMER_GROUPS_PG_URL — a throwaway database, since the suite creates and
 * drops its own schema. Never point it at a development or shared database. Run it with:
 *
 *   docker run -d --rm --name om-customer-groups-pg -e POSTGRES_PASSWORD=postgres \
 *     -e POSTGRES_DB=om -p 54374:5432 postgres:18-alpine
 *   OM_CUSTOMER_GROUPS_PG_URL=postgres://postgres:postgres@127.0.0.1:54374/om \
 *     yarn workspace @open-mercato/core jest order-credit-lifecycle-race.pg
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { CustomerCreditAccount, CustomerCreditLedgerEntry } from '../../data/entities'
import { handleOrderCreditRelease } from '../order-cancelled-credit-release'

// #8268 review Major 3 (re-review): `handleOrderCreditRelease`'s stale-event fence reads
// the order's CURRENT status with a raw `select status from sales_orders ...` — this
// suite deliberately wires only the two `customer_groups` entities it actually tests
// against (see the header comment), so a minimal stand-in for `sales_orders`'s shape is
// seeded here rather than pulling in the real `sales` module's entity graph (customer_
// groups must never import sales — see AGENTS.md "NO direct ORM relationships between
// modules"). Column names match the real table exactly; nothing else about it is real.
@Entity({ tableName: 'sales_orders' })
class SalesOrderStub {
  @PrimaryKey({ type: 'uuid' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  status!: string
}

const PG_URL = process.env.OM_CUSTOMER_GROUPS_PG_URL ?? ''
const maybe = PG_URL ? describe : describe.skip

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CURRENCY = 'USD'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

maybe('customer_groups credit lifecycle lock under real concurrency (#8268 review Major 6)', () => {
  jest.setTimeout(60_000)
  let orm: MikroORM

  beforeAll(async () => {
    orm = await MikroORM.init({
      clientUrl: PG_URL,
      entities: [CustomerCreditAccount, CustomerCreditLedgerEntry, SalesOrderStub],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
      pool: { min: 0, max: 10 },
    })
    await orm.schema.refresh()
  }, 60_000)

  afterAll(async () => {
    await orm?.close(true)
  })

  function ctxFor(em: EntityManager) {
    return { resolve: (name: string) => (name === 'em' ? em : undefined) }
  }

  async function seedReleasedReservation(): Promise<{ orderId: string; accountId: string; reserveKey: string }> {
    const em = orm.em.fork()
    const orderId = randomUUID()
    // #8268 review Major 3 (re-review): `handleOrderCreditRelease` now fences the release
    // on the order's CURRENT status — seed it as genuinely `canceled`, matching the
    // scenario this suite exercises (a real `sales.order.cancelled` release).
    const order = em.create(SalesOrderStub, {
      id: orderId,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      status: 'canceled',
    })
    em.persist(order)
    await em.flush()
    const account = em.create(CustomerCreditAccount, {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      customerId: randomUUID(),
      currencyCode: CURRENCY,
      creditLimit: '1000.00',
      isOnHold: false,
    })
    em.persist(account)
    await em.flush()

    const reserveKey = `race-reserve-${orderId}`
    const reserve = em.create(CustomerCreditLedgerEntry, {
      id: randomUUID(),
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      creditAccountId: account.id,
      entryType: 'reserve',
      amount: '100.00',
      sourceType: 'order',
      sourceId: orderId,
      linkedOrderId: orderId,
      idempotencyKey: reserveKey,
      balanceAfter: '100.00',
      createdByActorType: 'system',
    })
    em.persist(reserve)
    await em.flush()
    return { orderId, accountId: account.id, reserveKey }
  }

  test('the release handler blocks on a competing reinstate holding the same lock, and sees everything it committed', async () => {
    const { orderId, accountId } = await seedReleasedReservation()

    // Simulates `order-confirmed-credit-reinstate.ts` mid-flight: holds the SAME lock key
    // this order's release handler will contend on, creates a SECOND reservation linked
    // to the order (as a real reinstate would), then commits only after `holdMs`.
    const lockKey = `customer_groups_credit_lifecycle:${orderId}`
    const holdMs = 300
    const reinstateKey = `reinstate-sim-${orderId}`
    const emHolder = orm.em.fork()
    const holder = emHolder.transactional(async (tx) => {
      await tx.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [lockKey])
      await sleep(holdMs)
      const reinstated = tx.create(CustomerCreditLedgerEntry, {
        id: randomUUID(),
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        creditAccountId: accountId,
        entryType: 'reserve',
        amount: '100.00',
        sourceType: 'order',
        sourceId: orderId,
        linkedOrderId: orderId,
        idempotencyKey: reinstateKey,
        balanceAfter: '100.00',
        createdByActorType: 'system',
      })
      tx.persist(reinstated)
      await tx.flush()
    })
    // Give the holder a head start so it reliably wins the lock first.
    await sleep(50)
    const holderCommittedAt = { at: 0 }
    void holder.then(() => { holderCommittedAt.at = Date.now() })

    const em = orm.em.fork()
    await handleOrderCreditRelease(
      { orderId, tenantId: TENANT_ID, organizationId: ORG_ID },
      ctxFor(em),
      { eventId: 'sales.order.cancelled' },
    )
    const handlerFinishedAt = Date.now()
    await holder

    // The handler could not have finished before the holder released the lock. Comparing
    // against the holder's own commit timestamp (rather than a derived elapsed-duration
    // threshold) avoids baking in the 50ms head start as an assumed constant — this holds
    // regardless of real scheduling/CI jitter in either leg.
    expect(holderCommittedAt.at).toBeGreaterThan(0)
    expect(handlerFinishedAt).toBeGreaterThanOrEqual(holderCommittedAt.at)

    // The handler's own reservations read ran AFTER the lock was free, so it sees the
    // reinstate-simulated row the holder committed — never a stale pre-commit snapshot —
    // and (correctly, for a genuine `sales.order.cancelled`) releases it too.
    const checkEm = orm.em.fork()
    const releaseForReinstated = await checkEm.find(CustomerCreditLedgerEntry, {
      tenantId: TENANT_ID,
      creditAccountId: accountId,
      entryType: 'release',
      idempotencyKey: `release:${reinstateKey}`,
    })
    expect(releaseForReinstated).toHaveLength(1)
  })

  test('pg_advisory_xact_lock(hashtextextended(key, 0)) blocks a second connection until the first transaction commits', async () => {
    const lockKey = `lock-probe-${randomUUID()}`
    const emFirst = orm.em.fork()
    const emSecond = orm.em.fork()
    const events: Array<{ label: string; at: number }> = []

    const firstHoldMs = 300
    const first = emFirst.transactional(async (tx) => {
      await tx.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [lockKey])
      events.push({ label: 'first-acquired', at: Date.now() })
      await sleep(firstHoldMs)
      events.push({ label: 'first-committing', at: Date.now() })
    })
    // Give the first transaction a head start so it reliably wins the race for the lock.
    await sleep(50)

    const second = emSecond.transactional(async (tx) => {
      await tx.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [lockKey])
      events.push({ label: 'second-acquired', at: Date.now() })
    })

    await Promise.all([first, second])

    const firstCommitting = events.find((event) => event.label === 'first-committing')
    const secondAcquired = events.find((event) => event.label === 'second-acquired')
    expect(firstCommitting).toBeDefined()
    expect(secondAcquired).toBeDefined()
    // The second connection's acquisition can only be recorded once the first
    // transaction's own commit has started releasing the lock — proving these two real
    // connections were genuinely serialized by Postgres, not just by JS event-loop
    // ordering.
    expect(secondAcquired!.at).toBeGreaterThanOrEqual(firstCommitting!.at)
  })
})
