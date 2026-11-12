import { randomUUID } from 'node:crypto'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandBus, CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError, isUniqueViolation, notFound } from '@open-mercato/shared/lib/crud/errors'
import { ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { EffectiveAssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import type { StoreContextService } from '@open-mercato/core/modules/ecommerce/lib/storeContextService'
import { AssistedSellingMessage, AssistedSellingProposal, AssistedSellingThread } from '../data/entities'
import { resolveEffectiveAssistedSellingSettings } from '../lib/settings'
import { resolveCartService } from '../lib/cartAccess'
import { resolveOrBuildRepParticipant } from '../lib/participants'
import { computeAssistedSellingRequestDigest } from '../lib/requestDigest'
import {
  CART_PROPOSAL_CREATE_COMMAND_ID,
  CART_PROPOSAL_REJECT_COMMAND_ID,
  type CartProposalCreateCommandInput,
  type CartProposalCreateCommandResult,
  type CartProposalCreateLine,
  type CartProposalCreateRejectedLine,
  type CartProposalRejectCommandInput,
  type CartProposalRejectCommandResult,
} from '../lib/cartProposalCommands'
import { emitAssistedSellingEvent } from '../events'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { applyLiveProposalCountDelta } from '../lib/liveProposalCount'
import {
  enforceAssistedSellingOptimisticLock,
  requireAssistedSellingFeatures,
  ASSISTED_SELLING_PROPOSAL_RESOURCE_KIND,
} from './shared'

// Step 4.4 (§6.3, §6.4, S19, S22, S23). Wraps `cart.proposal.create`/`.reject` (Step 3.3) by
// command id, never a static cross-module import (`lib/cartProposalCommands.ts`'s own header
// comment). `performAuthorProposal` is the ONE place §6.3's full authoring sequence lives;
// both `assisted_selling.proposal.author` (fresh authoring) and `.reauthor` (§6.4's "Runs
// §6.3 in full for the caller") call it — no second, drifting copy of the sequence.

const logger = createLogger('assisted_selling').child({ component: 'proposals' })

function tryResolveStoreContextService(container: { resolve: <T = unknown>(name: string) => T }): StoreContextService | null {
  try {
    return container.resolve<StoreContextService>('storeContextService') ?? null
  } catch {
    return null
  }
}

function toIso(value: Date): string {
  return value.toISOString()
}

type ProposalAuthorScope = { tenantId: string; organizationIds: string[] | null }

export type AssistedSellingProposalAuthorResponse = {
  proposalId: string
  proposalCartId: string
  messageId: string
  expiresAt: string
  rejectedLines: CartProposalCreateRejectedLine[]
  replayed: boolean
}

async function resolveOpenThreadForCaller(
  em: EntityManager,
  scope: ProposalAuthorScope,
  threadId: string,
): Promise<AssistedSellingThread> {
  const where: Record<string, unknown> = { id: threadId, tenantId: scope.tenantId, status: 'open', deletedAt: null }
  if (Array.isArray(scope.organizationIds)) {
    if (scope.organizationIds.length === 0) throw notFound('[internal] thread not found')
    where.organizationId = { $in: scope.organizationIds }
  }
  const thread = await em.findOne(AssistedSellingThread, where)
  if (!thread) throw notFound('[internal] thread not found')
  return thread
}

async function resolveProposalForCaller(
  em: EntityManager,
  scope: ProposalAuthorScope,
  proposalId: string,
): Promise<AssistedSellingProposal> {
  const where: Record<string, unknown> = { id: proposalId, tenantId: scope.tenantId, deletedAt: null }
  if (Array.isArray(scope.organizationIds)) {
    if (scope.organizationIds.length === 0) throw notFound('[internal] proposal not found')
    where.organizationId = { $in: scope.organizationIds }
  }
  const proposal = await em.findOne(AssistedSellingProposal, where)
  if (!proposal) throw notFound('[internal] proposal not found')
  return proposal
}

async function findProposalByIdempotencyKey(
  em: EntityManager,
  scope: { tenantId: string; threadId: string },
  idempotencyKey: string,
): Promise<AssistedSellingProposal | null> {
  return em.findOne(AssistedSellingProposal, {
    tenantId: scope.tenantId,
    threadId: scope.threadId,
    idempotencyKey,
    deletedAt: null,
  })
}

function buildReplayResponse(proposal: AssistedSellingProposal): AssistedSellingProposalAuthorResponse {
  const snapshot = (proposal.responseSnapshot ?? {}) as { rejectedLines?: CartProposalCreateRejectedLine[]; messageId?: string }
  return {
    proposalId: proposal.id,
    proposalCartId: proposal.proposalCartId,
    messageId: snapshot.messageId ?? '',
    expiresAt: toIso(proposal.expiresAt),
    rejectedLines: snapshot.rejectedLines ?? [],
    replayed: true,
  }
}

async function rejectProposalCartBestEffort(
  ctx: CommandRuntimeContext,
  proposalCartId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  try {
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    await commandBus.execute<CartProposalRejectCommandInput, CartProposalRejectCommandResult>(
      CART_PROPOSAL_REJECT_COMMAND_ID,
      { input: { proposalCartId, tenantId: scope.tenantId, organizationId: scope.organizationId, rejectedBy: 'author' }, ctx },
    )
  } catch (error) {
    logger.error('[assisted_selling:proposal] failed to reject an orphaned proposal cart', { proposalCartId, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'assisted_selling', code: 'assisted_selling.proposal_cart_compensation_failed' })
  }
}

/**
 * Atomically (ONE transaction) links `successorProposalId` onto the old proposal — only when
 * the old row is still exactly where the caller read it (compare-and-swap) — and, for a
 * previously live proposal, applies the `live_proposal_count` decrement. Returns `false`
 * when the CAS lost; nothing is written in that case.
 */
async function linkSuccessorAtomically(params: {
  em: EntityManager
  oldProposal: { id: string; tenantId: string; threadId: string }
  originalOldStatus: AssistedSellingProposal['status']
  wasLive: boolean
  successorProposalId: string
}): Promise<boolean> {
  const { em, oldProposal, originalOldStatus, wasLive, successorProposalId } = params
  let affected = 0
  await withAtomicFlush(
    em,
    [
      async () => {
        const now = new Date()
        affected = await em.nativeUpdate(
          AssistedSellingProposal,
          { id: oldProposal.id, tenantId: oldProposal.tenantId, status: originalOldStatus, supersededByProposalId: null },
          {
            supersededByProposalId: successorProposalId,
            updatedAt: now,
            ...(wasLive ? { status: 'superseded' as const, resolvedAt: now } : {}),
          },
        )
      },
      async () => {
        if (affected > 0 && wasLive) await applyLiveProposalCountDelta(em, { id: oldProposal.threadId }, -1)
      },
    ],
    { transaction: true, label: 'assisted_selling.proposal.link_successor' },
  )
  return affected > 0
}

/**
 * A replayed re-author means the successor proposal already committed, but the process may
 * have died before the old row was linked to it. Re-runs the idempotent compare-and-swap link
 * (a no-op when the old row already points at a successor) and, only when this call won it,
 * finishes the cleanup the first attempt never reached.
 */
async function completeReplayedSupersede(params: {
  ctx: CommandRuntimeContext
  em: EntityManager
  oldProposal: AssistedSellingProposal
  successorProposalId: string
}): Promise<void> {
  const { ctx, em, oldProposal, successorProposalId } = params
  if (oldProposal.supersededByProposalId || oldProposal.id === successorProposalId) return
  if (oldProposal.status === 'accepted') return
  const wasLive = oldProposal.status === 'published'
  const linked = await linkSuccessorAtomically({
    em,
    oldProposal,
    originalOldStatus: oldProposal.status,
    wasLive,
    successorProposalId,
  })
  if (!linked || !wasLive) return
  await rejectProposalCartBestEffort(ctx, oldProposal.proposalCartId, {
    tenantId: oldProposal.tenantId,
    organizationId: oldProposal.organizationId,
  })
  await emitAssistedSellingEvent('assisted_selling.proposal.superseded', {
    threadId: oldProposal.threadId,
    proposalId: oldProposal.id,
    tenantId: oldProposal.tenantId,
    organizationId: oldProposal.organizationId,
  })
}

/**
 * Cleans up a just-authored successor that must not stay live (lost CAS, or a failure while
 * linking it): rejects its proposal cart and atomically withdraws its local row, undoing its
 * own `live_proposal_count` bump exactly once.
 */
async function discardUnlinkedSuccessor(params: {
  ctx: CommandRuntimeContext
  em: EntityManager
  successor: { proposalId: string; proposalCartId: string }
  scope: { tenantId: string; organizationId: string; threadId: string }
}): Promise<void> {
  const { ctx, em, successor, scope } = params
  await rejectProposalCartBestEffort(ctx, successor.proposalCartId, scope)
  let claimed = 0
  await withAtomicFlush(
    em,
    [
      async () => {
        const now = new Date()
        claimed = await em.nativeUpdate(
          AssistedSellingProposal,
          { id: successor.proposalId, tenantId: scope.tenantId, status: 'published' },
          { status: 'withdrawn' as const, resolvedAt: now, updatedAt: now },
        )
      },
      async () => {
        if (claimed > 0) await applyLiveProposalCountDelta(em, { id: scope.threadId }, -1)
      },
    ],
    { transaction: true, label: 'assisted_selling.proposal.discard_successor' },
  )
}

/**
 * The old proposal's cart was already rejected but no successor could be authored: mirror
 * that on the local row (`withdrawn`, count decremented once) so no `published` row points
 * at a dead cart and no live count leaks.
 */
async function withdrawRejectedOldProposal(params: {
  em: EntityManager
  oldProposal: { id: string; tenantId: string; threadId: string }
}): Promise<void> {
  const { em, oldProposal } = params
  let claimed = 0
  await withAtomicFlush(
    em,
    [
      async () => {
        const now = new Date()
        claimed = await em.nativeUpdate(
          AssistedSellingProposal,
          { id: oldProposal.id, tenantId: oldProposal.tenantId, status: 'published', supersededByProposalId: null },
          { status: 'withdrawn' as const, resolvedAt: now, updatedAt: now },
        )
      },
      async () => {
        if (claimed > 0) await applyLiveProposalCountDelta(em, { id: oldProposal.threadId }, -1)
      },
    ],
    { transaction: true, label: 'assisted_selling.proposal.withdraw_rejected_old' },
  )
}

/**
 * §6.3's full authoring sequence against an ALREADY-RESOLVED thread, shared by
 * `assisted_selling.proposal.author` and `.reauthor`. Resolves the live mode (step 0),
 * `resolveForBuyer` (step 2, fail closed), calls `cart.proposal.create` (step 3), reports
 * rejected lines (step 4) and writes the local `AssistedSellingProposal` + opening/note
 * `AssistedSellingMessage` (steps 5-7), then emits `.proposal.published` (step 8).
 */
async function performAuthorProposal(params: {
  ctx: CommandRuntimeContext
  thread: AssistedSellingThread
  lines: CartProposalCreateLine[]
  note: string | undefined
  idempotencyKey: string
  requestDigestPayload: unknown
  authorActorId: string
  /** Step 4.4-fix (§8.1): the re-author-on-merge subscriber (`lib/reauthorOnMerge.ts`)
   * authors against the cart a login merge just absorbed the thread's own basket INTO —
   * never `thread.buyerCartId`, which still names the now-`merged`-away basket (re-pointing
   * it is a later Step's own §5.1 scope, out of this Step's bounds). Every existing caller
   * (`authorProposalCommand`, `reauthorProposalCommand`) omits this, so `thread.buyerCartId`
   * stays the target exactly as before. */
  targetCartId?: string
  /** Paired with `targetCartId` — the merged-into basket's OWN identity, resolved
   * server-side at `resolveForBuyer` time (§8.1: "the buyer's group has just become
   * known"). `thread.customerId`/`.customerUserId` are stale on a merge (the thread itself
   * is not re-pointed by this Step), so the merge subscriber supplies the event's own
   * values instead of the thread's. */
  targetBuyerIdentity?: { customerId: string | null; customerUserId: string | null }
}): Promise<AssistedSellingProposalAuthorResponse> {
  const { ctx, thread, lines, note, idempotencyKey, requestDigestPayload, authorActorId } = params
  const targetCartId = params.targetCartId ?? thread.buyerCartId
  const targetBuyerIdentity = params.targetBuyerIdentity ?? {
    customerId: thread.customerId ?? null,
    customerUserId: thread.customerUserId ?? null,
  }
  const scope = { tenantId: thread.tenantId }
  const requestDigest = computeAssistedSellingRequestDigest(requestDigestPayload)

  const preCheckEm = (ctx.container.resolve('em') as EntityManager).fork()
  const existing = await findProposalByIdempotencyKey(preCheckEm, { tenantId: thread.tenantId, threadId: thread.id }, idempotencyKey)
  if (existing) {
    if (existing.requestDigest !== requestDigest) {
      throw new CrudHttpError(409, { error: '[internal] idempotency_key_mismatch', code: 'idempotency_key_mismatch' })
    }
    return buildReplayResponse(existing)
  }

  // §6.3 step 0: the live mode check. Release 5's only reachable value besides `off` is
  // `rep` (S10) — the authoring actor type is always `'rep'` for the same reason.
  const settingsEm = (ctx.container.resolve('em') as EntityManager).fork()
  const settings = await resolveEffectiveAssistedSellingSettings(settingsEm, {
    tenantId: thread.tenantId,
    organizationId: thread.organizationId,
    storeId: thread.storeId,
  })
  if (settings.mode !== 'rep') {
    throw new CrudHttpError(409, { error: '[internal] assisted_selling_unavailable', code: 'assisted_selling_unavailable' })
  }
  if (lines.length > settings.maxProposalLines) {
    throw new CrudHttpError(400, { error: '[internal] too_many_proposal_lines', code: 'too_many_proposal_lines' })
  }

  // §6.3 step 2: resolve the TARGET buyer's scope server-side. Fail closed (S1) — this
  // module ALWAYS passes `storeId` (the thread's own), so a missing/failing peer or a
  // missing `assortmentScope` is treated identically: refuse, create nothing.
  const storeContextService = tryResolveStoreContextService(ctx.container)
  if (!storeContextService?.resolveForBuyer) {
    throw new CrudHttpError(503, { error: '[internal] assortment_scope_unavailable', code: 'assortment_scope_unavailable' })
  }
  let assortmentScope: EffectiveAssortmentScope
  try {
    const resolved = await storeContextService.resolveForBuyer({
      tenantId: thread.tenantId,
      organizationId: thread.organizationId,
      storeId: thread.storeId,
      customerUserId: targetBuyerIdentity.customerUserId,
      customerId: targetBuyerIdentity.customerId,
    })
    if (resolved.assortmentScope === undefined) {
      throw new CrudHttpError(503, { error: '[internal] assortment_scope_unavailable', code: 'assortment_scope_unavailable' })
    }
    assortmentScope = resolved.assortmentScope
  } catch (error) {
    if (error instanceof CrudHttpError) throw error
    throw new CrudHttpError(503, { error: '[internal] assortment_scope_unavailable', code: 'assortment_scope_unavailable' })
  }

  // §6.3 step 3: `cart.proposal.create` by command id — never a static cross-module import.
  const commandBus = ctx.container.resolve('commandBus') as CommandBus
  const createInput: CartProposalCreateCommandInput = {
    targetCartId,
    lines,
    ttlSeconds: settings.proposalTtlSeconds,
    routeContext: { assortmentScope },
  }

  const { result: created } = await commandBus.execute<CartProposalCreateCommandInput, CartProposalCreateCommandResult>(
    CART_PROPOSAL_CREATE_COMMAND_ID,
    { input: createInput, ctx },
  )

  // §6.3 step 4: every line rejected -> no proposal created, nothing to persist locally.
  // `cart.proposal.create` itself already refused with `422 proposal_empty` in that case, so
  // this call only reaches here when at least one line survived.

  const proposalId = randomUUID()
  const messageId = randomUUID()
  const now = new Date()
  const compensationScope = { tenantId: thread.tenantId, organizationId: thread.organizationId }

  const em = (ctx.container.resolve('em') as EntityManager).fork()
  let proposal: AssistedSellingProposal
  let message: AssistedSellingMessage
  try {
    // §6.3 step 5: `authored_by_actor_*` comes off `ctx.auth`, never the request body. The
    // opening/note message's own author is the SAME rep, resolved (or created) as a real
    // `AssistedSellingParticipant` row, never a bare `User.id`.
    const { participant } = await resolveOrBuildRepParticipant(
      em,
      { tenantId: thread.tenantId, organizationId: thread.organizationId, threadId: thread.id },
      authorActorId,
    )
    proposal = em.create(AssistedSellingProposal, {
      id: proposalId,
      tenantId: thread.tenantId,
      organizationId: thread.organizationId,
      threadId: thread.id,
      proposalCartId: created.proposalCartId,
      targetCartId,
      authoredByActorType: 'rep' as const,
      authoredByActorId: authorActorId,
      status: 'published' as const,
      publishedAt: now,
      expiresAt: new Date(now.getTime() + settings.proposalTtlSeconds * 1000),
      idempotencyKey,
      requestDigest,
      responseSnapshot: { messageId, rejectedLines: created.rejectedLines },
      createdAt: now,
      updatedAt: now,
    })
    message = em.create(AssistedSellingMessage, {
      id: messageId,
      tenantId: thread.tenantId,
      organizationId: thread.organizationId,
      threadId: thread.id,
      participantId: participant.id,
      body: note?.trim() ?? '',
      bodyFormat: 'text' as const,
      proposalId,
      sentAt: now,
      createdAt: now,
      updatedAt: now,
    })
    thread.lastActivityAt = now

    await withAtomicFlush(
      em,
      [
        async () => {
          em.persist(participant)
          em.persist(proposal)
          em.persist(message)
          em.persist(thread)
        },
        async () => {
          await applyLiveProposalCountDelta(em, thread, 1)
        },
      ],
      { transaction: true, label: 'assisted_selling.proposal.author' },
    )
  } catch (error) {
    // `cart.proposal.create` already committed in its own transaction, so ANY failure here
    // (unique violation, flush error, participant resolution) would leave a buyer-acceptable
    // proposal cart with no local record. Compensate by rejecting it for every failure kind.
    await rejectProposalCartBestEffort(ctx, created.proposalCartId, compensationScope)
    if (isUniqueViolation(error)) {
      // S23's concurrent-race branch: lost the `(tenant_id, thread_id, idempotency_key)` race
      // to another request carrying the SAME key — answer as a replay of the WINNER's row.
      const retryEm = (ctx.container.resolve('em') as EntityManager).fork()
      const winner = await findProposalByIdempotencyKey(retryEm, { tenantId: thread.tenantId, threadId: thread.id }, idempotencyKey)
      if (winner) {
        if (winner.requestDigest !== requestDigest) {
          throw new CrudHttpError(409, { error: '[internal] idempotency_key_mismatch', code: 'idempotency_key_mismatch' })
        }
        return buildReplayResponse(winner)
      }
    }
    throw error
  }

  await emitAssistedSellingEvent('assisted_selling.proposal.published', {
    threadId: thread.id,
    proposalId: proposal.id,
    tenantId: thread.tenantId,
    organizationId: thread.organizationId,
  })
  await emitAssistedSellingEvent('assisted_selling.message.posted', {
    threadId: thread.id,
    messageId: message.id,
    tenantId: thread.tenantId,
    organizationId: thread.organizationId,
  })

  return {
    proposalId: proposal.id,
    proposalCartId: proposal.proposalCartId,
    messageId: message.id,
    expiresAt: toIso(proposal.expiresAt),
    rejectedLines: created.rejectedLines,
    replayed: false,
  }
}

// ---------------------------------------------------------------------------
// assisted_selling.proposal.author — POST /threads/:id/proposals (§6.3)
// ---------------------------------------------------------------------------

export type AssistedSellingProposalAuthorInput = {
  tenantId: string
  organizationIds: string[] | null
  threadId: string
  lines: CartProposalCreateLine[]
  note?: string
  idempotencyKey: string
}

const authorProposalCommand: CommandHandler<AssistedSellingProposalAuthorInput, AssistedSellingProposalAuthorResponse> = {
  id: 'assisted_selling.proposal.author',
  isUndoable: false,
  async execute(input, ctx: CommandRuntimeContext) {
    ensureTenantScope(ctx, input.tenantId)
    await requireAssistedSellingFeatures(ctx, ['assisted_selling.proposals.author', 'cart.proposals.author'])
    const authorActorId = ctx.auth?.sub
    if (!authorActorId) throw notFound('[internal] no authenticated principal to author this proposal as')

    const threadEm = (ctx.container.resolve('em') as EntityManager).fork()
    const thread = await resolveOpenThreadForCaller(threadEm, { tenantId: input.tenantId, organizationIds: input.organizationIds }, input.threadId)

    return performAuthorProposal({
      ctx,
      thread,
      lines: input.lines,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
      requestDigestPayload: { lines: input.lines, note: input.note ?? null },
      authorActorId,
    })
  },
}

// ---------------------------------------------------------------------------
// assisted_selling.proposal.withdraw — POST /proposals/:id/withdraw (§6.4)
// ---------------------------------------------------------------------------

export type AssistedSellingProposalWithdrawInput = {
  tenantId: string
  organizationIds: string[] | null
  proposalId: string
  updatedAt?: string
}

export type AssistedSellingProposalWithdrawResult = {
  proposalId: string
  status: string
}

const withdrawProposalCommand: CommandHandler<AssistedSellingProposalWithdrawInput, AssistedSellingProposalWithdrawResult> = {
  id: 'assisted_selling.proposal.withdraw',
  isUndoable: false,
  async execute(input, ctx: CommandRuntimeContext) {
    ensureTenantScope(ctx, input.tenantId)
    await requireAssistedSellingFeatures(ctx, ['assisted_selling.proposals.author', 'cart.proposals.author'])

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const proposal = await resolveProposalForCaller(em, { tenantId: input.tenantId, organizationIds: input.organizationIds }, input.proposalId)
    await enforceAssistedSellingOptimisticLock(ctx, proposal, ASSISTED_SELLING_PROPOSAL_RESOURCE_KIND, input.updatedAt ?? null)

    // §6.4: "Only a `published` proposal can be withdrawn; any other status answers `409
    // proposal_not_live`."
    if (proposal.status !== 'published') {
      throw new CrudHttpError(409, { error: '[internal] proposal_not_live', code: 'proposal_not_live', status: proposal.status })
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    // §6.4: withdraw MUST invoke `cart.proposal.reject` in the same logical action, before
    // the local status is written — never only the local row.
    const { result: rejectResult } = await commandBus.execute<CartProposalRejectCommandInput, CartProposalRejectCommandResult>(
      CART_PROPOSAL_REJECT_COMMAND_ID,
      { input: { proposalCartId: proposal.proposalCartId, tenantId: proposal.tenantId, organizationId: proposal.organizationId, rejectedBy: 'author' }, ctx },
    )
    // #8268 review Major 3: the nested cart-level call above is itself a proper CAS
    // (`cart/commands/proposal.ts#rejectProposalCommand`, per-proposal advisory lock +
    // conditional update) — exactly one concurrent caller on the same proposal ever gets
    // `alreadyResolved: false`. The OLD code discarded this result and unconditionally wrote
    // `withdrawn` + decremented regardless: two concurrent withdrawals could both decrement
    // (one of them twice-over), and if a concurrent accept won instead (`status: 'merged'`),
    // this command clobbered the local row to `withdrawn` over an order that actually
    // received the proposal — leaving `cart-proposal-accepted.ts`'s own terminal-state
    // subscriber to find the row already non-`published` and silently skip finalizing it
    // (`lib/terminalStateSubscriber.ts`'s own idempotency guard). Never proceed past a
    // `alreadyResolved: true` result; matches `reauthorProposalCommand`'s own convention for
    // the identical nested-reject call just below in this file.
    if (rejectResult.alreadyResolved) {
      throw new CrudHttpError(409, {
        error: '[internal] proposal_already_resolved',
        code: 'proposal_already_resolved',
        status: rejectResult.status,
      })
    }

    const now = new Date()
    // CAS the local transition too (defense in depth, same pattern as the sibling
    // `withdrawRejectedOldProposal` helper below) — only the caller that actually flips
    // `published -> withdrawn` owns the decrement.
    let claimed = 0
    await withAtomicFlush(
      em,
      [
        async () => {
          claimed = await em.nativeUpdate(
            AssistedSellingProposal,
            { id: proposal.id, tenantId: proposal.tenantId, organizationId: proposal.organizationId, status: 'published' },
            { status: 'withdrawn' as const, resolvedAt: now, updatedAt: now },
          )
          if (claimed > 0) {
            proposal.status = 'withdrawn'
            proposal.resolvedAt = now
          }
        },
        async () => {
          // Step 4.4-fix (§6.4/§6.6): an author-initiated ending owns its own
          // `live_proposal_count` decrement, synchronously, in THIS transaction — never left
          // to the async terminal-state subscriber on `cart.proposal.rejected`
          // (`lib/terminalStateSubscriber.ts`), which skips every `rejectedBy: 'author'`
          // payload for exactly this reason. The decrement is an atomic SQL update, not an
          // in-memory read-modify-write — it only needs the thread's id, so this never has to
          // load the row. Only the winner of the CAS above decrements.
          if (claimed > 0) await applyLiveProposalCountDelta(em, { id: proposal.threadId }, -1)
        },
      ],
      { transaction: true, label: 'assisted_selling.proposal.withdraw' },
    )

    await emitAssistedSellingEvent('assisted_selling.proposal.withdrawn', {
      threadId: proposal.threadId,
      proposalId: proposal.id,
      tenantId: proposal.tenantId,
      organizationId: proposal.organizationId,
    })

    return { proposalId: proposal.id, status: proposal.status }
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('assisted_selling.audit.proposal.withdraw', 'Withdraw proposal'),
      resourceKind: ASSISTED_SELLING_PROPOSAL_RESOURCE_KIND,
      resourceId: result.proposalId,
    }
  },
}

// ---------------------------------------------------------------------------
// assisted_selling.proposal.reauthor — POST /proposals/:id/reauthor (§6.4)
// ---------------------------------------------------------------------------

export type AssistedSellingProposalReauthorInput = {
  tenantId: string
  organizationIds: string[] | null
  proposalId: string
  idempotencyKey: string
  note?: string
}

const reauthorProposalCommand: CommandHandler<AssistedSellingProposalReauthorInput, AssistedSellingProposalAuthorResponse> = {
  id: 'assisted_selling.proposal.reauthor',
  isUndoable: false,
  async execute(input, ctx: CommandRuntimeContext) {
    ensureTenantScope(ctx, input.tenantId)
    await requireAssistedSellingFeatures(ctx, ['assisted_selling.proposals.author', 'cart.proposals.author'])
    const authorActorId = ctx.auth?.sub
    if (!authorActorId) throw notFound('[internal] no authenticated principal to re-author this proposal as')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const oldProposal = await resolveProposalForCaller(em, { tenantId: input.tenantId, organizationIds: input.organizationIds }, input.proposalId)

    // The thread may legitimately be `closed` by the time a stale proposal is re-authored
    // (§8.1's own "the proposal was superseded with no successor" fallback can run long
    // after the conversation itself closed) — read it directly rather than through
    // `resolveOpenThreadForCaller`, which only accepts `status: 'open'`.
    const thread = await em.findOne(AssistedSellingThread, {
      id: oldProposal.threadId,
      tenantId: input.tenantId,
      organizationId: oldProposal.organizationId,
      deletedAt: null,
    })
    if (!thread) throw notFound('[internal] thread not found')

    // Replay lookup FIRST: a retried successful re-author finds its old proposal already
    // `superseded` (with a successor), which must answer as a replay, never `409`.
    const priorResult = await findProposalByIdempotencyKey(
      em,
      { tenantId: thread.tenantId, threadId: thread.id },
      input.idempotencyKey,
    )
    if (priorResult) {
      if (priorResult.requestDigest !== computeAssistedSellingRequestDigest({ reauthorOf: oldProposal.id, note: input.note ?? null })) {
        throw new CrudHttpError(409, { error: '[internal] idempotency_key_mismatch', code: 'idempotency_key_mismatch' })
      }
      await completeReplayedSupersede({ ctx, em, oldProposal, successorProposalId: priorResult.id })
      return buildReplayResponse(priorResult)
    }

    // §6.4: "An `accepted` proposal answers `409 proposal_already_accepted`: its lines are
    // in the buyer's basket and cannot come back out through this module (D-R5-25)."
    if (oldProposal.status === 'accepted') {
      throw new CrudHttpError(409, { error: '[internal] proposal_already_accepted', code: 'proposal_already_accepted' })
    }
    // Review finding: the console offers "repropose" on an already-superseded proposal
    // too (`backend/.../threads/[id]/page.tsx`'s own `['expired','rejected','withdrawn',
    // 'superseded'].includes(...)` check) — but re-authoring one that ALREADY has a
    // successor would mint a second live proposal descending from the same original,
    // double-counting `live_proposal_count` and overwriting the first successor's link.
    // Refuse outright; the console should let the user repropose the EXISTING successor.
    if (oldProposal.supersededByProposalId) {
      throw new CrudHttpError(409, { error: '[internal] proposal_already_superseded', code: 'proposal_already_superseded' })
    }


    const cartService = resolveCartService(ctx.container)
    const oldLines = await cartService.getProposalCartLines({
      tenantId: oldProposal.tenantId,
      organizationId: oldProposal.organizationId,
      proposalCartId: oldProposal.proposalCartId,
    })
    const lines: CartProposalCreateLine[] = oldLines.map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      quantity: line.quantity,
      configuration: line.configuration,
    }))

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const wasLive = oldProposal.status === 'published'
    const originalOldStatus = oldProposal.status

    // §6.4/review finding: reject the OLD proposal's cart FIRST — the same order
    // `withdrawProposalCommand` uses — so a concurrent buyer accept (which resolves that
    // cart out from under this call) is caught here, before any new proposal is authored
    // over it. `cart.proposal.reject` is itself idempotent: `alreadyResolved: true` means
    // something else (an accept, or a racing withdraw/reauthor) already resolved it.
    if (wasLive) {
      const { result: rejectResult } = await commandBus.execute<CartProposalRejectCommandInput, CartProposalRejectCommandResult>(
        CART_PROPOSAL_REJECT_COMMAND_ID,
        { input: { proposalCartId: oldProposal.proposalCartId, tenantId: oldProposal.tenantId, organizationId: oldProposal.organizationId, rejectedBy: 'author' }, ctx },
      )
      if (rejectResult.alreadyResolved) {
        throw new CrudHttpError(409, {
          error: '[internal] proposal_already_resolved',
          code: 'proposal_already_resolved',
          status: rejectResult.status,
        })
      }
    }

    let result: AssistedSellingProposalAuthorResponse
    try {
      result = await performAuthorProposal({
        ctx,
        thread,
        lines,
        note: input.note,
        idempotencyKey: input.idempotencyKey,
        requestDigestPayload: { reauthorOf: oldProposal.id, note: input.note ?? null },
        authorActorId,
      })
    } catch (error) {
      if (wasLive) {
        await withdrawRejectedOldProposal({ em, oldProposal }).catch((compensationError) => {
          logger.error('[assisted_selling:proposal] failed to withdraw a rejected proposal after a failed re-author', {
            proposalId: oldProposal.id,
            err: compensationError,
          })
          getTelemetryRuntime()?.reportError(compensationError, {
            module: 'assisted_selling',
            code: 'assisted_selling.proposal_withdraw_compensation_failed',
          })
        })
      }
      throw error
    }

    if (result.replayed) {
      await completeReplayedSupersede({ ctx, em, oldProposal, successorProposalId: result.proposalId })
    } else {
      let linked: boolean
      try {
        linked = await linkSuccessorAtomically({
          em,
          oldProposal,
          originalOldStatus,
          wasLive,
          successorProposalId: result.proposalId,
        })
      } catch (error) {
        await discardUnlinkedSuccessor({
          ctx,
          em,
          successor: result,
          scope: { tenantId: oldProposal.tenantId, organizationId: oldProposal.organizationId, threadId: thread.id },
        })
        throw error
      }
      if (!linked) {
        await discardUnlinkedSuccessor({
          ctx,
          em,
          successor: result,
          scope: { tenantId: oldProposal.tenantId, organizationId: oldProposal.organizationId, threadId: thread.id },
        })
        throw new CrudHttpError(409, { error: '[internal] proposal_already_superseded', code: 'proposal_already_superseded' })
      }
      if (wasLive) {
        await emitAssistedSellingEvent('assisted_selling.proposal.superseded', {
          threadId: oldProposal.threadId,
          proposalId: oldProposal.id,
          tenantId: oldProposal.tenantId,
          organizationId: oldProposal.organizationId,
        })
      }
    }

    return result
  },
  buildLog: async ({ input, result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('assisted_selling.audit.proposal.reauthor', 'Re-author proposal'),
      resourceKind: ASSISTED_SELLING_PROPOSAL_RESOURCE_KIND,
      resourceId: input.proposalId,
      changes: { newProposalId: result.proposalId },
    }
  },
}

