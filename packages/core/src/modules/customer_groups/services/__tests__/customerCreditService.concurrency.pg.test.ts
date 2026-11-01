/**
 * N=20 parallel `reserveCredit` against a real PostgreSQL (G1, spec §6.3/§13).
 *
 * This is the acceptance gate the spec names before any route is built on top of the
 * credit service: real concurrency, not a sequential proxy. `services/__tests__/
 * customerCreditService.test.ts` already proves the SEQUENTIAL decision logic against a
 * fake EntityManager whose `lockMode` is accepted and ignored — exactly the limitation
 * `promotions/lib/__tests__/promotion-usage-service.test.ts`'s own header comment
 * documents for that module's row lock. This file is the live proof the row lock
 * (`LockMode.PESSIMISTIC_WRITE` on `CustomerCreditAccount`, inside
 * `withAtomicFlush(em, phases, { transaction: true })`) actually serializes writers: N
 * real MikroORM EntityManagers, each with its OWN connection out of the pool, firing
 * `reserveCredit` concurrently against the SAME account with a limit that admits only 3
 * of the 20 reservations. Without the lock every connection would re-read the same stale
 * `SUM(amount)` and all 20 (or some number > 3) would succeed, overshooting the limit.
 *
 * The second test proves the harder G1 case explicitly called out by the spec: a caller
 * that ALREADY holds an open transaction on its own EntityManager (checkout's submit
 * sequence) calling `reserveCredit`, which must JOIN that transaction rather than open a
 * nested one or silently drop the lock — `withAtomicFlush` ignores `isolationLevel` on an
 * ambient transaction, so the row lock is the only thing doing the serializing either way.
 *
 * Gated on OM_CUSTOMER_GROUPS_PG_URL — a throwaway database, since the suite creates and
 * drops its own schema. Never point it at a development or shared database. Run it with:
 *
 *   docker run -d --rm --name om-customer-groups-pg -e POSTGRES_PASSWORD=postgres \
 *     -e POSTGRES_DB=om -p 54374:5432 postgres:18-alpine
 *   OM_CUSTOMER_GROUPS_PG_URL=postgres://postgres:postgres@127.0.0.1:54374/om \
 *     yarn workspace @open-mercato/core jest customerCreditService.concurrency.pg
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { CustomerCreditAccount, CustomerCreditLedgerEntry } from '../../data/entities'
import {
  DefaultCustomerCreditService,
  type CommerceScope,
  type CustomerCreditService,
} from '../customerCreditService'
import type { CustomerGroupsService, ResolvedTerms } from '../customerGroupsService'

const PG_URL = process.env.OM_CUSTOMER_GROUPS_PG_URL ?? ''
const PARALLEL = Number(process.env.OM_CUSTOMER_GROUPS_RACE_PARALLEL ?? '20')
const maybe = PG_URL ? describe : describe.skip

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CURRENCY = 'USD'
const SCOPE: CommerceScope = { tenantId: TENANT_ID, organizationId: ORG_ID }

// `reserveCredit` resolves `allowPurchaseOnAccount` through `customerGroupsService`
// (G11), but this suite is about the row lock, not terms inheritance — a fixed stub
// keeps the schema to just the two credit tables, same simplification the unit test's
// `allowTerms()` helper makes.
const ALWAYS_ALLOWED_GROUPS_SERVICE: CustomerGroupsService = {
  resolveGroups: async () => ({ groupIds: [], groups: [] }),
  resolveTerms: async () => ({ allowPurchaseOnAccount: true }) as unknown as ResolvedTerms,
  resolveAssortmentScope: async () => ({ scope: null, sourceGroupIds: [], sourceCustomerOverrideId: null }),
}

maybe('customerCreditService reserveCredit under real concurrency (G1)', () => {
  jest.setTimeout(120_000)
  let orm: MikroORM

  beforeAll(async () => {
    orm = await MikroORM.init({
      clientUrl: PG_URL,
      entities: [CustomerCreditAccount, CustomerCreditLedgerEntry],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
      pool: { min: 0, max: PARALLEL * 2 + 4 },
    })
    await orm.schema.refresh()
  }, 60_000)

  afterAll(async () => {
    await orm?.close(true)
  })

  async function seedAccount(creditLimit: string): Promise<{ customerId: string; accountId: string }> {
    const customerId = randomUUID()
    const em = orm.em.fork()
    const account = em.create(CustomerCreditAccount, {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      customerId,
      currencyCode: CURRENCY,
      creditLimit,
      isOnHold: false,
    })
    em.persist(account)
    await em.flush()
    return { customerId, accountId: account.id }
  }

  function serviceFor(em: EntityManager): CustomerCreditService {
    return new DefaultCustomerCreditService(em, ALWAYS_ALLOWED_GROUPS_SERVICE)
  }

  async function sumLedgerInDb(accountId: string): Promise<number> {
    const em = orm.em.fork()
    const rows = await em.find(CustomerCreditLedgerEntry, { tenantId: TENANT_ID, creditAccountId: accountId })
    return rows.reduce((total, row) => total + Number(row.amount), 0)
  }

  test(`${PARALLEL} concurrent reserveCredit calls against a limit admitting exactly 3 reserve exactly 3`, async () => {
    const PER_RESERVE_AMOUNT = '100.00'
    const CREDIT_LIMIT = '300.00'
    const { customerId, accountId } = await seedAccount(CREDIT_LIMIT)

    const attempts = Array.from({ length: PARALLEL }, (_unused, index) => {
      // Each caller forks its OWN EntityManager — a real, independent connection out of
      // the pool — so the only thing that can prevent an overshoot is the row lock, not
      // pool serialization.
      const em = orm.em.fork()
      const service = serviceFor(em)
      return service.reserveCredit({
        scope: SCOPE,
        buyer: { customerId },
        currencyCode: CURRENCY,
        amount: PER_RESERVE_AMOUNT,
        sourceType: 'checkout',
        // `source_id` is a `uuid` column (§5.5: "the checkout session id") — a real uuid
        // per attempt, `index` only identifies the attempt for debugging.
        sourceId: randomUUID(),
        idempotencyKey: `race-reserve-${index}`,
      })
    })

    const results = await Promise.all(attempts)
    const reserved = results.filter((result) => result.reserved)
    const refused = results.filter((result) => !result.reserved)

    expect(reserved.length + refused.length).toBe(PARALLEL)
    for (const refusal of refused) {
      expect(refusal.check.reason).toBe('limit_exceeded')
    }

    // The core guarantee: even under real concurrency, exactly CREDIT_LIMIT / PER_RESERVE_AMOUNT
    // reservations succeed — never fewer (the lock must not starve legitimate reserves) and
    // never more (the lock must not let the limit be overshot).
    const expectedAcceptances = Number(CREDIT_LIMIT) / Number(PER_RESERVE_AMOUNT)
    expect(reserved.length).toBe(expectedAcceptances)

    const consumedInDb = await sumLedgerInDb(accountId)
    expect(consumedInDb).toBeLessThanOrEqual(Number(CREDIT_LIMIT))
    expect(consumedInDb).toBe(reserved.length * Number(PER_RESERVE_AMOUNT))
  })

  test(`${PARALLEL} concurrent reserveCredit calls, each inside its OWN already-open outer transaction, still reserve exactly 3`, async () => {
    const PER_RESERVE_AMOUNT = '100.00'
    const CREDIT_LIMIT = '300.00'
    const { customerId, accountId } = await seedAccount(CREDIT_LIMIT)

    const attempts = Array.from({ length: PARALLEL }, (_unused, index) => {
      const em = orm.em.fork()
      // Open the outer transaction BEFORE calling the service — this is the G1 case the
      // spec calls out explicitly: `withAtomicFlush` must find `em.isInTransaction()`
      // true and JOIN it rather than open a nested one, so the row lock (not a dropped
      // isolation level) is still what serializes these writers.
      return em.transactional(async (trx) => {
        const service = serviceFor(trx as unknown as EntityManager)
        return service.reserveCredit({
          scope: SCOPE,
          buyer: { customerId },
          currencyCode: CURRENCY,
          amount: PER_RESERVE_AMOUNT,
          sourceType: 'checkout',
          sourceId: randomUUID(),
          idempotencyKey: `race-nested-reserve-${index}`,
        })
      })
    })

    const results = await Promise.all(attempts)
    const reserved = results.filter((result) => result.reserved)
    const refused = results.filter((result) => !result.reserved)

    expect(reserved.length + refused.length).toBe(PARALLEL)
    for (const refusal of refused) {
      expect(refusal.check.reason).toBe('limit_exceeded')
    }

    const expectedAcceptances = Number(CREDIT_LIMIT) / Number(PER_RESERVE_AMOUNT)
    expect(reserved.length).toBe(expectedAcceptances)

    const consumedInDb = await sumLedgerInDb(accountId)
    expect(consumedInDb).toBeLessThanOrEqual(Number(CREDIT_LIMIT))
    expect(consumedInDb).toBe(reserved.length * Number(PER_RESERVE_AMOUNT))
  })
})
