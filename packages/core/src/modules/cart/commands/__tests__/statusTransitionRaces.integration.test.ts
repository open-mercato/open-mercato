import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import * as cartEntities from '../../data/entities'
import { Cart } from '../../data/entities'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

/**
 * MAJOR regression (inherited review findings #1/#2/#3) — real-Postgres proof that every
 * `Cart`-status transition this review round flagged as a plain check-then-set race
 * (`commands/lock.ts#lockCartCommand`, `commands/merge.ts#executeProposalAcceptance`,
 * `commands/proposal.ts#rejectProposalCommand`) is now a per-cart `pg_advisory_xact_lock`
 * plus a conditional `nativeUpdate` guarded on the FROM status, exactly the pattern this
 * suite exercises directly against the real `carts` table (not a mocked EntityManager).
 *
 * This isolates the status-transition mechanism itself from the full command machinery
 * (catalog pricing, sales calculation, promotions) those commands also depend on — the unit
 * suites (`commands/__tests__/lock.test.ts`, `merge.test.ts`, `proposal.test.ts`) already
 * cover the full command behavior with a mocked EntityManager; this suite proves the
 * concurrency-control primitive itself holds under a real database.
 */
describeWithPostgres('cart status-transition races under a real Postgres advisory lock (MAJOR #1/#2/#3)', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM | undefined

  function database(): MikroORM {
    if (!orm) throw new Error('[internal] status-transition race test ORM is not initialized')
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
      contextName: 'cart-status-races',
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

  async function readStatus(cartId: string): Promise<string> {
    const row = await database().em.fork().findOneOrFail(Cart, { id: cartId })
    return row.status
  }

  /** The guarded transition `commands/lock.ts`/`commands/merge.ts`/`commands/proposal.ts`
   * now all use: take the per-cart lock, then a conditional `nativeUpdate` guarded on the
   * expected FROM status. Returns `true` when THIS call won the race. */
  async function attemptGuardedTransition(
    cartId: string,
    fromStatus: string,
    toStatus: string,
  ): Promise<boolean> {
    const em = database().em.fork()
    await em.begin()
    try {
      await em.execute('select pg_advisory_xact_lock(hashtextextended(?::text, 0))', [lockKeyFor(cartId)])
      const affected = await em.nativeUpdate(Cart, { id: cartId, status: fromStatus }, { status: toStatus })
      await em.commit()
      return affected > 0
    } catch (err) {
      await em.rollback().catch(() => undefined)
      throw err
    }
  }

  // ---------------------------------------------------------------------------
  // MAJOR #1 — `cart.lock`'s own active -> locked transition.
  // ---------------------------------------------------------------------------

  it('MAJOR #1: two concurrent cart.lock attempts on the SAME active cart — exactly one wins, never both', async () => {
    const cartId = await insertCart()

    const [a, b] = await Promise.all([
      attemptGuardedTransition(cartId, 'active', 'locked'),
      attemptGuardedTransition(cartId, 'active', 'locked'),
    ])

    // Exactly one of the two actually transitioned the row — the old unconditional
    // assign-and-flush would have let BOTH report success (and, in the real command,
    // both reserve stock/credit downstream).
    expect([a, b].filter(Boolean)).toHaveLength(1)
    expect(await readStatus(cartId)).toBe('locked')
  })

  it('MAJOR #1: N concurrent cart.lock attempts on the SAME active cart — exactly one wins', async () => {
    const cartId = await insertCart()
    const N = 8

    const results = await Promise.all(
      Array.from({ length: N }, () => attemptGuardedTransition(cartId, 'active', 'locked')),
    )

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await readStatus(cartId)).toBe('locked')
  })

  // ---------------------------------------------------------------------------
  // MAJOR #2 — `cart.lines.add`'s re-check-inside-the-lock, racing a concurrent cart.lock.
  // ---------------------------------------------------------------------------

  /** Mirrors `commands/lines.ts#addLineCommand`'s fixed lock phase: take the lock, THEN
   * `em.refresh(cart)` and re-read status fresh — never trust the pre-lock snapshot. */
  async function attemptLineAddUnderLock(cartId: string): Promise<{ allowed: boolean; statusSeenUnderLock: string }> {
    const em = database().em.fork()
    await em.begin()
    try {
      await em.execute('select pg_advisory_xact_lock(hashtextextended(?::text, 0))', [lockKeyFor(cartId)])
      const cart = await em.findOneOrFail(Cart, { id: cartId })
      const allowed = cart.status === 'active'
      await em.commit()
      return { allowed, statusSeenUnderLock: cart.status }
    } catch (err) {
      await em.rollback().catch(() => undefined)
      throw err
    }
  }

  it('MAJOR #2: a line-add that loses the race to a concurrent cart.lock sees the FRESH (locked) status under the lock, not a stale pre-lock snapshot', async () => {
    const cartId = await insertCart()

    // The exact bad sequence the finding describes: `requireActive` is read BEFORE the
    // lock is even attempted (always 'active' here, by construction — the race window the
    // old code left open). Then a concurrent `cart.lock` fully completes and commits
    // first. The fix's OWN re-check, which only runs once the lock is actually held, must
    // observe the cart as already locked.
    const staleSnapshotStatus = await readStatus(cartId)
    expect(staleSnapshotStatus).toBe('active')

    const lockWon = await attemptGuardedTransition(cartId, 'active', 'locked')
    expect(lockWon).toBe(true)

    const lineAddResult = await attemptLineAddUnderLock(cartId)
    expect(lineAddResult.statusSeenUnderLock).toBe('locked')
    expect(lineAddResult.allowed).toBe(false)
  })

  it('MAJOR #2: a line-add that wins the race to the lock before cart.lock runs is correctly allowed', async () => {
    const cartId = await insertCart()

    const lineAddResult = await attemptLineAddUnderLock(cartId)
    expect(lineAddResult.allowed).toBe(true)

    // The lock can still take effect afterward — ordinary, non-racing sequencing.
    expect(await attemptGuardedTransition(cartId, 'active', 'locked')).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // MAJOR #3 — `cart.proposal.accept`/`.reject`'s own guarded transition, same lock key.
  // ---------------------------------------------------------------------------

  async function insertProposal(overrides: Partial<Record<string, unknown>> = {}): Promise<string> {
    return insertCart({ kind: 'proposal', ...overrides })
  }

  it('MAJOR #3: a double-click accept (two concurrent cart.proposal.accept calls) on the SAME proposal — exactly one merges', async () => {
    const proposalId = await insertProposal()

    const [a, b] = await Promise.all([
      attemptGuardedTransition(proposalId, 'active', 'merged'),
      attemptGuardedTransition(proposalId, 'active', 'merged'),
    ])

    expect([a, b].filter(Boolean)).toHaveLength(1)
    expect(await readStatus(proposalId)).toBe('merged')
  })

  it('MAJOR #3: a concurrent accept and reject on the SAME proposal — exactly one applies, the loser never clobbers it', async () => {
    const proposalId = await insertProposal()

    const [acceptWon, rejectWon] = await Promise.all([
      attemptGuardedTransition(proposalId, 'active', 'merged'),
      attemptGuardedTransition(proposalId, 'active', 'abandoned'),
    ])

    // Exactly one of the two transitions actually applied — never both (which would be
    // impossible on one row anyway) and never a THIRD, inconsistent state.
    expect([acceptWon, rejectWon].filter(Boolean)).toHaveLength(1)
    const finalStatus = await readStatus(proposalId)
    expect(['merged', 'abandoned']).toContain(finalStatus)
    expect(acceptWon ? finalStatus === 'merged' : finalStatus === 'abandoned').toBe(true)
  })

  it('MAJOR #3: reject after a committed accept reports a conflict instead of silently overwriting status', async () => {
    const proposalId = await insertProposal()

    expect(await attemptGuardedTransition(proposalId, 'active', 'merged')).toBe(true)
    // The old code's bug: an unconditional `proposal.status = 'abandoned'; await em.flush()`
    // would have overwritten this unconditionally. The guard now reports zero affected rows.
    expect(await attemptGuardedTransition(proposalId, 'active', 'abandoned')).toBe(false)
    expect(await readStatus(proposalId)).toBe('merged')
  })
})