// ---------------------------------------------------------------------------
// Step 4.4-fix (§8.1/D-R5-14) — re-author-on-merge, called from this module's OWN
// `cart.cart.merged` subscriber (`lib/reauthorOnMerge.ts`), never from `cart`. Migrated in
// from Step 3.3's PROVISIONAL `cart`-side mechanism (`cart/lib/proposalRetarget.ts`, removed
// by this Step — see that file's own former header comment and NOTIFY.md's Step 3.3/4.4-fix
// entries), because the supersede/live-count bookkeeping only this module's richer local rows
// (`authored_by_*`, `thread_id`, `live_proposal_count`) can do properly now exists here.
//
// Reuses `performAuthorProposal` — the SAME §6.3 sequence `.author`/`.reauthor` already run
// (mode check, `resolveForBuyer`, `cart.proposal.create`) — rather than re-implementing it a
// third time, via the `targetCartId`/`targetBuyerIdentity` overrides that function gained for
// exactly this caller. Unlike Step 3.3's cart-side version (which skipped both the mode check
// and `resolveForBuyer` entirely — it had neither to call), this re-runs §6.3 "in full"
// exactly as §8.1 specifies.
// ---------------------------------------------------------------------------

export async function reauthorProposalForMergeRetarget(params: {
  ctx: CommandRuntimeContext
  oldProposal: AssistedSellingProposal
  thread: AssistedSellingThread
  lines: CartProposalCreateLine[]
  targetCartId: string
  targetCustomerId: string | null
  targetCustomerUserId: string | null
  idempotencyKey: string
}): Promise<AssistedSellingProposalAuthorResponse> {
  const { ctx, oldProposal, thread, lines, targetCartId, targetCustomerId, targetCustomerUserId, idempotencyKey } = params

  // Review finding: captured BEFORE `performAuthorProposal` runs, same as `.reauthor`'s own
  // HTTP command does — the CAS below keys off this snapshot, not whatever the row happens to
  // read as after the new proposal's own (possibly slow) authoring sequence completes.
  const wasLive = oldProposal.status === 'published'
  const originalOldStatus = oldProposal.status

  const result = await performAuthorProposal({
    ctx,
    thread,
    lines,
    note: undefined,
    idempotencyKey,
    requestDigestPayload: { reauthorOnMergeOf: oldProposal.id, targetCartId },
    authorActorId: oldProposal.authoredByActorId,
    targetCartId,
    targetBuyerIdentity: { customerId: targetCustomerId, customerUserId: targetCustomerUserId },
  })

  if (result.replayed) {
    const replayEm = (ctx.container.resolve('em') as EntityManager).fork()
    await completeReplayedSupersede({ ctx, em: replayEm, oldProposal, successorProposalId: result.proposalId })
    return result
  }

  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const successorScope = { tenantId: oldProposal.tenantId, organizationId: oldProposal.organizationId, threadId: thread.id }
  let linked: boolean
  try {
    linked = await linkSuccessorAtomically({
      em,
      oldProposal,
      originalOldStatus,
      wasLive,
      successorProposalId: result.proposalId,
    })
  } catch (error) {
    await discardUnlinkedSuccessor({ ctx, em, successor: result, scope: successorScope })
    throw error
  }
  if (!linked) {
    // Lost the CAS: a concurrent writer already linked its own successor. The winner owns
    // the old row's transition and its count decrement — only OUR successor is cleaned up.
    await discardUnlinkedSuccessor({ ctx, em, successor: result, scope: successorScope })
    return result
  }
  if (wasLive) {
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    await commandBus.execute<CartProposalRejectCommandInput, CartProposalRejectCommandResult>(
      CART_PROPOSAL_REJECT_COMMAND_ID,
      {
        input: {
          proposalCartId: oldProposal.proposalCartId,
          tenantId: oldProposal.tenantId,
          organizationId: oldProposal.organizationId,
          rejectedBy: 'author',
        },
        ctx,
      },
    )
    await emitAssistedSellingEvent('assisted_selling.proposal.superseded', {
      threadId: oldProposal.threadId,
      proposalId: oldProposal.id,
      tenantId: oldProposal.tenantId,
      organizationId: oldProposal.organizationId,
    })
  }

  return result
}

registerCommand(authorProposalCommand)
registerCommand(withdrawProposalCommand)
registerCommand(reauthorProposalCommand)

export { authorProposalCommand, withdrawProposalCommand, reauthorProposalCommand }
