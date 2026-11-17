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
  CustomerCreditServiceError,
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

// #8268 review Minor / #8820: `adjustCredit`'s ledger carries a REAL
// `(tenant_id, idempotency_key)` unique constraint (G2) — a reused key races the account
// row lock, so only the DB's own constraint (never the pre-check `findOne` above it) can
// catch a cross-account reuse. A fake `EntityManager` with no constraint cannot prove this
// path at all; this suite runs it against the genuine schema. The adjust API route maps
// `CustomerCreditServiceError` to a typed 409/422 — this is the service-level proof the
// error it maps is always a `CustomerCreditServiceError`, never a raw, unhandled Postgres
// unique-violation.
maybe('customerCreditService.adjustCredit idempotency key reuse against the real unique constraint (#8820)', () => {
  jest.setTimeout(60_000)
  let orm: MikroORM

  beforeAll(async () => {
    orm = await MikroORM.init({
      clientUrl: PG_URL,
      entities: [CustomerCreditAccount, CustomerCreditLedgerEntry],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
      pool: { min: 0, max: 8 },
    })
    await orm.schema.refresh()
  }, 60_000)

  afterAll(async () => {
    await orm?.close(true)
  })

  async function seedAccountFor(customerId: string): Promise<{ accountId: string }> {
    const em = orm.em.fork()
    const account = em.create(CustomerCreditAccount, {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      customerId,
      currencyCode: CURRENCY,
      creditLimit: '1000.00',
      isOnHold: false,
    })
    em.persist(account)
    await em.flush()
    return { accountId: account.id }
  }

  function serviceForAdjust(em: EntityManager): CustomerCreditService {
    return new DefaultCustomerCreditService(em, ALWAYS_ALLOWED_GROUPS_SERVICE)
  }

  test('reusing the same key on the SAME account with a different amount resolves to a typed mismatch, never a raw 500', async () => {
    const customerId = randomUUID()
    await seedAccountFor(customerId)
    const key = `adjust-${randomUUID()}`
    const first = serviceForAdjust(orm.em.fork())
    await first.adjustCredit({
      scope: SCOPE,
      buyer: { customerId },
      currencyCode: CURRENCY,
      amount: '10.00',
      note: 'first adjustment',
      idempotencyKey: key,
    })

    const second = serviceForAdjust(orm.em.fork())
    const attempt = second.adjustCredit({
      scope: SCOPE,
      buyer: { customerId },
      currencyCode: CURRENCY,
      amount: '11.00',
      note: 'reused key, different amount',
      idempotencyKey: key,
    })
    await expect(attempt).rejects.toBeInstanceOf(CustomerCreditServiceError)
    await expect(attempt).rejects.toMatchObject({ code: 'idempotency_key_mismatch' })
  })

  test('reusing the same key on a DIFFERENT account races the row lock and resolves to a typed mismatch, never a raw 500', async () => {
    const customerA = randomUUID()
    const customerB = randomUUID()
    await seedAccountFor(customerA)
    await seedAccountFor(customerB)
    const key = `adjust-cross-account-${randomUUID()}`

    const first = serviceForAdjust(orm.em.fork())
    await first.adjustCredit({
      scope: SCOPE,
      buyer: { customerId: customerA },
      currencyCode: CURRENCY,
      amount: '10.00',
      note: 'account A adjustment',
      idempotencyKey: key,
    })

    // This loses the account-row-lock pre-check (it locks account B's row, not A's, so the
    // `findOne` guard above it sees nothing) and must instead be caught by the real
    // `(tenant_id, idempotency_key)` unique constraint on INSERT — the exact path a fake
    // EntityManager with no constraint cannot exercise.
    const second = serviceForAdjust(orm.em.fork())
    const attempt = second.adjustCredit({
      scope: SCOPE,
      buyer: { customerId: customerB },
      currencyCode: CURRENCY,
      amount: '10.00',
      note: 'account B reusing account A key',
      idempotencyKey: key,
    })
    await expect(attempt).rejects.toBeInstanceOf(CustomerCreditServiceError)
    await expect(attempt).rejects.toMatchObject({ code: 'idempotency_key_mismatch' })
  })

  test('replaying the exact same request (same key, same amount, same account) is idempotent and returns the original entry', async () => {
    const customerId = randomUUID()
    await seedAccountFor(customerId)
    const key = `adjust-replay-${randomUUID()}`

    const first = serviceForAdjust(orm.em.fork())
    const firstResult = await first.adjustCredit({
      scope: SCOPE,
      buyer: { customerId },
      currencyCode: CURRENCY,
      amount: '25.00',
      note: 'idempotent replay',
      idempotencyKey: key,
    })

    const second = serviceForAdjust(orm.em.fork())
    const secondResult = await second.adjustCredit({
      scope: SCOPE,
      buyer: { customerId },
      currencyCode: CURRENCY,
      amount: '25.00',
      note: 'idempotent replay',
      idempotencyKey: key,
    })

    expect(secondResult.entry.entryId).toBe(firstResult.entry.entryId)
  })
})

