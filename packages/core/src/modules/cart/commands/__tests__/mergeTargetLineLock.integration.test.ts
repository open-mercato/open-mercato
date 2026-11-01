import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import * as cartEntities from '../../data/entities'
import { Cart, CartLine } from '../../data/entities'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

/**
 * MAJOR regression (review follow-up on inherited finding #3): `cart.proposal.accept`
 * (`commands/merge.ts#executeProposalAcceptance`) takes a per-proposal
 * `pg_advisory_xact_lock` keyed `cart:lines:${proposal.id}` — it correctly serializes
 * accept-vs-reject-vs-double-accept on the SAME proposal. But `buildMergeOutcome` (called
 * inside that same lock) mutates the TARGET cart's EXISTING lines by summing quantities,
 * without ever taking `cart:lines:${target.id}` — the lock `cart.lines.add`/`.bulkAdd`
 * already hold for every other write to that exact cart (`commands/lines.ts`). A concurrent
 * `cart.lines.add` on the target was therefore never serialized against an in-flight accept,
 * opening a lost-update race on the shared line's `quantity`.
 *
 * This isolates the lock/refresh primitive itself (not the full command machinery) against
 * a real `cart_lines` row, the same precedent `statusTransitionRaces.integration.test.ts`
 * already set for the sibling status-transition findings in this same review round: the
 * unit suites (`merge.test.ts`) cover full command behavior with a mocked EntityManager,
 * this suite proves the concurrency-control primitive holds under a real database.
 */
describeWithPostgres('cart.proposal.accept vs cart.lines.add on the SAME target cart (MAJOR, review follow-up)', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM | undefined

  function database(): MikroORM {
    if (!orm) throw new Error('[internal] merge-target-lock race test ORM is not initialized')
    return orm
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_USER: 'cart_test', POSTGRES_PASSWORD: 'cart_test', POSTGRES_DB: 'cart_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .withStartupTimeout(60_000)
      .start()
    orm = await MikroORM.init({
      contextName: 'cart-merge-target-lock',
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      user: 'cart_test',
      password: 'cart_test',
      dbName: 'cart_test',
      entities: [...Object.values(cartEntities)],
      pool: { min: 0, max: 10 },
      driverOptions: { connectionTimeoutMillis: 2_000 },
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
    }
  })

  function lockKeyFor(cartId: string): string {
    return `cart:lines:${cartId}`
  }

  async function insertCart(overrides: Partial<Record<string, unknown>> = {}): Promise<string> {
    const em = database().em.fork()
    const now = new Date()
    const cart = em.create(Cart, {
      tenantId: randomUUID(),
      organizationId: randomUUID(),
      tokenHash: randomUUID(),
      kind: 'basket',
      channel: 'storefront',
      status: 'active',
      currencyCode: 'USD',
      locale: 'en',
      taxMode: 'net',
      buyerDigest: 'test',
      totals: {},
      totalsComputedAt: now,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      ...overrides,
    })
    em.persist(cart)
    await em.flush()
    return cart.id
  }

  async function insertLine(cartId: string, quantity: string): Promise<string> {
    const em = database().em.fork()
    const now = new Date()
    const line = em.create(CartLine, {
      organizationId: randomUUID(),
      tenantId: randomUUID(),
      cartId,
      lineNumber: 1,
      productId: randomUUID(),
      name: 'Test product',
      quantity,
      pricedAt: now,
      lineTotals: {},
      addedByActorType: 'customer',
    })
    em.persist(line)
    await em.flush()
    return line.id
  }

  async function readLineQuantity(lineId: string): Promise<number> {
    const row = await database().em.fork().findOneOrFail(CartLine, { id: lineId })
    return Number(row.quantity)
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /** Mirrors `commands/lines.ts#addLineCommand`'s own lock discipline: acquire the
   * TARGET's lock, then read-modify-write the line fresh, entirely inside it. */
  async function simulateLinesAdd(targetId: string, lineId: string, delta: number): Promise<void> {
    const em = database().em.fork()
    await em.begin()
    try {
      await em.execute('select pg_advisory_xact_lock(hashtextextended(?::text, 0))', [lockKeyFor(targetId)])
      const line = await em.findOneOrFail(CartLine, { id: lineId })
      await em.nativeUpdate(CartLine, { id: lineId }, { quantity: String(Number(line.quantity) + delta) })
      await em.commit()
    } catch (err) {
      await em.rollback().catch(() => undefined)
      throw err
    }
  }

  /** Mirrors `executeProposalAcceptance`: `targetCustomerLines` is read BEFORE any lock is
   * taken at all (the real code's own pre-`withAtomicFlush` fetch). `lockTarget: true` is
   * the FIX — acquire the target's lock too (sorted with the proposal's) and refresh the
   * line fresh before summing, exactly like `commands/merge.ts`'s own fix. `lockTarget:
   * false` is the OLD behavior — only the proposal's own lock, the line never re-read. */
  async function simulateProposalAccept(
    targetId: string,
    proposalId: string,
    lineId: string,
    delta: number,
    options: { lockTarget: boolean; delayBeforeLockMs?: number },
  ): Promise<void> {
    const em = database().em.fork()
    const preLockLine = await em.findOneOrFail(CartLine, { id: lineId })
    if (options.delayBeforeLockMs) await delay(options.delayBeforeLockMs)

    await em.begin()
    try {
      const lockKeys = options.lockTarget
        ? [lockKeyFor(proposalId), lockKeyFor(targetId)].sort()
        : [lockKeyFor(proposalId)]
      for (const key of lockKeys) {
        await em.execute('select pg_advisory_xact_lock(hashtextextended(?::text, 0))', [key])
      }
      if (options.lockTarget) await em.refresh(preLockLine)
      await em.nativeUpdate(CartLine, { id: lineId }, { quantity: String(Number(preLockLine.quantity) + delta) })
      await em.commit()
    } catch (err) {
      await em.rollback().catch(() => undefined)
      throw err
    }
  }

  it('the FIX (target lock + refresh-inside-lock) never loses either side\'s quantity delta, regardless of interleaving', async () => {
    const targetId = await insertCart()
    const proposalId = await insertCart({ kind: 'proposal' })
    const lineId = await insertLine(targetId, '5')

    await Promise.all([
      simulateProposalAccept(targetId, proposalId, lineId, 3, { lockTarget: true }),
      simulateLinesAdd(targetId, lineId, 2),
    ])

    // Both deltas land — the lock makes the two read-modify-write cycles serialize, so
    // whichever runs second always starts from the OTHER's already-committed quantity.
    expect(await readLineQuantity(lineId)).toBe(5 + 3 + 2)
  }, 20_000)

  it('the OLD behavior (no target lock, stale pre-lock read) silently loses the concurrent cart.lines.add delta', async () => {
    const targetId = await insertCart()
    const proposalId = await insertCart({ kind: 'proposal' })
    const lineId = await insertLine(targetId, '5')

    // Deterministic reproduction: the accept's pre-lock read happens immediately, then it
    // waits — giving the concurrent lines.add time to fully read-modify-write-commit (5 -> 7)
    // — before the accept resumes and unconditionally overwrites with its own STALE
    // (pre-lock quantity 5) + 3 = 8, discarding lines.add's +2 entirely.
    await Promise.all([
      simulateProposalAccept(targetId, proposalId, lineId, 3, { lockTarget: false, delayBeforeLockMs: 100 }),
      simulateLinesAdd(targetId, lineId, 2),
    ])

    expect(await readLineQuantity(lineId)).toBe(5 + 3)
  }, 20_000)
})
