import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/postgresql'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import * as cartEntities from '../../data/entities'
import { Cart } from '../../data/entities'
import { isCartLineMutationLockTimeoutError, withCartLineMutationLock } from '../../lib/lineMutationLock'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

/**
 * Real-PostgreSQL proof of the concurrency primitive every cart writer of lines or status
 * uses (spec §8.1, rev 10.1 — I1; re-landing step CA0): `withCartLineMutationLock` takes
 * `cart:lines:<id>` for one or several carts with `pg_try_advisory_xact_lock`, rolls a
 * contended attempt back before backing off, and the writer re-reads the cart under the lock
 * and moves its status with a `nativeUpdate` guarded on the FROM status — the shape
 * `cart.lock`, `cart.lines.*`, `cart.merge` and the merge undo follow.
 *
 * The full commands (pricing, promotions, totals) are covered with a mocked EntityManager in
 * `lock.test.ts`, `lines.test.ts` and `merge.test.ts`; the real-command race harness on
 * PostgreSQL ships with CA6/CA9a (#9183).
 */
describeWithPostgres('cart status-transition races under the cart advisory lock (PostgreSQL)', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM | undefined
  let smallPoolOrm: MikroORM | undefined

  function database(): MikroORM {
    if (!orm) throw new Error('[internal] status-transition race test ORM is not initialized')
    return orm
  }

  function smallPoolDatabase(): MikroORM {
    if (!smallPoolOrm) throw new Error('[internal] small-pool race test ORM is not initialized')
    return smallPoolOrm
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_USER: 'cart_test', POSTGRES_PASSWORD: 'cart_test', POSTGRES_DB: 'cart_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .withStartupTimeout(60_000)
      .start()
    const connection = {
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      user: 'cart_test',
      password: 'cart_test',
      dbName: 'cart_test',
      entities: [...Object.values(cartEntities)],
      driverOptions: { connectionTimeoutMillis: 5_000 },
    }
    orm = await MikroORM.init({ ...connection, contextName: 'cart-status-races', pool: { min: 0, max: 10 } })
    await orm.schema.create()
    smallPoolOrm = await MikroORM.init({ ...connection, contextName: 'cart-status-races-pool-2', pool: { min: 0, max: 2 } })
  }, 120_000)

  afterAll(async () => {
    try {
      await smallPoolOrm?.close(true)
      await orm?.close(true)
    } finally {
      await postgres?.stop()
    }
  })

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

  async function readCart(cartId: string): Promise<Cart> {
    return database().em.fork().findOneOrFail(Cart, { id: cartId })
  }

  type TransitionOutcome = 'won' | 'refused_under_lock' | 'lost_compare_and_set'

  /** `cart.lock`'s shape: take the lock, re-read the cart, refuse a non-active one, then a
   * compare-and-set on `status = 'active'`. */
  async function attemptLock(source: MikroORM, cartId: string, checkoutSessionId: string): Promise<TransitionOutcome> {
    const em = source.em.fork() as EntityManager
    let outcome: TransitionOutcome = 'won'
    await withCartLineMutationLock(em, cartId, [
      async () => {
        const cart = await em.findOneOrFail(Cart, { id: cartId }, { refresh: true })
        if (cart.status !== 'active') {
          outcome = 'refused_under_lock'
          return
        }
        const affected = await em.nativeUpdate(
          Cart,
          { id: cartId, status: 'active' },
          { status: 'locked', lockedAt: new Date(), checkoutSessionId },
        )
        if (affected === 0) outcome = 'lost_compare_and_set'
      },
    ], 'cart.lock')
    return outcome
  }

  /** `cart.lines.add`'s in-lock re-check: the status read only once the lock is held. */
  async function attemptLineWrite(cartId: string): Promise<{ allowed: boolean; statusSeenUnderLock: string }> {
    const em = database().em.fork() as EntityManager
    let seen = ''
    await withCartLineMutationLock(em, cartId, [
      async () => {
        const cart = await em.findOneOrFail(Cart, { id: cartId }, { refresh: true })
        seen = cart.status
        if (cart.status !== 'active') return
        await em.nativeUpdate(Cart, { id: cartId }, { lastActivityAt: new Date() })
      },
    ], 'cart.lines.add')
    return { allowed: seen === 'active', statusSeenUnderLock: seen }
  }

  it('N concurrent cart.lock attempts on the same active cart: exactly one locks it, every other one is refused under the lock', async () => {
    const cartId = await insertCart()

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, (_unused, index) => attemptLock(database(), cartId, `session-${index}`)),
    )

    expect(outcomes.filter((outcome) => outcome === 'won')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome === 'refused_under_lock')).toHaveLength(7)
    const winnerIndex = outcomes.indexOf('won')
    const cart = await readCart(cartId)
    expect(cart.status).toBe('locked')
    expect(cart.checkoutSessionId).toBe(`session-${winnerIndex}`)
  })

  it('the compare-and-set refuses the transition when a writer outside the lock moved the status after the in-lock read', async () => {
    const cartId = await insertCart()
    const em = database().em.fork() as EntityManager
    let affected = -1

    await withCartLineMutationLock(em, cartId, [
      async () => {
        const cart = await em.findOneOrFail(Cart, { id: cartId }, { refresh: true })
        expect(cart.status).toBe('active')
        await database().em.fork().nativeUpdate(Cart, { id: cartId }, { status: 'abandoned' })
        affected = await em.nativeUpdate(Cart, { id: cartId, status: 'active' }, { status: 'locked' })
      },
    ], 'cart.lock')

    expect(affected).toBe(0)
    expect((await readCart(cartId)).status).toBe('abandoned')
  })

  it('a line write queued behind a committed cart.lock reads the locked status under the lock and writes nothing', async () => {
    const cartId = await insertCart()
    const before = await readCart(cartId)

    expect(await attemptLock(database(), cartId, 'session-1')).toBe('won')
    const lineWrite = await attemptLineWrite(cartId)

    expect(lineWrite).toEqual({ allowed: false, statusSeenUnderLock: 'locked' })
    expect((await readCart(cartId)).lastActivityAt.getTime()).toBe(before.lastActivityAt.getTime())
  })

  it('a line write that gets the lock first lands, and the later cart.lock still locks the cart', async () => {
    const cartId = await insertCart()

    expect((await attemptLineWrite(cartId)).allowed).toBe(true)
    expect(await attemptLock(database(), cartId, 'session-1')).toBe('won')
  })

  it('a line write racing cart.lock serializes: either it lands before the lock or it sees the cart locked', async () => {
    const cartIds = await Promise.all(Array.from({ length: 6 }, () => insertCart()))

    const results = await Promise.all(cartIds.map(async (cartId) => {
      const [lineWrite, lock] = await Promise.all([attemptLineWrite(cartId), attemptLock(database(), cartId, 'session-race')])
      return { lineWrite, lock }
    }))

    for (const { lineWrite, lock } of results) {
      expect(lock).toBe('won')
      expect(['active', 'locked']).toContain(lineWrite.statusSeenUnderLock)
      expect(lineWrite.allowed).toBe(lineWrite.statusSeenUnderLock === 'active')
    }
  })

  it('two writers locking the same two carts in opposite orders both complete without deadlock (merge vs merge undo)', async () => {
    const cartA = await insertCart()
    const cartB = await insertCart()
    const order: string[] = []

    const writer = async (ids: string[], label: string) => {
      const em = database().em.fork() as EntityManager
      await withCartLineMutationLock(em, ids, [
        async () => {
          order.push(`${label}:start`)
          await new Promise((resolve) => setTimeout(resolve, 100))
          await em.nativeUpdate(Cart, { id: { $in: [cartA, cartB] } }, { lastActivityAt: new Date() })
          order.push(`${label}:end`)
        },
      ], label)
    }

    await Promise.all(Array.from({ length: 4 }, (_unused, index) =>
      index % 2 === 0 ? writer([cartA, cartB], `merge-${index}`) : writer([cartB, cartA], `undo-${index}`),
    ))

    expect(order).toHaveLength(8)
    for (let index = 0; index < order.length; index += 2) {
      expect(order[index].replace(':start', '')).toBe(order[index + 1].replace(':end', ''))
    }
  }, 30_000)

  it('waiters hold no pooled connection: with pool 2 the lock holder\'s nested pricing fork still completes', async () => {
    const cartId = await insertCart()
    const holderEm = smallPoolDatabase().em.fork() as EntityManager
    let releaseHolder: () => void = () => undefined
    const holderMayFinish = new Promise<void>((resolve) => { releaseHolder = resolve })
    let holderStarted: () => void = () => undefined
    const holderHasLock = new Promise<void>((resolve) => { holderStarted = resolve })
    let forkQueryResult: number | null = null

    const holder = withCartLineMutationLock(holderEm, cartId, [
      async () => {
        holderStarted()
        await holderMayFinish
        const rows = await smallPoolDatabase().em.fork().execute<Array<{ value: number }>>('select 1 as value')
        forkQueryResult = Number(rows[0]?.value)
      },
    ], 'cart.lock')

    await holderHasLock
    const waiters = Array.from({ length: 4 }, (_unused, index) =>
      index % 2 === 0 ? attemptLock(smallPoolDatabase(), cartId, `waiter-${index}`) : attemptLineWriteOn(smallPoolDatabase(), cartId),
    )
    await new Promise((resolve) => setTimeout(resolve, 300))
    releaseHolder()

    await holder
    expect(forkQueryResult).toBe(1)
    await Promise.all(waiters)
    expect((await readCart(cartId)).status).toBe('locked')
  }, 30_000)

  it('a waiter past its deadline gets the lock-timeout error and has written nothing', async () => {
    const cartId = await insertCart()
    const before = await readCart(cartId)
    const holderEm = database().em.fork() as EntityManager
    let releaseHolder: () => void = () => undefined
    const holderMayFinish = new Promise<void>((resolve) => { releaseHolder = resolve })
    let holderStarted: () => void = () => undefined
    const holderHasLock = new Promise<void>((resolve) => { holderStarted = resolve })

    const holder = withCartLineMutationLock(holderEm, [cartId], [
      async () => {
        holderStarted()
        await holderMayFinish
      },
    ], 'cart.merge')
    await holderHasLock

    const waiterEm = database().em.fork() as EntityManager
    const mutate = jest.fn(async () => {
      await waiterEm.nativeUpdate(Cart, { id: cartId }, { status: 'locked' })
    })
    let captured: unknown
    try {
      await withCartLineMutationLock(waiterEm, [cartId], [mutate], 'cart.mergeUndo', 300)
    } catch (err) {
      captured = err
    }
    releaseHolder()
    await holder

    expect(isCartLineMutationLockTimeoutError(captured)).toBe(true)
    expect(mutate).not.toHaveBeenCalled()
    const after = await readCart(cartId)
    expect(after.status).toBe('active')
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
  })

  async function attemptLineWriteOn(source: MikroORM, cartId: string): Promise<void> {
    const em = source.em.fork() as EntityManager
    await withCartLineMutationLock(em, cartId, [
      async () => {
        const cart = await em.findOneOrFail(Cart, { id: cartId }, { refresh: true })
        if (cart.status !== 'active') return
        await em.nativeUpdate(Cart, { id: cartId }, { lastActivityAt: new Date() })
      },
    ], 'cart.lines.update')
  }
})
