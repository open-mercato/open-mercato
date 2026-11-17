/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { AssistedSellingProposal, AssistedSellingThread } from '../../data/entities'
import type { TerminalStateSubscriberContext } from '../terminalStateSubscriber'

jest.mock('../../events', () => ({ emitAssistedSellingEvent: jest.fn(async () => undefined) }))

import { emitAssistedSellingEvent } from '../../events'
import handleCartProposalAccepted from '../../subscribers/cart-proposal-accepted'
import handleCartProposalRejected from '../../subscribers/cart-proposal-rejected'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'assisted_selling_terminal_race'
const DATABASE_USER = 'assisted_selling_terminal'
const DATABASE_PASSWORD = 'assisted_selling_terminal'
const BARRIER_TIMEOUT_MS = 10_000

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>
type ProposalRead = (...args: unknown[]) => Promise<unknown>

/**
 * C3 (PR 8268 re-review 5929582808) — real-Postgres proof that two deliveries of a terminal
 * event for ONE proposal, dispatched through the real `createCartProposalTerminalHandler`
 * subscribers on separate pooled connections, decrement the thread's
 * `live_proposal_count` and emit the terminal event exactly once.
 *
 * Each delivery's unlocked `status === 'published'` read is held at a barrier until BOTH
 * deliveries have performed it, so both genuinely observe `published` before either writes —
 * the interleaving that let the former read-then-write handler decrement and emit twice. A
 * second live proposal on the same thread proves the counter lands on one, not zero.
 */
describeWithPostgres('assisted_selling terminal-state subscriber — duplicate deliveries on real PostgreSQL (C3)', () => {
  jest.setTimeout(60_000)
  let postgres: StartedTestContainer | null = null
  let orm: TestOrm | null = null

  function rootEm(): EntityManager {
    if (!orm) throw new Error('[internal] ORM is not started')
    return orm.em.fork()
  }

  function createReadBarrier(expectedReads: number) {
    let arrivals = 0
    let releaseAll: () => void = () => undefined
    const allArrived = new Promise<void>((resolve) => {
      releaseAll = resolve
    })
    return async function awaitPeers(): Promise<void> {
      arrivals += 1
      if (arrivals >= expectedReads) releaseAll()
      let timer: ReturnType<typeof setTimeout> | undefined
      const timedOut = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('[internal] terminal deliveries never overlapped at the proposal read')), BARRIER_TIMEOUT_MS)
      })
      try {
        await Promise.race([allArrived, timedOut])
      } finally {
        if (timer) clearTimeout(timer)
      }
    }
  }

  function subscriberContext(awaitPeers: () => Promise<void>): TerminalStateSubscriberContext {
    const requestEm = {
      fork(): EntityManager {
        const forked = rootEm()
        const readProposal = forked.findOne.bind(forked) as unknown as ProposalRead
        Object.defineProperty(forked, 'findOne', {
          value: async (...args: unknown[]) => {
            const found = await readProposal(...args)
            if (args[0] === AssistedSellingProposal) await awaitPeers()
            return found
          },
        })
        return forked
      },
    }
    return {
      resolve: <T = unknown>(name: string): T => {
        if (name === 'em') return requestEm as unknown as T
        throw new Error(`[internal] unexpected resolve ${name}`)
      },
    }
  }

  async function seedThreadWithTwoLiveProposals() {
    const em = rootEm()
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const thread = em.create(AssistedSellingThread, {
      id: randomUUID(),
      tenantId,
      organizationId,
      storeId: randomUUID(),
      buyerCartId: randomUUID(),
      modeSnapshot: 'rep',
      liveProposalCount: 2,
    })
    const createProposal = () =>
      em.create(AssistedSellingProposal, {
        id: randomUUID(),
        tenantId,
        organizationId,
        threadId: thread.id,
        proposalCartId: randomUUID(),
        targetCartId: randomUUID(),
        authoredByActorType: 'rep' as const,
        authoredByActorId: randomUUID(),
        status: 'published' as const,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        idempotencyKey: randomUUID(),
        requestDigest: 'digest',
      })
    const raced = createProposal()
    const stillLive = createProposal()
    em.persist([thread, raced, stillLive])
    await em.flush()
    return { thread, raced, stillLive, tenantId, organizationId }
  }

  async function readThreadCount(threadId: string): Promise<number> {
    const [row] = await rootEm().execute<Array<{ live_proposal_count: number }>>(
      'select live_proposal_count from assisted_selling_threads where id = ?',
      [threadId],
    )
    return row.live_proposal_count
  }

  async function readProposalStatus(proposalId: string): Promise<string> {
    const proposal = await rootEm().findOneOrFail(AssistedSellingProposal, { id: proposalId })
    return proposal.status
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
      entities: [AssistedSellingThread, AssistedSellingProposal],
      debug: false,
      pool: { min: 0, max: 10 },
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    await Promise.allSettled([orm?.close(true)])
    await Promise.allSettled([postgres?.stop()])
  }, 30_000)

  beforeEach(() => {
    jest.mocked(emitAssistedSellingEvent).mockClear()
  })

  it('two overlapping deliveries of one accepted proposal decrement once and emit once, leaving the other live proposal counted', async () => {
    const { thread, raced, stillLive, tenantId, organizationId } = await seedThreadWithTwoLiveProposals()
    const payload = { proposalCartId: raced.proposalCartId, tenantId, organizationId }
    const awaitPeers = createReadBarrier(2)

    await Promise.all([
      handleCartProposalAccepted(payload, subscriberContext(awaitPeers)),
      handleCartProposalAccepted(payload, subscriberContext(awaitPeers)),
    ])

    expect(await readThreadCount(thread.id)).toBe(1)
    expect(await readProposalStatus(raced.id)).toBe('accepted')
    expect(await readProposalStatus(stillLive.id)).toBe('published')
    expect(emitAssistedSellingEvent).toHaveBeenCalledTimes(1)
    expect(emitAssistedSellingEvent).toHaveBeenCalledWith('assisted_selling.proposal.accepted', {
      threadId: thread.id,
      proposalId: raced.id,
      tenantId,
      organizationId,
    })
  })

  it('an accept racing a buyer reject for the same proposal lands one terminal status, one decrement and one event', async () => {
    const { thread, raced, stillLive, tenantId, organizationId } = await seedThreadWithTwoLiveProposals()
    const awaitPeers = createReadBarrier(2)

    await Promise.all([
      handleCartProposalAccepted({ proposalCartId: raced.proposalCartId, tenantId, organizationId }, subscriberContext(awaitPeers)),
      handleCartProposalRejected({ proposalCartId: raced.proposalCartId, tenantId, organizationId, rejectedBy: 'buyer' }, subscriberContext(awaitPeers)),
    ])

    const terminalStatus = await readProposalStatus(raced.id)
    expect(['accepted', 'rejected']).toContain(terminalStatus)
    expect(await readThreadCount(thread.id)).toBe(1)
    expect(await readProposalStatus(stillLive.id)).toBe('published')
    expect(emitAssistedSellingEvent).toHaveBeenCalledTimes(1)
    expect(emitAssistedSellingEvent).toHaveBeenCalledWith(`assisted_selling.proposal.${terminalStatus}`, {
      threadId: thread.id,
      proposalId: raced.id,
      tenantId,
      organizationId,
    })
  })
})
