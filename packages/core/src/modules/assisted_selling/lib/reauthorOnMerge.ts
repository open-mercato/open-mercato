import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { buildTrustedCommandContext } from '@open-mercato/shared/lib/commands/trusted-context'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { AssistedSellingProposal, AssistedSellingThread } from '../data/entities'
import { emitAssistedSellingEvent } from '../events'
import { resolveCartService } from './cartAccess'
import { applyLiveProposalCountDelta } from './liveProposalCount'
import {
  CART_PROPOSAL_REJECT_COMMAND_ID,
  type CartProposalRejectCommandInput,
  type CartProposalRejectCommandResult,
} from './cartProposalCommands'
import { reauthorProposalForMergeRetarget } from '../commands/proposals'

const logger = createLogger('assisted_selling')

// Step 4.4-fix (§8.1/D-R5-14) — the REAL version of Step 3.3's provisional `cart`-side
// re-author/supersede-on-merge mechanism (`cart/lib/proposalRetarget.ts`, removed by this
// Step), migrated into `assisted_selling` because only this module's own thread/proposal
// bookkeeping (`authored_by_*`, `live_proposal_count`, `superseded_by_proposal_id`) can
// finish the job properly. `cart` still never learns a conversation exists — this subscriber
// reads `cart.cart.merged`'s own scoped payload and this module's OWN local
// `AssistedSellingProposal` rows (denormalized `target_cart_id`, S4.4's own precedent) to
// find candidates, never a direct `cart.Cart`/`CartLine` entity import.

