import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { buildTrustedCommandContext } from '@open-mercato/shared/lib/commands/trusted-context'
import { AssistedSellingProposal, AssistedSellingThread } from '../data/entities'
import { emitAssistedSellingEvent } from '../events'
import { resolveCartService } from './cartAccess'
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
  const wasLive = proposal.status === 'published'
  if (!wasLive) return

  proposal.status = 'superseded'
  proposal.resolvedAt = new Date()
  em.persist(proposal)
  if (thread) {
    thread.liveProposalCount = Math.max(0, thread.liveProposalCount - 1)
    em.persist(thread)
  }
  await em.flush()

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

  await emitAssistedSellingEvent('assisted_selling.proposal.superseded', {
    threadId: proposal.threadId,
    proposalId: proposal.id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
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
    const liveProposals = await em.find(AssistedSellingProposal, {
      tenantId,
      organizationId,
      targetCartId: sourceCartId,
      status: 'published' as const,
      deletedAt: null,
    })
    if (liveProposals.length === 0) return

    const commandBus = container.resolve<CommandBus>('commandBus')
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
  }
}
