import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { AssistedSellingThread } from '../data/entities'
import { anonymizeAssistedSellingRepParticipants, eraseAssistedSellingThread } from './retention'

const logger = createLogger('assisted_selling')

// Step 4.5 (§5.10, S7). One handler per erasure trigger, mirroring `lib/terminalStateSubscriber.ts`'s
// own `(payload, ctx)` shape and `toRecord`/`readString` payload-reading convention exactly —
// three thin `subscribers/*.ts` files register these by event id.

export type AssistedSellingErasureSubscriberContext = {
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

function resolveContainer(ctx: AssistedSellingErasureSubscriberContext): { resolve: <T = unknown>(name: string) => T } {
  return ctx.container ?? { resolve: ctx.resolve }
}

/**
 * `cart.cart.purged` (§5.10's "Basket purge" row). `cart`'s own emitter payload is
 * `{ cartId, kind, proposedToCartId }` (`cart/lib/sweepers.ts`) — only `kind: 'basket'`
 * erases anything here; a purged proposal cart erases nothing in this module (§5.10, S15).
 */
export async function handleCartPurgedErasure(payload: unknown, ctx: AssistedSellingErasureSubscriberContext): Promise<void> {
  const record = toRecord(payload)
  const kind = readString(record, 'kind')
  if (kind !== 'basket') return

  const cartId = readString(record, 'cartId')
  const tenantId = readString(record, 'tenantId') ?? ctx.tenantId ?? null
  const organizationId = readString(record, 'organizationId') ?? ctx.organizationId ?? null
  if (!cartId || !tenantId || !organizationId) {
    logger.debug('[assisted_selling:cart-purged-erasure] skipped incomplete payload', {
      hasCartId: Boolean(cartId),
      hasTenantId: Boolean(tenantId),
      hasOrganizationId: Boolean(organizationId),
    })
    return
  }

  try {
    const em = resolveContainer(ctx).resolve<EntityManager>('em').fork()
    const thread = await em.findOne(AssistedSellingThread, { tenantId, organizationId, buyerCartId: cartId, deletedAt: null })
    if (!thread) return
    await eraseAssistedSellingThread(em, { tenantId, organizationId }, thread.id)
  } catch (err) {
    logger.warn('[assisted_selling:cart-purged-erasure] failed to erase thread', {
      cartId,
      error: err instanceof Error ? err.message : err,
    })
  }
}

/**
 * `customer_accounts.user.deleted` (§5.10's "Buyer deletion" row). Payload is
 * `{ id, email, tenantId, organizationId }` (`customer_accounts/api/.../users/[id].ts`) — the
 * deleted `CustomerUser.id` arrives as `id`, not `userId` (distinct from `auth.user.deleted`
 * below). Erases EVERY thread with that `customer_user_id`, open or closed.
 */
export async function handleCustomerAccountsUserDeletedErasure(
  payload: unknown,
  ctx: AssistedSellingErasureSubscriberContext,
): Promise<void> {
  const record = toRecord(payload)
  const customerUserId = readString(record, 'id')
  const tenantId = readString(record, 'tenantId') ?? ctx.tenantId ?? null
  const organizationId = readString(record, 'organizationId') ?? ctx.organizationId ?? null
  if (!customerUserId || !tenantId) {
    logger.debug('[assisted_selling:customer-user-deleted-erasure] skipped incomplete payload', {
      hasCustomerUserId: Boolean(customerUserId),
      hasTenantId: Boolean(tenantId),
    })
    return
  }

  try {
    const em = resolveContainer(ctx).resolve<EntityManager>('em').fork()
    const where: Record<string, unknown> = { tenantId, customerUserId, deletedAt: null }
    if (organizationId) where.organizationId = organizationId
    const threads = await em.find(AssistedSellingThread, where)
    for (const thread of threads) {
      await eraseAssistedSellingThread(em, { tenantId: thread.tenantId, organizationId: thread.organizationId }, thread.id)
    }
  } catch (err) {
    logger.warn('[assisted_selling:customer-user-deleted-erasure] failed to erase threads', {
      customerUserId,
      error: err instanceof Error ? err.message : err,
    })
  }
}

/**
 * `auth.user.deleted` (§5.10's "Staff deletion" row). Payload is
 * `{ userId, tenantId?, organizationId? }` (`communication_channels/subscribers/
 * user-deleted-cascade.ts`'s own documented shape) — anonymizes every `rep` participant row
 * for that user, never erasing the thread itself.
 */
export async function handleAuthUserDeletedErasure(payload: unknown, ctx: AssistedSellingErasureSubscriberContext): Promise<void> {
  const record = toRecord(payload)
  const userId = readString(record, 'userId')
  const tenantId = readString(record, 'tenantId') ?? ctx.tenantId ?? null
  const organizationId = readString(record, 'organizationId') ?? ctx.organizationId ?? null
  if (!userId || !tenantId) {
    logger.debug('[assisted_selling:auth-user-deleted-erasure] skipped incomplete payload', {
      hasUserId: Boolean(userId),
      hasTenantId: Boolean(tenantId),
    })
    return
  }

  try {
    const em = resolveContainer(ctx).resolve<EntityManager>('em').fork()
    await anonymizeAssistedSellingRepParticipants(em, { tenantId, organizationId }, userId)
  } catch (err) {
    logger.warn('[assisted_selling:auth-user-deleted-erasure] failed to anonymize participants', {
      userId,
      error: err instanceof Error ? err.message : err,
    })
  }
}
