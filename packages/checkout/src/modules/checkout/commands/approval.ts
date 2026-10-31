import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CheckoutSession } from '../data/entities'
import { assertValidCheckoutSessionTransition } from '../lib/session-status-machine'
import { writeSessionEvent } from '../lib/sessionEvents'
import { emitCheckoutEvent } from '../events'
import { CHECKOUT_SESSION_RESOURCE_KIND, assertCartPeerAvailable } from './session'

// Release 5, Step 5.2 (C11, §8.2 step 1, §9's own route table: `POST /sessions/current/
// request-approval`). "The cart is the canonical approval subject (D-R5-3). Checkout
// creates no approval and stores no approval id" (§8.2's own opening line) — this command
// is a thin adapter: it delegates the ENTIRE approval decision to `cart.approval.request`
// (Step 3.2's own command, the only place an approval is ever created, §9a.4) via the
// command bus, a plain object input carrying no compile-time dependency on `cart` — the
// SAME cross-module shape `lib/payLinkCartSeed.ts` already established for its own
// `cart.create`/`cart.lines.add` calls — then moves the SESSION to `awaiting_approval` on
// success. `cart.approval.request`'s own `loadMutableCart` already refuses a LOCKED cart
// with `423 cart_locked` (K5) — by construction this route is only ever reached from a
// cart that is NOT locked (submit's own precondition 7/§7.1 runs BEFORE `cart.lock`,
// §8.1), so this command never calls `cart.unlock` itself; there is nothing to unlock.

export type CheckoutSessionRequestApprovalCommandInput = {
  sessionId: string
  tenantId: string
  organizationId: string
}

export type CheckoutSessionRequestApprovalResult = {
  session: CheckoutSession
  approvalId: string
  created: boolean
}

type CartApprovalRequestResult = { approvalId: string; created: boolean }

const requestApprovalCommand: CommandHandler<
  CheckoutSessionRequestApprovalCommandInput,
  CheckoutSessionRequestApprovalResult
> = {
  id: 'checkout.session.requestApproval',
  isUndoable: false,
  async execute(input, ctx) {
    assertCartPeerAvailable(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const session = await findOneWithDecryption(em, CheckoutSession, { id: input.sessionId, ...scope }, undefined, scope)
    if (!session) throw new CrudHttpError(404, { error: '[internal] checkout session not found' })
    // §4.1's own adjacency table: `open -> awaiting_approval` and the same-state no-op (an
    // already-`awaiting_approval` session re-requesting, e.g. a double-submitted button
    // click — `cart.approval.request` itself is idempotent "while pending", §9a.4 step 3)
    // are the only two legal starting points; anything else (submitting, a terminal state)
    // is `409 session_not_open`, the SAME code every sibling session command in this file
    // set already uses for "not open" refusals.
    if (session.status !== 'open' && session.status !== 'awaiting_approval') {
      throw new CrudHttpError(409, { error: '[internal] checkout session is not open', code: 'session_not_open' })
    }
    if (!session.cartId) {
      throw new CrudHttpError(404, { error: '[internal] checkout session has no cart' })
    }

    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: CHECKOUT_SESSION_RESOURCE_KIND,
      resourceId: session.id,
      current: session.updatedAt ?? null,
      request: ctx.request ?? null,
    })

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    // Cross-module FK-id call, never a static import of `cart`'s command module. Any
    // refusal (`409 approval_requires_identified_buyer` for a guest, `409
    // approval_not_required` below/at the threshold, `503 approval_service_unavailable`
    // without `customer_groups`) propagates UNCHANGED — `handleCheckoutRouteError` already
    // surfaces a raw `CrudHttpError` by its own status/body, and this command makes no
    // session-state change before this call returns successfully.
    const { result } = await commandBus.execute<Record<string, unknown>, CartApprovalRequestResult>(
      'cart.approval.request',
      {
        input: {
          cartId: session.cartId,
          tenantId: session.tenantId,
          organizationId: session.organizationId,
        },
        ctx,
      },
    )

    // The CAS `WHERE status = <from>` lives in the optimistic-lock guard above (the
    // caller's own `updatedAt` header); this assertion is its human-readable sibling, the
    // same division of labor `session-status-machine.ts`'s own doc comment describes.
    assertValidCheckoutSessionTransition(session.status, 'awaiting_approval')
    session.status = 'awaiting_approval'
    await em.flush()

    await writeSessionEvent(em, {
      tenantId: session.tenantId,
      organizationId: session.organizationId,
      sessionId: session.id,
      kind: 'approval_state',
      actor: 'buyer',
      payload: { approvalId: result.approvalId, outcome: 'requested' },
    })

    // §8.2 step 1: "Checkout emits `checkout.session.approval_requested` as a state
    // signal; notifications come only from `customer_groups` (D-R5-32)."
    await emitCheckoutEvent('checkout.session.approval_requested', {
      sessionId: session.id,
      tenantId: session.tenantId,
      organizationId: session.organizationId,
      cartId: session.cartId,
      approvalId: result.approvalId,
    }).catch(() => undefined)

    return { session, approvalId: result.approvalId, created: result.created }
  },
}

registerCommand(requestApprovalCommand)

export { requestApprovalCommand }
