import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
// `checkout` and `customer_accounts` are both `packages/core` modules — the same static
// import `cart/lib/currentCartRoute.ts` (Step 2.9) and `customer_groups`'s own portal
// approval routes (Step 2.6) already use for this exact helper.
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { CheckoutSession } from '../data/entities'
import { lookupCartPeerById } from './cartPeer'
import { hashCheckoutSessionToken } from './sessionToken'

/** §9.0/C4: the ONLY place a checkout session token travels — never a path segment, never
 * a query string. */
export const CHECKOUT_SESSION_TOKEN_HEADER = 'X-Checkout-Session-Token'

export function readCheckoutSessionToken(request: Request): string | null {
  const value = request.headers.get(CHECKOUT_SESSION_TOKEN_HEADER)
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function notFoundSessionResponse(): NextResponse {
  return NextResponse.json({ error: '[internal] checkout session not found' }, { status: 404 })
}

export type CheckoutSessionScopePeek = {
  id: string
  tenantId: string
  organizationId: string
  cartId: string | null
  customerUserId: string | null
}

/**
 * Scope-free (token-hash-only) peek at the addressed session — just enough to run the
 * D-R5-33 identity-binding check BEFORE touching anything PII-bearing. Mirrors `cart/lib/
 * currentCartRoute.ts#peekCartCustomerUserId`'s own two-phase shape exactly.
 */
async function peekSessionScope(em: EntityManager, tokenHash: string): Promise<CheckoutSessionScopePeek | null> {
  const row = await em.findOne(
    CheckoutSession,
    { tokenHash },
    { fields: ['id', 'tenantId', 'organizationId', 'cartId', 'customerUserId'] as any },
  )
  if (!row) return null
  return {
    id: row.id,
    tenantId: row.tenantId,
    organizationId: row.organizationId,
    cartId: row.cartId ?? null,
    customerUserId: row.customerUserId ?? null,
  }
}

/**
 * The identity to bind D-R5-33's check against: the session's own `customerUserId` is a
 * snapshot taken when the session was CREATED — a guest cart claimed by a buyer logging in
 * afterwards (`cart`'s merge `'replace'` strategy) updates the cart's own `customer_user_id`
 * but never rewrites a session row that already pointed at it. Submit itself resolves terms
 * (on-account/quote eligibility, credit) off the LIVE cart, so binding identity to the
 * session's stale snapshot would let the bare token alone — no customer session required —
 * read PII, request quotes, or buy on_account against whichever company the cart now
 * belongs to. Falls back to the session's own value when the cart peer cannot be read (cart
 * module absent, or the cart was deleted) rather than failing the lookup outright.
 */
async function resolveSessionIdentityCustomerUserId(
  em: EntityManager,
  peek: CheckoutSessionScopePeek,
): Promise<string | null> {
  if (!peek.cartId) return peek.customerUserId
  const cart = await lookupCartPeerById(em, peek.cartId, { tenantId: peek.tenantId, organizationId: peek.organizationId })
  return cart ? cart.customerUserId : peek.customerUserId
}

export type ResolvedCurrentSessionResult =
  | { ok: true; session: CheckoutSession; scope: { tenantId: string; organizationId: string } }
  | { ok: false; response: NextResponse }

/**
 * Resolves the "current" checkout session addressed by the presented
 * `X-Checkout-Session-Token`. An unknown token, a cross-tenant token and an identity-
 * binding mismatch (D-R5-33) all collapse to the SAME `404` — never distinguishable from
 * the outside (no enumeration oracle, the same discipline `cart`'s own `/current/*` routes
 * follow).
 *
 * D-R5-33: when the resolved session carries a `customerUserId`, the caller MUST also
 * present that buyer's own customer session (`getCustomerAuthFromRequest`, cookie or
 * Bearer customer JWT) — checked BEFORE any PII-bearing read, so a stolen token on an
 * identified session can never read or write it.
 */
export async function resolveCurrentSession(
  em: EntityManager,
  request: Request,
  token: string,
): Promise<ResolvedCurrentSessionResult> {
  const tokenHash = hashCheckoutSessionToken(token)
  const peek = await peekSessionScope(em, tokenHash)
  if (!peek) return { ok: false, response: notFoundSessionResponse() }

  const identityCustomerUserId = await resolveSessionIdentityCustomerUserId(em, peek)
  if (identityCustomerUserId) {
    const auth = await getCustomerAuthFromRequest(request)
    if (!auth || auth.sub !== identityCustomerUserId) {
      return { ok: false, response: notFoundSessionResponse() }
    }
  }

  const scope = { tenantId: peek.tenantId, organizationId: peek.organizationId }
  const session = await findOneWithDecryption(
    em,
    CheckoutSession,
    { id: peek.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
  if (!session) return { ok: false, response: notFoundSessionResponse() }
  return { ok: true, session, scope }
}
