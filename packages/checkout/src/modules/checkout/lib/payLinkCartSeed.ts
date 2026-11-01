import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { buildTrustedCommandContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
// `checkout` and `customer_accounts` are both `packages/core` modules — same precedent
// `commands/session.ts` already documents for this exact import.
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import type { StoreContextService } from '@open-mercato/core/modules/ecommerce/lib/storeContextService'
import { CheckoutLink, CheckoutLinkCartTemplate } from '../data/entities'
import { CHECKOUT_PASSWORD_COOKIE } from './constants'
import { isCheckoutLinkPublic, verifyCheckoutAccessToken } from './utils'
import { tryResolve } from './tryResolve'

/**
 * Release 5, Step 3.5 (D-R5-19, checkout §4.3/B.2). Seeds a `pay_link` cart from a
 * `checkoutType: 'simple_checkout'` link's own template lines, through the ONE trusted,
 * request-less context `buildTrustedCommandContext` builds — never from request input,
 * never a direct `CartLine`/`Cart` entity write. `cart.create` and the line adds both run
 * on the real command bus (`cart §6a.4 rev 10`), exactly like any other caller would.
 *
 * Deliberately duplicates the tiny password-cookie read `api/helpers.ts#
 * readCheckoutAccessCookie` already has — a command module does not import from `api/`
 * (the dependency runs the other way), same small-scope-duplication precedent
 * `lib/reprice.ts` documents for its own borrowed helpers.
 */

const DEFAULT_LINK_CART_LOCALE = 'en'

function readAccessCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie') ?? ''
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${CHECKOUT_PASSWORD_COOKIE}=([^;]+)`))
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

export type SeededPayLinkCart = {
  cartId: string
  tenantId: string
  organizationId: string
  storeId: null
  channel: 'pay_link'
  currencyCode: string
  locale: string
  customerId: string | null
  customerUserId: string | null
}

/**
 * Phase A's own public-availability checks (active, not expired — no separate `expiresAt`
 * column exists on `CheckoutLink` today, so `status` alone stands in for it — usage limit,
 * password), reproduced here at session-creation time rather than at the `/pay/[slug]`
 * route: this is a DIFFERENT entry point (`checkoutType: 'simple_checkout'`), not the
 * Phase A pay-page flow, so it runs these checks itself instead of depending on the
 * pay-page route having already run them.
 */
function assertLinkAvailableForCartSeeding(link: CheckoutLink, request: Request | null | undefined): void {
  if (!isCheckoutLinkPublic(link.status)) {
    throw new CrudHttpError(404, { error: '[internal] checkout link not found' })
  }
  // The usage-limit check itself runs atomically in `reserveCheckoutLinkSlot` below, right
  // before the cart is actually seeded — a plain read-then-compare here (as this used to
  // be) is a TOCTOU window: two concurrent requests against a `maxCompletions: 1` link can
  // both read `activeReservationCount: 0` and both seed a cart, letting a single-use link
  // produce many orders (Finding 5).
  if (link.passwordHash) {
    const token = request ? readAccessCookie(request) : null
    const verified = verifyCheckoutAccessToken(token, link.slug, { linkId: link.id, sessionVersion: link.passwordHash })
    if (!verified) {
      throw new CrudHttpError(401, { error: '[internal] password verification is required', code: 'checkout_link_password_required' })
    }
  }
}

/**
 * Atomically claims one usage slot against `maxCompletions`, the SAME compare-and-swap
 * `commands/transactions.ts#createTransactionCommand` already uses for a Phase A pay-link
 * transaction — the check (`completion_count + active_reservation_count < max_completions`)
 * and the increment happen in the SAME statement, so two concurrent seeds against a
 * `maxCompletions: 1` link can never both win. Throws the SAME `checkout_link_unavailable`
 * 422 the old read-then-compare check did when no slot is left.
 */
async function reserveCheckoutLinkSlot(
  em: EntityManager,
  link: Pick<CheckoutLink, 'id' | 'tenantId' | 'organizationId'>,
): Promise<void> {
  const reserved = await em.execute<Array<{ active_reservation_count: number }>>(
    `
      UPDATE checkout_links
      SET active_reservation_count = active_reservation_count + 1,
          is_locked = true,
          updated_at = clock_timestamp()
      WHERE id = ?
        AND organization_id = ?
        AND tenant_id = ?
        AND deleted_at IS NULL
        AND status = 'active'
        AND (
          max_completions IS NULL
          OR completion_count + active_reservation_count < max_completions
        )
      RETURNING active_reservation_count
    `,
    [link.id, link.organizationId, link.tenantId],
  )
  if (!reserved[0]) {
    throw new CrudHttpError(422, { error: '[internal] this checkout link is no longer available', code: 'checkout_link_unavailable' })
  }
}

/**
 * Releases a slot `reserveCheckoutLinkSlot` claimed — a session that never reaches a
 * terminal outcome releases it back (`completed: false`); one that completes (order or
 * quote) converts the reservation into a permanent completion instead, mirroring
 * `applyTerminalTransactionState`'s own link bookkeeping for the Phase A transaction flow.
 * Called from `commands/submit.ts`'s own terminal-outcome helpers
 * (`compensateByCancellingOrder`, `confirmOrderAndComplete`, `completeQuoteOutcome`) — never
 * duplicated inline there.
 */
export async function releaseCheckoutLinkSlot(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  linkId: string,
  outcome: { completed: boolean },
): Promise<void> {
  await em.execute(
    `
      UPDATE checkout_links
      SET active_reservation_count = GREATEST(active_reservation_count - 1, 0),
          completion_count = completion_count + ?,
          is_locked = GREATEST(active_reservation_count - 1, 0) > 0,
          updated_at = clock_timestamp()
      WHERE id = ?
        AND organization_id = ?
        AND tenant_id = ?
        AND deleted_at IS NULL
    `,
    [outcome.completed ? 1 : 0, linkId, scope.organizationId, scope.tenantId],
  )
}

function buildTrustedRuntimeContext(
  container: CommandRuntimeContext['container'],
  trusted: ReturnType<typeof buildTrustedCommandContext>['ctx'],
): CommandRuntimeContext {
  return { ...trusted, container } as CommandRuntimeContext
}

/**
 * Resolves the buyer identity to apply to the seeded cart (checkout §4.3 step 3,
 * D-R5-13): only when a customer session is present on the request AND its tenant/
 * organization equal the link's — a logged-in buyer of a DIFFERENT tenant/organization
 * leaves the cart a guest cart, exactly like having no session at all.
 */
async function resolveLinkBuyerIdentity(
  container: { resolve: <T = unknown>(name: string) => T },
  link: CheckoutLink,
  request: Request | null | undefined,
): Promise<{ customerId: string | null; customerUserId: string | null } | null> {
  if (!request) return null
  const auth = await getCustomerAuthFromRequest(request)
  if (!auth || auth.tenantId !== link.tenantId || auth.orgId !== link.organizationId) return null
  const storeContextService = tryResolve<StoreContextService>(container, 'storeContextService')
  if (!storeContextService) return null
  const resolved = await storeContextService.resolveForBuyer({
    tenantId: link.tenantId,
    organizationId: link.organizationId,
    customerUserId: auth.sub,
  })
  return { customerId: resolved.customerId, customerUserId: resolved.customerUserId }
}

export async function seedCartFromCheckoutLink(params: {
  em: EntityManager
  container: { resolve: <T = unknown>(name: string) => T }
  commandBus: CommandBus
  link: CheckoutLink
  request: Request | null | undefined
}): Promise<SeededPayLinkCart> {
  const { em, container, commandBus, link, request } = params
  assertLinkAvailableForCartSeeding(link, request)

  const templateLines = await em.find(
    CheckoutLinkCartTemplate,
    { linkId: link.id, organizationId: link.organizationId, tenantId: link.tenantId, deletedAt: null } as any,
    { orderBy: { sortOrder: 'asc' } as any },
  )
  if (templateLines.length === 0) {
    throw new CrudHttpError(422, { error: '[internal] this checkout link has no cart lines configured', code: 'checkout_link_cart_template_empty' })
  }
  const currencyCode = templateLines[0].currencyCode

  // Claims the usage slot atomically (Finding 5) right before the irreversible cart-
  // creation side effects below — any failure from here on releases it in the `catch`
  // rather than leaking a permanently-reserved slot off a session that never seeded.
  await reserveCheckoutLinkSlot(em, link)

  const { ctx: trustedCtx } = buildTrustedCommandContext({
    tenantId: link.tenantId,
    organizationId: link.organizationId,
    actorType: 'system',
    reason: `checkout:pay_link_seed:${link.id}`,
  })
  const runtimeCtx = buildTrustedRuntimeContext(container as CommandRuntimeContext['container'], trustedCtx)

  const buyerIdentity = await resolveLinkBuyerIdentity(container, link, request)

  let cartId: string
  try {
    // Cross-module FK-id call, never a static value import of `cart`'s command module —
    // the shape below mirrors `cart`'s own `CartCreateInput` (`cart/data/validators.ts`)
    // one-to-one, kept as a plain object so this file carries no compile-time dependency
    // on `cart` at all.
    const createResult = await commandBus.execute<Record<string, unknown>, { cartId: string }>('cart.create', {
      input: {
        channel: 'pay_link',
        storeId: null,
        salesChannelId: null,
        currencyCode,
        locale: DEFAULT_LINK_CART_LOCALE,
        taxMode: 'gross',
        customerId: buyerIdentity?.customerId ?? null,
        customerUserId: buyerIdentity?.customerUserId ?? null,
        email: null,
        tenantId: link.tenantId,
      },
      ctx: runtimeCtx,
    })
    cartId = createResult.result.cartId

    for (const line of templateLines) {
      await commandBus.execute('cart.lines.add', {
        input: {
          tenantId: link.tenantId,
          organizationId: link.organizationId,
          cartId,
          productId: line.productId,
          variantId: line.variantId ?? null,
          quantity: line.quantity,
          addedByActorType: 'system',
          addedByActorId: null,
          metadata: { source: 'checkout_link_cart_template', checkoutLinkId: link.id, templateLineId: line.id },
          // D-R5-19: a merchant-set price is always a fixed GROSS amount for this
          // release's pricing modes (`fixedPrice*`/`customAmount*`/`priceListItems` are
          // all gross-oriented, per `fixedPriceIncludesTax`'s own default) — a line
          // without one prices at the buyer's own catalog rate instead.
          unitPriceOverride: line.unitPriceOverride != null
            ? { amount: line.unitPriceOverride, basis: 'gross' as const }
            : null,
        },
        ctx: runtimeCtx,
      })
    }
  } catch (err) {
    await releaseCheckoutLinkSlot(em, { tenantId: link.tenantId, organizationId: link.organizationId }, link.id, { completed: false })
    throw err
  }

  return {
    cartId,
    tenantId: link.tenantId,
    organizationId: link.organizationId,
    storeId: null,
    channel: 'pay_link',
    currencyCode,
    locale: DEFAULT_LINK_CART_LOCALE,
    customerId: buyerIdentity?.customerId ?? null,
    customerUserId: buyerIdentity?.customerUserId ?? null,
  }
}
