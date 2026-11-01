/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  AssistedSellingMessage,
  AssistedSellingParticipant,
  AssistedSellingProposal,
  AssistedSellingStoreSettings,
  AssistedSellingThread,
} from '../data/entities'
import { applyLiveProposalCountDelta } from '../lib/liveProposalCount'
import { handleCartMergedForAssistedSellingReauthor } from '../lib/reauthorOnMerge'
import { reauthorProposalCommand, reauthorProposalForMergeRetarget } from '../commands/proposals'
import {
  CART_PROPOSAL_CREATE_COMMAND_ID,
  CART_PROPOSAL_REJECT_COMMAND_ID,
  type CartProposalCreateCommandInput,
  type CartProposalCreateCommandResult,
  type CartProposalRejectCommandInput,
  type CartProposalRejectCommandResult,
} from '../lib/cartProposalCommands'

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
      entities: [
        AssistedSellingThread,
        AssistedSellingProposal,
        AssistedSellingParticipant,
        AssistedSellingMessage,
        AssistedSellingStoreSettings,
        User,
      ],
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

  // PR #8268 adversarial-review follow-up: the suite above only exercised
  // `applyLiveProposalCountDelta` directly and a hand-rolled `casSupersede` helper that
  // reimplements the CAS shape — neither ever called `reauthorProposalCommand`,
  // `reauthorProposalForMergeRetarget`, or `supersedeOldProposal`, so it could not have caught
  // a gap in either. These tests invoke the real exported command/subscriber functions.
  describe('reauthorProposalForMergeRetarget / supersedeOldProposal — real call sites (PR #8268 follow-up)', () => {
    type FakeContainer = { resolve: <T = unknown>(name: string) => T }

    function buildFakeContainer(overrides: Record<string, unknown>): FakeContainer {
      return {
        resolve: <T = unknown>(name: string): T => {
          if (!(name in overrides)) throw new Error(`[test] no fake registered for "${name}"`)
          return overrides[name] as T
        },
      }
    }

    function buildFakeCommandBus(): { calls: Array<{ id: string; input: unknown }>; commandBus: unknown } {
      const calls: Array<{ id: string; input: unknown }> = []
      const commandBus = {
        execute: async (commandId: string, options: { input: unknown }) => {
          calls.push({ id: commandId, input: options.input })
          if (commandId === CART_PROPOSAL_CREATE_COMMAND_ID) {
            const input = options.input as CartProposalCreateCommandInput
            const result: CartProposalCreateCommandResult = {
              proposalCartId: randomUUID(),
              tenantId: randomUUID(),
              organizationId: randomUUID(),
              lines: input.lines,
              totals: {},
              rejectedLines: [],
            }
            return { result, logEntry: null }
          }
          if (commandId === CART_PROPOSAL_REJECT_COMMAND_ID) {
            const input = options.input as CartProposalRejectCommandInput
            const result: CartProposalRejectCommandResult = {
              proposalCartId: input.proposalCartId,
              status: 'rejected',
              alreadyResolved: false,
            }
            return { result, logEntry: null }
          }
          throw new Error(`[test] unexpected command id "${commandId}"`)
        },
      }
      return { calls, commandBus }
    }

    type Scope = { tenantId: string; organizationId: string; storeId: string }

    async function seedScopedThread(scope: Scope, liveProposalCount: number): Promise<AssistedSellingThread> {
      const em = rootEm()
      const thread = em.create(AssistedSellingThread, {
        id: randomUUID(),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        storeId: scope.storeId,
        buyerCartId: randomUUID(),
        modeSnapshot: 'rep',
        liveProposalCount,
      })
      em.persist(thread)
      await em.flush()
      return thread
    }

    async function seedRepModeSettings(scope: Scope): Promise<void> {
      const em = rootEm()
      const settings = em.create(AssistedSellingStoreSettings, {
        id: randomUUID(),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        storeId: scope.storeId,
        mode: 'rep' as const,
      })
      em.persist(settings)
      await em.flush()
    }

    async function seedScopedPublishedProposal(
      scope: Scope,
      threadId: string,
      overrides: Partial<{ authoredByActorType: 'rep' | 'ai_agent'; authoredByActorId: string; targetCartId: string }> = {},
    ): Promise<AssistedSellingProposal> {
      const em = rootEm()
      const proposal = em.create(AssistedSellingProposal, {
        id: randomUUID(),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        threadId,
        proposalCartId: randomUUID(),
        targetCartId: overrides.targetCartId ?? randomUUID(),
        authoredByActorType: overrides.authoredByActorType ?? ('rep' as const),
        authoredByActorId: overrides.authoredByActorId ?? randomUUID(),
        status: 'published' as const,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        idempotencyKey: randomUUID(),
        requestDigest: 'digest',
      })
      em.persist(proposal)
      await em.flush()
      return proposal
    }

    async function readProposalRow(
      proposalId: string,
    ): Promise<{ superseded_by_proposal_id: string | null; status: string }> {
      const [row] = await rootEm().execute<Array<{ superseded_by_proposal_id: string | null; status: string }>>(
        'select superseded_by_proposal_id, status from assisted_selling_proposals where id = ?',
        [proposalId],
      )
      return row
    }

    describe('reauthorProposalForMergeRetarget races a concurrent staff reauthor (review finding #1)', () => {
      it('lets exactly one writer link a successor, with no double-live-successor and no orphaned count bump', async () => {
        const scope: Scope = { tenantId: randomUUID(), organizationId: randomUUID(), storeId: randomUUID() }
        await seedRepModeSettings(scope)
        const thread = await seedScopedThread(scope, 1)
        const originalAuthorId = randomUUID()
        const oldProposal = await seedScopedPublishedProposal(scope, thread.id, { authoredByActorId: originalAuthorId })

        const { commandBus } = buildFakeCommandBus()
        const storeContextService = { resolveForBuyer: async () => ({ assortmentScope: {} }) }
        const cartService = {
          getProposalCartLines: async () => [{ productId: randomUUID(), variantId: null, quantity: '1', configuration: null }],
        }
        const rbacService = { userHasAllFeatures: async () => true }
        const container = buildFakeContainer({ em: orm!.em, commandBus, storeContextService, cartService, rbacService })

        // Two DIFFERENT actors so the test exercises only the CAS race this fix closes,
        // never the unrelated `AssistedSellingParticipant` (thread_id, actor_type, actor_id)
        // uniqueness a same-actor race would also trip.
        const staffActorId = randomUUID()
        const staffCtx: CommandRuntimeContext = {
          container: container as unknown as CommandRuntimeContext['container'],
          auth: { sub: staffActorId, tenantId: scope.tenantId, orgId: scope.organizationId } as CommandRuntimeContext['auth'],
          organizationScope: null,
          selectedOrganizationId: scope.organizationId,
          organizationIds: [scope.organizationId],
        } as CommandRuntimeContext
        const mergeCtx: CommandRuntimeContext = {
          container: container as unknown as CommandRuntimeContext['container'],
          auth: { sub: originalAuthorId, tenantId: scope.tenantId, orgId: scope.organizationId } as CommandRuntimeContext['auth'],
          organizationScope: null,
          selectedOrganizationId: scope.organizationId,
          organizationIds: [scope.organizationId],
        } as CommandRuntimeContext

        // Each path independently resolves its OWN old-proposal read first (as the real
        // staff HTTP command and the real `cart.cart.merged` subscriber each do), mirroring
        // the two reads racing against each other before either write lands.
        const oldProposalForStaff = await rootEm().findOne(AssistedSellingProposal, { id: oldProposal.id })
        const oldProposalForMerge = await rootEm().findOne(AssistedSellingProposal, { id: oldProposal.id })
        if (!oldProposalForStaff || !oldProposalForMerge) throw new Error('[test] seeded proposal not found')

        const staffPromise = reauthorProposalCommand
          .execute(
            {
              tenantId: scope.tenantId,
              organizationIds: null,
              proposalId: oldProposalForStaff.id,
              idempotencyKey: randomUUID(),
            },
            staffCtx,
          )
          .then((result) => ({ ok: true as const, result }))
          .catch((error) => ({ ok: false as const, error }))

        const mergePromise = reauthorProposalForMergeRetarget({
          ctx: mergeCtx,
          oldProposal: oldProposalForMerge,
          thread,
          lines: [{ productId: randomUUID(), variantId: null, quantity: '1', configuration: null }],
          targetCartId: randomUUID(),
          targetCustomerId: null,
          targetCustomerUserId: null,
          idempotencyKey: `reauthor-on-merge:${oldProposal.id}`,
        })

        const [staffOutcome, mergeResult] = await Promise.all([staffPromise, mergePromise])

        // The merge-retarget path must NEVER throw on a lost race — that is exactly the gap
        // this fix closes (a throw here used to let the caller's own fallback re-supersede
        // and double-decrement an already-resolved old proposal).
        expect(mergeResult.replayed).toBe(false)

        let winnerProposalId: string
        if (staffOutcome.ok) {
          winnerProposalId = staffOutcome.result.proposalId
        } else {
          expect(isCrudHttpError(staffOutcome.error)).toBe(true)
          expect((staffOutcome.error as { status: number }).status).toBe(409)
          winnerProposalId = mergeResult.proposalId
        }

        const finalOldProposal = await readProposalRow(oldProposal.id)
        expect(finalOldProposal.status).toBe('superseded')
        expect(finalOldProposal.superseded_by_proposal_id).toBe(winnerProposalId)

        // Exactly one live successor survives: the old proposal (counted in the seeded `1`)
        // was superseded, the winner's new proposal is live, and the loser's orphaned
        // proposal had its own count bump undone — never 0 (a lost successor) or 2 (a
        // double-live-successor, the bug this fix closes).
        expect(await readThreadCount(thread.id)).toBe(1)
      }, CASE_TIMEOUT_MS)
    })

    describe('supersedeOldProposal via the cart.cart.merged subscriber (review finding #2)', () => {
      it('applies the atomic liveProposalCount delta instead of losing concurrent decrements', async () => {
        const scope: Scope = { tenantId: randomUUID(), organizationId: randomUUID(), storeId: randomUUID() }
        const proposalCount = 12
        const thread = await seedScopedThread(scope, proposalCount)

        const { commandBus } = buildFakeCommandBus()
        const container = buildFakeContainer({ em: orm!.em, commandBus })
        const subscriberCtx = { container, tenantId: scope.tenantId, organizationId: scope.organizationId, resolve: container.resolve }

        // Every candidate carries an ineligible `authoredByActorType` (§8.1's "the author no
        // longer holds the feature / deactivated / live mode refuses the actor type"
        // fallback — Release 5 only ever writes `'rep'`, so `'ai_agent'` here is simply a
        // non-`'rep'` stand-in) so `retargetOrSupersedeOneProposal` takes the
        // `supersedeOldProposal` branch directly, without needing a fake `storeContextService`/
        // `cartService` to exercise `performAuthorProposal`.
        const proposals = await Promise.all(
          Array.from({ length: proposalCount }, () =>
            seedScopedPublishedProposal(scope, thread.id, { authoredByActorType: 'ai_agent' }),
          ),
        )

        await Promise.all(
          proposals.map((proposal) =>
            handleCartMergedForAssistedSellingReauthor(
              {
                kind: 'basket',
                sourceCartId: proposal.targetCartId,
                targetCartId: randomUUID(),
                tenantId: scope.tenantId,
                organizationId: scope.organizationId,
              },
              subscriberCtx,
            ),
          ),
        )

        for (const proposal of proposals) {
          const row = await readProposalRow(proposal.id)
          expect(row.status).toBe('superseded')
        }

        // Every one of the `proposalCount` concurrent decrements must land — the old
        // in-memory `thread.liveProposalCount -= 1` read-modify-write this fix replaces would
        // lose most of them under real concurrency (mirrors the "many concurrent increments
        // and decrements" case above, through the real subscriber entrypoint this time).
        expect(await readThreadCount(thread.id)).toBe(0)
      }, CASE_TIMEOUT_MS)
    })
  })
})
