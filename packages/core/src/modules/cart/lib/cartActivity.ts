import type { EntityManager } from '@mikro-orm/postgresql'
import { Cart } from '../data/entities'

const IDENTIFIED_BUYER_EXPIRY_DAYS = 30
const GUEST_EXPIRY_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

export function resolveCartExpiresAt(now: Date, customerId: string | null): Date {
  const days = customerId ? IDENTIFIED_BUYER_EXPIRY_DAYS : GUEST_EXPIRY_DAYS
  return new Date(now.getTime() + days * DAY_MS)
}

export async function recordBasketMutationActivity(
  em: EntityManager,
  cart: Cart,
  now: Date = new Date(),
): Promise<void> {
  if (cart.kind !== 'basket') return
  const where = { id: cart.id, tenantId: cart.tenantId, organizationId: cart.organizationId, kind: 'basket' as const }

  if (cart.status === 'abandoned') {
    const expiresAt = resolveCartExpiresAt(now, cart.customerId ?? null)
    const affected = await em.nativeUpdate(
      Cart,
      { ...where, status: 'abandoned' },
      { status: 'active', resolvedAt: null, lastActivityAt: now, expiresAt, updatedAt: now },
    )
    if (affected === 0) return
    cart.status = 'active'
    cart.resolvedAt = null
    cart.lastActivityAt = now
    cart.expiresAt = expiresAt
    cart.updatedAt = now
    return
  }

  if (cart.status !== 'active') return
  const affected = await em.nativeUpdate(Cart, { ...where, status: 'active' }, { lastActivityAt: now })
  if (affected > 0) cart.lastActivityAt = now
}