// Review finding: the admin credit-accounts LIST route used to call `getAccountExposure`
// once per listed row, each one re-reading that account's ENTIRE ledger and summing it in
// JS — an N+1 that also re-scans the whole table per account on every page view. The fix
// batches it into `getAccountExposures`: one grouped `SUM(amount) ... GROUP BY
// credit_account_id` query for every id in the page, plus one `id IN (...)` account fetch
// — this is the live proof that the grouped SQL sum, run against a REAL Postgres
// `numeric(16,2)` column, lands on the exact same totals `getAccountExposure` computes one
// account at a time (the N+1 path this replaces), not an approximation.
maybe('customerCreditService getAccountExposures batches correctly against real Postgres', () => {
  jest.setTimeout(60_000)
  let orm: MikroORM

  beforeAll(async () => {
    orm = await MikroORM.init({
      clientUrl: PG_URL,
      entities: [CustomerCreditAccount, CustomerCreditLedgerEntry],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
      pool: { min: 0, max: 8 },
    })
    await orm.schema.refresh()
  }, 60_000)

  afterAll(async () => {
    await orm?.close(true)
  })

  async function seedAccountWithLedger(
    creditLimit: string,
    ledgerAmounts: string[],
  ): Promise<{ accountId: string }> {
    const em = orm.em.fork()
    const account = em.create(CustomerCreditAccount, {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      customerId: randomUUID(),
      currencyCode: CURRENCY,
      creditLimit,
      isOnHold: false,
    })
    em.persist(account)
    // Flush first: `id` is a DB-generated default (`gen_random_uuid()`), not assigned
    // client-side, so the ledger rows below need the account's row to exist before they
    // can reference `account.id` as their FK.
    await em.flush()
    for (const amount of ledgerAmounts) {
      em.persist(
        em.create(CustomerCreditLedgerEntry, {
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          creditAccountId: account.id,
          entryType: 'adjust',
          amount,
          sourceType: 'manual',
          sourceId: randomUUID(),
          idempotencyKey: `seed-${randomUUID()}`,
          balanceAfter: amount,
          createdByActorType: 'system',
        }),
      )
    }
    await em.flush()
    return { accountId: account.id }
  }

  test('one grouped-sum call reports the same exposure/available as one getAccountExposure call per account', async () => {
    const em = orm.em.fork()
    const service = serviceForExposures(em)

    const accountA = await seedAccountWithLedger('500.00', ['100.00', '1.005', '-20.50'])
    const accountB = await seedAccountWithLedger('300.00', ['50.00'])
    const accountC = await seedAccountWithLedger('1000.00', [])

    const expectedA = await service.getAccountExposure({ creditAccountId: accountA.accountId, scope: SCOPE })
    const expectedB = await service.getAccountExposure({ creditAccountId: accountB.accountId, scope: SCOPE })
    const expectedC = await service.getAccountExposure({ creditAccountId: accountC.accountId, scope: SCOPE })

    const batched = await service.getAccountExposures({
      creditAccountIds: [accountA.accountId, accountB.accountId, accountC.accountId],
      scope: SCOPE,
    })

    expect(batched.get(accountA.accountId)).toEqual(expectedA)
    expect(batched.get(accountB.accountId)).toEqual(expectedB)
    expect(batched.get(accountC.accountId)).toEqual(expectedC)
    expect(batched.size).toBe(3)
  })

  function serviceForExposures(em: EntityManager): CustomerCreditService {
    return new DefaultCustomerCreditService(em, ALWAYS_ALLOWED_GROUPS_SERVICE)
  }
})

