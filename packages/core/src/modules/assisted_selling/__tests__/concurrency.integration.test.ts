/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { AssistedSellingProposal, AssistedSellingThread } from '../data/entities'
import { applyLiveProposalCountDelta } from '../lib/liveProposalCount'

// Code-review findings #4/#5 (PR #8268): `live_proposal_count` used to be a plain in-memory
// `thread.liveProposalCount +/-= 1` read-modify-write on every author/withdraw/accept/reauthor
// path — a classic lost-update race. Re-authoring an already-superseded proposal could mint a
// SECOND live successor over the first. Both fixes are atomic single-statement SQL (a
// `GREATEST(... + delta, 0)` update, and a conditional `nativeUpdate` keyed on the row's own
// current state) that rely on real Postgres row-level locking to serialize concurrent writers
// correctly — a fake/mocked EntityManager cannot exercise that, so this suite runs against a
// real instance via testcontainers, gated the same way `staff/__tests__/
// fallbackUndoLocking.integration.test.ts` gates its own Postgres suite.
const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'assisted_selling_concurrency_test'
const DATABASE_USER = 'assisted_selling_concurrency'
const DATABASE_PASSWORD = 'assisted_selling_concurrency'
const CASE_TIMEOUT_MS = 30_000

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

describeWithPostgres('assisted_selling live_proposal_count / supersede races on real PostgreSQL', () => {
  let postgres: StartedTestContainer | null = null
  let orm: TestOrm | null = null

  function rootEm(): EntityManager {
    if (!orm) throw new Error('[internal] ORM is not started')
    return orm.em.fork()
  }

  async function readThreadCount(threadId: string): Promise<number> {
    const [row] = await rootEm().execute<Array<{ live_proposal_count: number }>>(
      'select live_proposal_count from assisted_selling_threads where id = ?',
      [threadId],
    )
    return row.live_proposal_count
  }

  async function seedThread(liveProposalCount = 0): Promise<AssistedSellingThread> {
    const em = rootEm()
    const thread = em.create(AssistedSellingThread, {
      id: randomUUID(),
      tenantId: randomUUID(),
      organizationId: randomUUID(),
      storeId: randomUUID(),
      buyerCartId: randomUUID(),
      modeSnapshot: 'rep',
      liveProposalCount,
    })
    em.persist(thread)
    await em.flush()
    return thread
  }

  async function seedPublishedProposal(threadId: string): Promise<AssistedSellingProposal> {
    const em = rootEm()
    const proposal = em.create(AssistedSellingProposal, {
      id: randomUUID(),
      tenantId: randomUUID(),
      organizationId: randomUUID(),
      threadId,
      proposalCartId: randomUUID(),
      targetCartId: randomUUID(),
      authoredByActorType: 'rep' as const,
      authoredByActorId: randomUUID(),
      status: 'published' as const,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      idempotencyKey: randomUUID(),
      requestDigest: 'digest',
    })
    em.persist(proposal)
    await em.flush()
    return proposal
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
      pool: { min: 0, max: 20 },
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    await Promise.allSettled([orm?.close(true)])
    await Promise.allSettled([postgres?.stop()])
  }, 30_000)

  describe('live_proposal_count atomic delta (review finding #5)', () => {
    it('never loses an update under many concurrent increments and decrements from separate connections', async () => {
      const thread = await seedThread(0)
      // Mirrors a burst of concurrent author/withdraw/accept calls against the SAME thread —
      // the exact shape the old in-memory `thread.liveProposalCount +/-= 1` lost under
      // concurrency. Net delta is +6 across 20 concurrent writers.
      const deltas = [1, 1, 1, 1, 1, -1, 1, -1, 1, 1, -1, 1, 1, -1, 1, 1, -1, 1, -1, 1]
      const expected = deltas.reduce((sum, delta) => sum + delta, 0)

      await Promise.all(deltas.map((delta) => applyLiveProposalCountDelta(rootEm(), { id: thread.id }, delta)))

      expect(await readThreadCount(thread.id)).toBe(expected)
    }, CASE_TIMEOUT_MS)

    it('floors at zero instead of going negative when concurrent decrements outrun the live count', async () => {
      const thread = await seedThread(1)

      await Promise.all([
        applyLiveProposalCountDelta(rootEm(), { id: thread.id }, -1),
        applyLiveProposalCountDelta(rootEm(), { id: thread.id }, -1),
        applyLiveProposalCountDelta(rootEm(), { id: thread.id }, -1),
      ])

      expect(await readThreadCount(thread.id)).toBe(0)
    }, CASE_TIMEOUT_MS)
  })

  describe('reauthor supersede CAS (review finding #4)', () => {
    function casSupersede(em: EntityManager, proposal: AssistedSellingProposal, successorId: string): Promise<number> {
      // The exact conditional-update shape `reauthorProposalCommand` issues: only transitions
      // the row when it is STILL exactly where the caller read it (`status: 'published'`,
      // no successor yet) — closing the race two concurrent reauthors (or a reauthor racing
      // the merge-retarget subscriber) would otherwise hit on the SAME stale proposal.
      return em.nativeUpdate(
        AssistedSellingProposal,
        { id: proposal.id, tenantId: proposal.tenantId, status: 'published', supersededByProposalId: null },
        { supersededByProposalId: successorId, status: 'superseded' as const, resolvedAt: new Date(), updatedAt: new Date() },
      )
    }

    it('lets exactly one of two concurrent reauthors link a successor onto the same stale proposal', async () => {
      const thread = await seedThread(1)
      const proposal = await seedPublishedProposal(thread.id)
      const successorA = randomUUID()
      const successorB = randomUUID()

      const [affectedA, affectedB] = await Promise.all([
        casSupersede(rootEm(), proposal, successorA),
        casSupersede(rootEm(), proposal, successorB),
      ])

      // Never both (would double-count the supersede and silently drop one successor's
      // link), never neither (a real reauthor attempt would stall forever).
      expect(affectedA + affectedB).toBe(1)

      const [row] = await rootEm().execute<Array<{ superseded_by_proposal_id: string; status: string }>>(
        'select superseded_by_proposal_id, status from assisted_selling_proposals where id = ?',
        [proposal.id],
      )
      expect(row.status).toBe('superseded')
      expect([successorA, successorB]).toContain(row.superseded_by_proposal_id)
    }, CASE_TIMEOUT_MS)

    it('refuses a second supersede once the proposal already has a successor linked', async () => {
      const thread = await seedThread(1)
      const proposal = await seedPublishedProposal(thread.id)
      const em = rootEm()

      const firstAffected = await casSupersede(em, proposal, randomUUID())
      expect(firstAffected).toBe(1)

      const secondAffected = await casSupersede(em, proposal, randomUUID())
      expect(secondAffected).toBe(0)
    }, CASE_TIMEOUT_MS)
  })
})
