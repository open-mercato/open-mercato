import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { AssistedSellingProposal, AssistedSellingThread } from '../data/entities'
import type { AssistedSellingProposalStatus } from '../data/entities'
import { emitAssistedSellingEvent } from '../events'
import type { AssistedSellingEventId } from '../events'

const logger = createLogger('assisted_selling')

// Step 4.4-fix (§6.6). "Acceptance, rejection and expiry are all decided inside `cart`...
// this module learns of them the only way it can... a subscriber." One handler factory
// shared by three thin per-event files (`subscribers/cart-proposal-accepted.ts`, `.rejected`,
// `.expired`), mirroring `cart/subscribers/approval-*.ts`'s own one-event-per-file / shared
// handler-factory convention.

export type TerminalStateSubscriberContext = {
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

export type TerminalStateHandlerOptions = {
  targetStatus: AssistedSellingProposalStatus
  emitEventId: AssistedSellingEventId
  subscriberId: string
  /**
   * `.rejected` only (S set by `cart/commands/proposal.ts#rejectProposalCommand`'s own
   * `rejectedBy: 'buyer' | 'author'` field). Every author-initiated ending of a proposal —
   * withdraw, a reauthor's supersede branch, and the merge-retarget subscriber's own
   * supersede branch (`commands/proposals.ts#reauthorProposalForMergeRetarget`) — already
   * decrements `AssistedSellingThread.live_proposal_count` ITSELF, synchronously, in the
   * SAME local transaction that writes `withdrawn`/`superseded`, because `cart.proposal.
   * create`'s `.rejected` emit runs inline (no `persistent: true` on that specific `cart`-
   * side emit) but the two author-initiated call sites order their own local write
   * differently relative to that inline dispatch (withdraw rejects THEN writes locally;
   * reauthor/merge-retarget write locally THEN reject) — reading "is the proposal still
   * `published`" at the moment this subscriber fires would therefore sometimes decrement
   * and sometimes silently miss it, depending on which caller fired it. `rejectedBy` sidesteps
   * that ordering entirely: it is the one signal on the payload that is independent of local
   * write order, so this handler skips every `'author'` payload unconditionally and only ever
   * owns the buyer-initiated decrement.
   */
  skipWhenRejectedByAuthor?: boolean
}

/**
 * Idempotency: `proposal.status !== 'published'` is treated as "already resolved" and the
 * whole handler no-ops — no status write, no `resolved_at` touch, no decrement. A proposal
 * is never resolved twice (§6.6's own text), and this also implements the `.rejected` row's
 * "unless already withdrawn or superseded" rule for any buyer-initiated rejection that
 * somehow arrives after an author-initiated one already landed.
 */
export function createCartProposalTerminalHandler(options: TerminalStateHandlerOptions) {
  const { targetStatus, emitEventId, subscriberId, skipWhenRejectedByAuthor } = options

  return async function handle(payload: unknown, ctx: TerminalStateSubscriberContext): Promise<void> {
    const record = toRecord(payload)

    if (skipWhenRejectedByAuthor && readString(record, 'rejectedBy') === 'author') return

    const proposalCartId = readString(record, 'proposalCartId')
    const tenantId = readString(record, 'tenantId') ?? ctx.tenantId ?? null
    const organizationId = readString(record, 'organizationId') ?? ctx.organizationId ?? null

    if (!proposalCartId || !tenantId || !organizationId) {
      logger.debug(`[${subscriberId}] skipped incomplete payload`, {
        hasProposalCartId: Boolean(proposalCartId),
        hasTenantId: Boolean(tenantId),
        hasOrganizationId: Boolean(organizationId),
      })
      return
    }

    const container = ctx.container ?? { resolve: ctx.resolve }
    try {
      const em = container.resolve<EntityManager>('em').fork()
      const proposal = await em.findOne(AssistedSellingProposal, {
        tenantId,
        organizationId,
        proposalCartId,
        deletedAt: null,
      })
      if (!proposal) return
      if (proposal.status !== 'published') return

      const now = new Date()
      proposal.status = targetStatus
      proposal.resolvedAt = now
      if (targetStatus === 'accepted') {
        const mergeLogId = readString(record, 'mergeLogId')
        if (mergeLogId) proposal.mergeLogId = mergeLogId
      }
      em.persist(proposal)

      const thread = await em.findOne(AssistedSellingThread, {
        id: proposal.threadId,
        tenantId: proposal.tenantId,
        organizationId: proposal.organizationId,
        deletedAt: null,
      })
      if (thread) {
        thread.liveProposalCount = Math.max(0, thread.liveProposalCount - 1)
        em.persist(thread)
      }

      await em.flush()

      await emitAssistedSellingEvent(emitEventId, {
        threadId: proposal.threadId,
        proposalId: proposal.id,
        tenantId: proposal.tenantId,
        organizationId: proposal.organizationId,
      })
    } catch (err) {
      logger.warn(`[${subscriberId}] failed to resolve proposal`, {
        proposalCartId,
        targetStatus,
        error: err instanceof Error ? err.message : err,
      })
    }
  }
}
