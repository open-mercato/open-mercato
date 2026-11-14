/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import {
  AssistedSellingMessage,
  AssistedSellingParticipant,
  AssistedSellingProposal,
  AssistedSellingThread,
} from '../../data/entities'
import { handleCartAdoptedForAssistedSellingIdentity } from '../cartAdoptedIdentityMigration'
import { handleCustomerAccountsUserDeletedErasure } from '../erasureSubscribers'

/**
 * #8268 review Major 4/5: the prior version of this suite only ever invoked the subscriber
 * with a hand-rolled fake `EntityManager`, which proved nothing about the real
 * `findOneWithDecryption` read path (Major 5's fix) and stopped at "the thread's fields
 * changed" — never that a SECOND, independent production consumer (proposal authoring's
 * `resolveForBuyer` call, covered in `commands/__tests__/proposals.test.ts`; customer erasure,
 * covered below) actually finds and uses what this subscriber wrote. Runs against a real
 * Postgres instance via testcontainers, the same gate `__tests__/concurrency.integration.test.ts`
 * already uses in this module.
 */
const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'assisted_selling_cart_adopted_identity_test'
const DATABASE_USER = 'assisted_selling_cart_adopted_identity'
const DATABASE_PASSWORD = 'assisted_selling_cart_adopted_identity'
const CASE_TIMEOUT_MS = 30_000

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

type AdoptedPayload = {
  cartId: string
  tenantId: string
  organizationId: string
  customerId: string
  customerUserId: string
}