// #8268 review Critical 2 (re-review): `idempotencyKey` is unique per TENANT (G2), not
// per organization, so a tenant-wide lookup in `reserveCredit`'s replay paths — or in
// `linkCreditReservationToOrder` — could resolve a DIFFERENT organization's reservation
// whenever the two organizations' requests happen to share currency/sourceType/sourceId
// (or, for link, just the key). Before the fix, that resolved record was treated as a
// match: the finder's own reservation/exposure was reported as the caller's own, and
// `linkCreditReservationToOrder`'s account-ownership check result was discarded
// entirely, letting it attach another organization's order to a foreign ledger row. A
// fake EntityManager cannot prove the tenant-wide unique constraint actually fires, so
// this runs the race against the real schema, same convention as the adjustCredit
// cross-account suite above.
const ORG_B_ID = '33333333-3333-4333-8333-333333333333'
const SCOPE_B: CommerceScope = { tenantId: TENANT_ID, organizationId: ORG_B_ID }

maybe('customerCreditService — organization isolation on idempotency-key replay and order-link (C2)', () => {
  jest.setTimeout(60_000)
  let orm: MikroORM

  beforeAll(async () => {
    orm = await MikroORM.init({
      clientUrl: PG_URL,
      entities: [CustomerCreditAccount, CustomerCreditLedgerEntry],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
      pool: { min: 0, max: 8 },
    })
    await orm.schema.refresh()
  }, 60_000)

  afterAll(async () => {
    await orm?.close(true)
  })

  async function seedAccountForOrg(scope: CommerceScope, customerId: string): Promise<{ accountId: string }> {
    const em = orm.em.fork()
    const account = em.create(CustomerCreditAccount, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      customerId,
      currencyCode: CURRENCY,
      creditLimit: '1000.00',
      isOnHold: false,
    })
    em.persist(account)
    await em.flush()
    return { accountId: account.id }
  }

  function serviceForOrg(em: EntityManager): CustomerCreditService {
    return new DefaultCustomerCreditService(em, ALWAYS_ALLOWED_GROUPS_SERVICE)
  }

  async function findEntry(idempotencyKey: string) {
    const em = orm.em.fork()
    return em.findOne(CustomerCreditLedgerEntry, { tenantId: TENANT_ID, idempotencyKey })
  }

  test('reserveCredit: a sequential organization-B replay of organization-A\'s key never returns A\'s reservation, even with a crafted matching currency/source tuple', async () => {
    const customerA = randomUUID()
    const customerB = randomUUID()
    const { accountId: accountAId } = await seedAccountForOrg(SCOPE, customerA)
    await seedAccountForOrg(SCOPE_B, customerB)
    const key = `cross-org-reserve-${randomUUID()}`
    const sharedSourceId = randomUUID()

    const orgAService = serviceForOrg(orm.em.fork())
    const orgAResult = await orgAService.reserveCredit({
      scope: SCOPE,
      buyer: { customerId: customerA },
      currencyCode: CURRENCY,
      amount: '50.00',
      sourceType: 'checkout',
      sourceId: sharedSourceId,
      idempotencyKey: key,
    })
    expect(orgAResult.reserved).toBe(true)

    const orgBService = serviceForOrg(orm.em.fork())
    const orgBAttempt = orgBService.reserveCredit({
      scope: SCOPE_B,
      buyer: { customerId: customerB },
      currencyCode: CURRENCY,
      // Deliberately matches organization A's tuple — proves the fix rejects on
      // organization ownership specifically, not merely on a tuple mismatch it
      // would have caught anyway.
      amount: '50.00',
      sourceType: 'checkout',
      sourceId: sharedSourceId,
      idempotencyKey: key,
    })
    await expect(orgBAttempt).rejects.toBeInstanceOf(CustomerCreditServiceError)
    await expect(orgBAttempt).rejects.toMatchObject({ code: 'idempotency_key_mismatch' })

    // Organization A's entry is untouched — still the sole row for this key, still
    // pointing at organization A's account.
    const entry = await findEntry(key)
    expect(entry?.creditAccountId).toBe(accountAId)
    const allEntriesForKey = await orm.em.fork().find(CustomerCreditLedgerEntry, { tenantId: TENANT_ID, idempotencyKey: key })
    expect(allEntriesForKey).toHaveLength(1)
  })

  test('reserveCredit: a CONCURRENT organization-B reuse of organization-A\'s key resolves through the real unique-constraint race, never returning A\'s reservation', async () => {
    const customerA = randomUUID()
    const customerB = randomUUID()
    await seedAccountForOrg(SCOPE, customerA)
    await seedAccountForOrg(SCOPE_B, customerB)
    const key = `cross-org-race-${randomUUID()}`
    const sharedSourceId = randomUUID()

    const orgAService = serviceForOrg(orm.em.fork())
    const orgBService = serviceForOrg(orm.em.fork())

    const [orgAOutcome, orgBOutcome] = await Promise.allSettled([
      orgAService.reserveCredit({
        scope: SCOPE,
        buyer: { customerId: customerA },
        currencyCode: CURRENCY,
        amount: '50.00',
        sourceType: 'checkout',
        sourceId: sharedSourceId,
        idempotencyKey: key,
      }),
      orgBService.reserveCredit({
        scope: SCOPE_B,
        buyer: { customerId: customerB },
        currencyCode: CURRENCY,
        amount: '50.00',
        sourceType: 'checkout',
        sourceId: sharedSourceId,
        idempotencyKey: key,
      }),
    ])

    // Independent PG connections can commit the real (tenant_id, idempotency_key)
    // unique-constraint race in either order — accept either winner rather than
    // assuming array position decides it, then assert on whichever organization
    // actually won.
    const outcomes = [
      { scope: SCOPE, orgId: ORG_ID, outcome: orgAOutcome },
      { scope: SCOPE_B, orgId: ORG_B_ID, outcome: orgBOutcome },
    ]
    const winners = outcomes.filter((entry) => entry.outcome.status === 'fulfilled')
    const losers = outcomes.filter((entry) => entry.outcome.status === 'rejected')
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    const winner = winners[0]!
    const loser = losers[0]!
    expect((winner.outcome as PromiseFulfilledResult<Awaited<ReturnType<typeof orgAService.reserveCredit>>>).value.reserved).toBe(true)
    const loserReason = (loser.outcome as PromiseRejectedResult).reason
    expect(loserReason).toBeInstanceOf(CustomerCreditServiceError)
    expect(loserReason).toMatchObject({ code: 'idempotency_key_mismatch' })

    const allEntriesForKey = await orm.em.fork().find(CustomerCreditLedgerEntry, { tenantId: TENANT_ID, idempotencyKey: key })
    expect(allEntriesForKey).toHaveLength(1)
    expect(allEntriesForKey[0]?.organizationId).toBe(winner.orgId)
  })

  test('linkCreditReservationToOrder: organization B linking organization A\'s key is a no-op, never attaching B\'s order to A\'s entry', async () => {
    const customerA = randomUUID()
    const { accountId: accountAId } = await seedAccountForOrg(SCOPE, customerA)
    const key = `cross-org-link-${randomUUID()}`
    const orderIdA = randomUUID()
    const orderIdB = randomUUID()

    const orgAService = serviceForOrg(orm.em.fork())
    await orgAService.reserveCredit({
      scope: SCOPE,
      buyer: { customerId: customerA },
      currencyCode: CURRENCY,
      amount: '50.00',
      sourceType: 'checkout',
      sourceId: randomUUID(),
      idempotencyKey: key,
    })

    const orgBService = serviceForOrg(orm.em.fork())
    const linkResult = await orgBService.linkCreditReservationToOrder({
      scope: SCOPE_B,
      idempotencyKey: key,
      orderId: orderIdB,
    })
    expect(linkResult).toEqual({ linked: false, entryId: null })

    const entry = await findEntry(key)
    expect(entry?.creditAccountId).toBe(accountAId)
    expect(entry?.linkedOrderId).toBeNull()

    // Organization A can still link its own reservation afterwards — the fix only
    // refuses the FOREIGN organization's attempt, not the legitimate owner's.
    const ownLinkResult = await orgAService.linkCreditReservationToOrder({
      scope: SCOPE,
      idempotencyKey: key,
      orderId: orderIdA,
    })
    expect(ownLinkResult.linked).toBe(true)
    const linkedEntry = await findEntry(key)
    expect(linkedEntry?.linkedOrderId).toBe(orderIdA)
  })
})