export type ReauthorOnMergeSubscriberContext = {
  resolve: <T = unknown>(name: string) => T
  container?: { resolve: <T = unknown>(name: string) => T }
  tenantId?: string | null
  organizationId?: string | null
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

type RetargetScope = { tenantId: string; organizationId: string }
type RetargetContainer = { resolve: <T = unknown>(name: string) => T }

/** Mirrors the former `cart/lib/proposalRetarget.ts#buildRuntimeContext` — a trusted
 * (request-less) context plus this DI container, never a real HTTP request. */
function buildRuntimeContext(
  container: RetargetContainer,
  trusted: ReturnType<typeof buildTrustedCommandContext>['ctx'],
): CommandRuntimeContext {
  return { ...trusted, container: container as unknown as CommandRuntimeContext['container'] } as CommandRuntimeContext
}

/**
 * Supersede-only: marks the old proposal `superseded` (when still `published`), decrements
 * the thread's `live_proposal_count` synchronously, rejects the proposal cart with
 * `rejectedBy: 'author'` (so the terminal-state subscriber on `cart.proposal.rejected`
 * skips it — `lib/terminalStateSubscriber.ts`'s own header comment), and emits
 * `.proposal.superseded`. Used by every fallback branch below — never re-author.
 */
async function supersedeOldProposal(params: {
  em: EntityManager
  container: RetargetContainer
  commandBus: CommandBus
  proposal: AssistedSellingProposal
  thread: AssistedSellingThread | null
  scope: RetargetScope
  reason: string
}): Promise<void> {
  const { em, container, commandBus, proposal, thread, scope, reason } = params
  if (proposal.status !== 'published') return

  // Atomic claim: only the writer that flips `published -> superseded` applies the
  // `live_proposal_count` decrement, so a fallback that runs after a half-finished re-author
  // (which already decremented) can never decrement a second time.
  let claimed = 0
  await withAtomicFlush(
    em,
    [
      async () => {
        const now = new Date()
        claimed = await em.nativeUpdate(
          AssistedSellingProposal,
          { id: proposal.id, tenantId: proposal.tenantId, status: 'published', supersededByProposalId: null },
          { status: 'superseded' as const, resolvedAt: now, updatedAt: now },
        )
      },
      async () => {
        if (claimed > 0 && thread) await applyLiveProposalCountDelta(em, thread, -1)
      },
    ],
    { transaction: true, label: 'assisted_selling.proposal.supersede_on_merge' },
  )
  if (claimed > 0) {
    proposal.status = 'superseded'
    proposal.resolvedAt = new Date()
  }

  const { ctx: systemCtx } = buildTrustedCommandContext({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    actorType: 'system',
    reason,
  })
  await commandBus.execute<CartProposalRejectCommandInput, CartProposalRejectCommandResult>(
    CART_PROPOSAL_REJECT_COMMAND_ID,
    {
      input: {
        proposalCartId: proposal.proposalCartId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        rejectedBy: 'author',
      },
      ctx: buildRuntimeContext(container, systemCtx),
    },
  )

  if (claimed > 0) {
    await emitAssistedSellingEvent('assisted_selling.proposal.superseded', {
      threadId: proposal.threadId,
      proposalId: proposal.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
  }
}

/**
 * Review finding M7 (§8.1, §5.1): a login merge used to repoint nothing but live
 * proposals — the thread's own `buyer_cart_id` (the comment on `AssistedSellingThread.
 * buyerCartId` already promises this subscriber owns it) stayed pointed at the now-merged-
 * away source cart forever. Every buyer-facing route resolves the thread by its CURRENT
 * cart id (§5.1), so the buyer's own `/thread`, `/thread/events` and `/thread/messages`
 * 404'd the instant they logged in, while staff authoring (and this subscriber's own
 * proposal candidates query) kept targeting a cart nobody could read from any more.
 *
 * §5.1's collision policy applies when the merged-into cart already has its own OPEN
 * thread (the unique `(tenant_id, buyer_cart_id) WHERE status = 'open'` index would
 * otherwise be violated by repointing into it): the source thread CLOSES instead of
 * repointing, never touching `buyer_cart_id`, and the caller supersedes — never
 * re-authors — its live proposals, since there is no live target basket left for them to
 * address. Reuses the already-shipped `assisted_selling.thread.closed` event (the idle
 * sweeper's own emission) with `reason: 'merge_collision'` so the console's existing
 * thread-closed handling surfaces it on BOTH sides without a new event id.
 */
export type MergeThreadMigrationOutcome =
  | { kind: 'migrated'; thread: AssistedSellingThread }
  | { kind: 'collision'; sourceThread: AssistedSellingThread; targetThread: AssistedSellingThread }
  | { kind: 'no_thread' }

async function migrateOrCloseThreadOnMerge(params: {
  em: EntityManager
  scope: RetargetScope
  sourceCartId: string
  targetCartId: string
  targetCustomerId: string | null
  targetCustomerUserId: string | null
}): Promise<MergeThreadMigrationOutcome> {
  const { em, scope, sourceCartId, targetCartId, targetCustomerId, targetCustomerUserId } = params
  const sourceThread = await em.findOne(AssistedSellingThread, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    buyerCartId: sourceCartId,
    status: 'open',
    deletedAt: null,
  })
  if (!sourceThread) return { kind: 'no_thread' }

  const collidingThread = await em.findOne(AssistedSellingThread, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    buyerCartId: targetCartId,
    status: 'open',
    deletedAt: null,
    id: { $ne: sourceThread.id },
  })

  if (collidingThread) {
    const now = new Date()
    await withAtomicFlush(
      em,
      [
        async () => {
          sourceThread.status = 'closed'
          sourceThread.closedAt = now
        },
      ],
      { transaction: true, label: 'assisted_selling.thread.close_on_merge_collision' },
    )
    try {
      await emitAssistedSellingEvent('assisted_selling.thread.closed', {
        threadId: sourceThread.id,
        tenantId: sourceThread.tenantId,
        organizationId: sourceThread.organizationId,
        reason: 'merge_collision',
        absorbedByThreadId: collidingThread.id,
      })
    } catch (error) {
      logger.warn('[assisted_selling:reauthor-on-merge] failed to emit thread.closed on merge collision', {
        threadId: sourceThread.id,
        collidingThreadId: collidingThread.id,
        error: error instanceof Error ? error.message : error,
      })
    }
    return { kind: 'collision', sourceThread, targetThread: collidingThread }
  }

  await withAtomicFlush(
    em,
    [
      async () => {
        sourceThread.buyerCartId = targetCartId
        if (targetCustomerId) sourceThread.customerId = targetCustomerId
        if (targetCustomerUserId) sourceThread.customerUserId = targetCustomerUserId
      },
    ],
    { transaction: true, label: 'assisted_selling.thread.migrate_on_merge' },
  )
  return { kind: 'migrated', thread: sourceThread }
}

const REAUTHOR_REQUIRED_FEATURES = ['assisted_selling.proposals.author', 'cart.proposals.author']

/**
 * The stored `authoredByActorId` is only a historical record. Before the merge automation
 * publishes a repriced offer on that principal's behalf, reload a LIVE user of this tenant
 * and re-verify (wildcard-aware, via `rbacService`) BOTH author features in the target
 * organization — the private reauthor helper bypasses the command-level feature check.
 */
async function isAuthorStillEligible(
  em: EntityManager,
  container: RetargetContainer,
  scope: RetargetScope,
  actorId: string,
): Promise<boolean> {
  try {
    const user = await findOneWithDecryption(em, User, { id: actorId, tenantId: scope.tenantId, deletedAt: null }, undefined, scope)
    if (!user) return false
    const rbac = container.resolve<RbacService | null>('rbacService')
    if (!rbac) return false
    return await rbac.userHasAllFeatures(actorId, REAUTHOR_REQUIRED_FEATURES, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
  } catch (error) {
    logger.warn('[assisted_selling:reauthor-on-merge] author eligibility check failed, treating as ineligible', {
      actorId,
      error: error instanceof Error ? error.message : error,
    })
    return false
  }
}

async function retargetOrSupersedeOneProposal(params: {
  em: EntityManager
  container: RetargetContainer
  commandBus: CommandBus
  proposal: AssistedSellingProposal
  newTargetCartId: string
  targetCustomerId: string | null
  targetCustomerUserId: string | null
  scope: RetargetScope
}): Promise<void> {
  const { em, container, commandBus, proposal, newTargetCartId, targetCustomerId, targetCustomerUserId, scope } = params

  const thread = await em.findOne(AssistedSellingThread, {
    id: proposal.threadId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })

  // D-R5-14's fallback: "the author no longer holds `cart.proposals.author`... is
  // deactivated, or the live mode refuses the author's actor type." Release 5 only ever
  // writes `authoredByActorType: 'rep'` (S10 — `ai_agent` has no Phase-3 caller yet), so an
  // ineligible actor type here is defensive, future-proofing against Phase 3 rather than a
  // reachable Release 5 case. `authoredByActorId` is a non-nullable column, but the check
  // stays explicit for the same reason the original cart-side mechanism kept it.
  if (proposal.authoredByActorType !== 'rep' || !proposal.authoredByActorId) {
    await supersedeOldProposal({
      em,
      container,
      commandBus,
      proposal,
      thread,
      scope,
      reason: 'assisted_selling.proposal.supersede:ineligible_author_type',
    })
    return
  }

  const cartService = resolveCartService(container)
  const lines = await cartService.getProposalCartLines({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    proposalCartId: proposal.proposalCartId,
  })
  if (lines.length === 0) {
    // Should not happen — `cart.proposal.create` always refuses a zero-line proposal — but
    // supersede is still the correct terminal state for a stray, lineless row.
    await supersedeOldProposal({
      em,
      container,
      commandBus,
      proposal,
      thread,
      scope,
      reason: 'assisted_selling.proposal.supersede:no_lines',
    })
    return
  }

  if (!thread) {
    logger.warn('[assisted_selling:reauthor-on-merge] thread not found for a live proposal, superseding', {
      proposalId: proposal.id,
      threadId: proposal.threadId,
    })
    await supersedeOldProposal({
      em,
      container,
      commandBus,
      proposal,
      thread: null,
      scope,
      reason: 'assisted_selling.proposal.supersede:thread_not_found',
    })
    return
  }

  if (!(await isAuthorStillEligible(em, container, scope, proposal.authoredByActorId))) {
    await supersedeOldProposal({
      em,
      container,
      commandBus,
      proposal,
      thread,
      scope,
      reason: 'assisted_selling.proposal.supersede:author_ineligible',
    })
    return
  }

  const { ctx: authorCtx } = buildTrustedCommandContext({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    actorType: 'user',
    actorId: proposal.authoredByActorId,
    reason: 'assisted_selling.reauthor_on_merge',
  })
  const runtimeCtx = buildRuntimeContext(container, authorCtx)

  try {
    await reauthorProposalForMergeRetarget({
      ctx: runtimeCtx,
      oldProposal: proposal,
      thread,
      lines,
      targetCartId: newTargetCartId,
      targetCustomerId,
      targetCustomerUserId,
      // §8.1: "the idempotency key is derived from the old proposal's id, so a redelivered
      // `cart.cart.merged` re-authors nothing twice" — `performAuthorProposal`'s own
      // idempotency lookup (keyed per thread) replays this call's own result on redelivery
      // instead of creating a second proposal.
      idempotencyKey: `reauthor-on-merge:${proposal.id}`,
    })
  } catch (err) {
    // D-R5-14's fallback: the author lost `cart.proposals.author`, is deactivated, the live
    // mode now refuses the actor type (§6.3 step 0, re-run in full by `performAuthorProposal`),
    // or `resolveForBuyer`/`cart.proposal.create` refused for any other reason. Any failure
    // here means "do not re-author" — supersede instead, never re-throw.
    logger.warn('[assisted_selling:reauthor-on-merge] re-author failed, superseding instead', {
      proposalId: proposal.id,
      newTargetCartId,
      error: err instanceof Error ? err.message : err,
    })
    await supersedeOldProposal({
      em,
      container,
      commandBus,
      proposal,
      thread,
      scope,
      reason: 'assisted_selling.proposal.supersede:reauthor_failed',
    })
  }
  // On success, `reauthorProposalForMergeRetarget` already wrote the new proposal and, when
  // not a replay, the old row's own supersede bookkeeping — nothing left to do here.
}

/**
 * `cart.cart.merged` handler (persistent). §8.1: "The `cart.cart.merged` subscriber —
 * `kind = 'basket'` only." The OTHER `cart.cart.merged` emission (`cart.proposal.accept`'s
 * own acceptance merge, `cart/commands/merge.ts`'s `kind: 'proposal'` branch) must never
 * reach this handler — its `sourceCartId` is the just-accepted proposal's own id, never a
 * basket this module could have a live proposal pointed at.
 *
 * Candidates are this module's OWN `AssistedSellingProposal` rows with `status: 'published'`
 * and `target_cart_id = sourceCartId` — the denormalized column Step 4.4's own entity
 * comment says exists "so the console can list by target without reaching into `cart`" —
 * never a `cart.Cart`/`CartLine` scan (the shape Step 3.3's provisional version needed,
 * because `cart` itself holds no `authored_by_*`/thread columns).
 *
 * Idempotent on redelivery: `performAuthorProposal`'s own idempotency lookup (keyed on the
 * old proposal's id, above) replays rather than re-creates on a second `cart.cart.merged`
 * delivery for the same proposal; a proposal this handler already fully resolved (superseded
 * or, via `reauthorProposalForMergeRetarget`, superseded-and-replaced) is no longer `status:
 * 'published'`, so the candidate query below finds nothing on redelivery.
 */
export async function handleCartMergedForAssistedSellingReauthor(
  payload: unknown,
  ctx: ReauthorOnMergeSubscriberContext,
): Promise<void> {
  const record = toRecord(payload)
  const kind = readString(record, 'kind')
  if (kind !== 'basket') return

  const sourceCartId = readString(record, 'sourceCartId')
  const targetCartId = readString(record, 'targetCartId')
  const tenantId = readString(record, 'tenantId') ?? ctx.tenantId ?? null
  const organizationId = readString(record, 'organizationId') ?? ctx.organizationId ?? null

  if (!sourceCartId || !targetCartId || !tenantId || !organizationId) {
    logger.debug('[assisted_selling:reauthor-on-merge] skipped incomplete payload', {
      hasSourceCartId: Boolean(sourceCartId),
      hasTargetCartId: Boolean(targetCartId),
      hasTenantId: Boolean(tenantId),
      hasOrganizationId: Boolean(organizationId),
    })
    return
  }

  const targetCustomerId = readString(record, 'customerId')
  const targetCustomerUserId = readString(record, 'customerUserId')
  const container = ctx.container ?? { resolve: ctx.resolve }
  const scope: RetargetScope = { tenantId, organizationId }

  try {
    const em = container.resolve<EntityManager>('em').fork()

    // M7 fix: repoint (or, on a §5.1 target-thread collision, close) the buyer's own
    // conversation BEFORE touching any live proposal — see `migrateOrCloseThreadOnMerge`'s
    // own header comment.
    const migrationOutcome = await migrateOrCloseThreadOnMerge({
      em,
      scope,
      sourceCartId,
      targetCartId,
      targetCustomerId,
      targetCustomerUserId,
    })

    const liveProposals = await em.find(AssistedSellingProposal, {
      tenantId,
      organizationId,
      targetCartId: sourceCartId,
      status: 'published' as const,
      deletedAt: null,
    })
    if (liveProposals.length === 0) return

    const commandBus = container.resolve<CommandBus>('commandBus')

    if (migrationOutcome.kind === 'collision') {
      // §5.1 collision policy: the source thread already closed above, never re-pointed —
      // there is no live target basket left for these proposals to address, so every one of
      // them is superseded, never re-authored.
      for (const proposal of liveProposals) {
        await supersedeOldProposal({
          em,
          container,
          commandBus,
          proposal,
          thread: migrationOutcome.sourceThread,
          scope,
          reason: 'assisted_selling.proposal.supersede:merge_collision',
        })
      }
      return
    }

    for (const proposal of liveProposals) {
      await retargetOrSupersedeOneProposal({
        em,
        container,
        commandBus,
        proposal,
        newTargetCartId: targetCartId,
        targetCustomerId,
        targetCustomerUserId,
        scope,
      })
    }
  } catch (err) {
    logger.warn('[assisted_selling:reauthor-on-merge] failed', {
      sourceCartId,
      targetCartId,
      error: err instanceof Error ? err.message : err,
    })
    getTelemetryRuntime()?.reportError(err, { module: 'assisted_selling', code: 'assisted_selling.reauthor_on_merge_failed' })
    // Review finding: this outer catch wraps the candidate-lookup query and the per-proposal
    // loop — a transient failure here (lock timeout, dropped connection) must retry via this
    // `persistent: true` subscriber's redelivery, not silently leave a live proposal pointed
    // at a merged-away basket forever. The INNER try/catch in
    // `retargetOrSupersedeOneProposal` is a deliberate, documented fallback (reauthor failed
    // -> supersede instead) and is unrelated to this one.
    throw err
  }
}