describeWithPostgres('handleCartAdoptedForAssistedSellingIdentity — #8268 review Major 4/5', () => {
  let postgres: StartedTestContainer | null = null
  let orm: TestOrm | null = null

  function rootEm(): EntityManager {
    if (!orm) throw new Error('[internal] ORM is not started')
    return orm.em.fork()
  }

  function makeContainer(em: EntityManager): { resolve: <T = unknown>(name: string) => T } {
    return { resolve: <T = unknown>(name: string): T => (name === 'em' ? (em as unknown as T) : (undefined as T)) }
  }

  async function seedOpenThread(overrides: Partial<{
    tenantId: string
    organizationId: string
    buyerCartId: string
    customerId: string | null
    customerUserId: string | null
    status: string
  }> = {}): Promise<AssistedSellingThread> {
    const em = rootEm()
    const thread = em.create(AssistedSellingThread, {
      id: randomUUID(),
      tenantId: overrides.tenantId ?? randomUUID(),
      organizationId: overrides.organizationId ?? randomUUID(),
      storeId: randomUUID(),
      buyerCartId: overrides.buyerCartId ?? randomUUID(),
      modeSnapshot: 'rep',
      status: overrides.status ?? 'open',
      customerId: overrides.customerId ?? null,
      customerUserId: overrides.customerUserId ?? null,
    })
    em.persist(thread)
    await em.flush()
    return thread
  }

  async function reloadThread(id: string): Promise<AssistedSellingThread | null> {
    return rootEm().findOne(AssistedSellingThread, { id })
  }

  function makePayload(thread: AssistedSellingThread, overrides: Partial<AdoptedPayload> = {}): AdoptedPayload {
    return {
      cartId: thread.buyerCartId as string,
      tenantId: thread.tenantId,
      organizationId: thread.organizationId,
      customerId: randomUUID(),
      customerUserId: randomUUID(),
      ...overrides,
    }
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({
        POSTGRES_DB: DATABASE_NAME,
        POSTGRES_USER: DATABASE_USER,
        POSTGRES_PASSWORD: DATABASE_PASSWORD,
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>({
      driver: PostgreSqlDriver,
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: DATABASE_NAME,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
      entities: [AssistedSellingThread, AssistedSellingProposal, AssistedSellingParticipant, AssistedSellingMessage],
      debug: false,
      pool: { min: 0, max: 10 },
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    await Promise.allSettled([orm?.close(true)])
    await Promise.allSettled([postgres?.stop()])
  }, 30_000)

  it('binds the surviving thread\'s buyer identity through the real findOneWithDecryption read path', async () => {
    const thread = await seedOpenThread()
    const payload = makePayload(thread)

    await handleCartAdoptedForAssistedSellingIdentity(payload, makeContainer(rootEm()))

    const reloaded = await reloadThread(thread.id)
    expect(reloaded?.customerId).toBe(payload.customerId)
    expect(reloaded?.customerUserId).toBe(payload.customerUserId)
  }, CASE_TIMEOUT_MS)

  it('ignores a closed thread even if its buyerCartId matches', async () => {
    const thread = await seedOpenThread({ status: 'closed' })
    const payload = makePayload(thread)

    await handleCartAdoptedForAssistedSellingIdentity(payload, makeContainer(rootEm()))

    const reloaded = await reloadThread(thread.id)
    expect(reloaded?.customerId).toBeNull()
    expect(reloaded?.customerUserId).toBeNull()
  }, CASE_TIMEOUT_MS)

  it('is idempotent on redelivery once the thread already carries the adopted identity', async () => {
    const thread = await seedOpenThread()
    const payload = makePayload(thread)

    await handleCartAdoptedForAssistedSellingIdentity(payload, makeContainer(rootEm()))
    await handleCartAdoptedForAssistedSellingIdentity(payload, makeContainer(rootEm()))

    const reloaded = await reloadThread(thread.id)
    expect(reloaded?.customerId).toBe(payload.customerId)
    expect(reloaded?.customerUserId).toBe(payload.customerUserId)
  }, CASE_TIMEOUT_MS)

  it('never binds a foreign tenant/organization\'s thread that happens to share the cart id', async () => {
    const sharedCartId = randomUUID()
    const ownThread = await seedOpenThread({ buyerCartId: sharedCartId })
    const foreignThread = await seedOpenThread({ buyerCartId: sharedCartId })
    const payload = makePayload(ownThread)

    await handleCartAdoptedForAssistedSellingIdentity(payload, makeContainer(rootEm()))

    const reloadedOwn = await reloadThread(ownThread.id)
    expect(reloadedOwn?.customerId).toBe(payload.customerId)
    const reloadedForeign = await reloadThread(foreignThread.id)
    expect(reloadedForeign?.customerId).toBeNull()
    expect(reloadedForeign?.customerUserId).toBeNull()
  }, CASE_TIMEOUT_MS)

  it('lets customer erasure find and close the conversation it just bound, by customerUserId', async () => {
    // This is the whole point of binding `customerUserId` onto the surviving thread:
    // `erasureSubscribers.ts#handleCustomerAccountsUserDeletedErasure` finds every thread by
    // that column alone. Before Major 5/the issue #9392 fix, an adopted thread's identity
    // columns stayed null forever, so this erasure handler could never find it.
    const thread = await seedOpenThread()
    const payload = makePayload(thread)
    await handleCartAdoptedForAssistedSellingIdentity(payload, makeContainer(rootEm()))

    await handleCustomerAccountsUserDeletedErasure(
      { id: payload.customerUserId, tenantId: payload.tenantId, organizationId: payload.organizationId },
      makeContainer(rootEm()),
    )

    const reloaded = await reloadThread(thread.id)
    expect(reloaded?.status).toBe('closed')
    expect(reloaded?.deletedAt).not.toBeNull()
  }, CASE_TIMEOUT_MS)

  it('skips an incomplete payload without throwing', async () => {
    await expect(
      handleCartAdoptedForAssistedSellingIdentity({ cartId: randomUUID() }, makeContainer(rootEm())),
    ).resolves.toBeUndefined()
  }, CASE_TIMEOUT_MS)

  it('re-throws on a lookup failure so the persistent subscriber redelivers', async () => {
    const brokenEm = { fork: () => ({ findOne: async () => { throw new Error('boom') } }) } as unknown as EntityManager
    await expect(
      handleCartAdoptedForAssistedSellingIdentity(
        { cartId: randomUUID(), tenantId: randomUUID(), organizationId: randomUUID(), customerId: randomUUID(), customerUserId: randomUUID() },
        makeContainer(brokenEm),
      ),
    ).rejects.toThrow('boom')
  }, CASE_TIMEOUT_MS)
})
