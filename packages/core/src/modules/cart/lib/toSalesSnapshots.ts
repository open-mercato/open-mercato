import type { EntityManager } from '@mikro-orm/postgresql'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { SalesAdjustmentDraft, SalesLineSnapshot } from '@open-mercato/core/modules/sales/lib/types'
import { Cart, CartLine, CartPromotionApplication } from '../data/entities'
import { toCartTotalsLineSnapshot } from './reprice'

// Release 5 Phase 4 (checkout C3/C7, `.ai/specs/2026-08-14-cart-module.md` §3.1a/§9.1 rev
// 10). `cartService.getSalesSnapshot({ cartId, tenantId, organizationId, checkoutSessionId
// })` is the ONE read checkout uses to build its quote (§7.2 step 5a) — "the same
// SalesLineSnapshot[] + adjustments that produced Cart.totals, so checkout never re-maps
// lines." The function named by the spec's own file path (`lib/toSalesSnapshots.ts`) did
// not exist anywhere in this module before this Step (confirmed: zero hits for
// `getSalesSnapshot`/`toSalesSnapshots` outside the spec text) — built here, additive, as
// a new method on the already-existing `cartService` DI key (BC table: "DI |
// cartService.getSalesSnapshot (new method on an existing key) | Additive").
//
// Per-line mapping reuses `lib/reprice.ts#toCartTotalsLineSnapshot` verbatim — the SAME
// function `buildRecomputeCartTotalsPhase` already calls to produce `Cart.totals` — so the
// snapshot's own lines are, by construction, the exact input that produced the cart's
// persisted totals. Order-scope adjustments (`CART_DISCOUNT` effects) are reconstructed
// from the persisted `CartPromotionApplication` rows (`scope: 'order'`) rather than
// recomputed, since nothing holds the in-memory `SalesAdjustmentDraft[]` `cart.reprice`
// built past that one request.

export type CartSalesSnapshotLine = { cartLineId: string; snapshot: SalesLineSnapshot }

export type CartSalesSnapshot = {
  lines: CartSalesSnapshotLine[]
  adjustments: SalesAdjustmentDraft[]
  totals: Record<string, unknown>
  currencyCode: string
  updatedAt: Date
}

type CartSalesSnapshotScope = { tenantId: string; organizationId: string }

/** Same locale-fallback order `lib/promotionContext.ts`'s own (unexported) `pickEffectLabel`
 * uses — duplicated rather than imported, since that file's helper is private to its own
 * module and this is a three-line, side-effect-free pure function. */
function pickEffectLabel(labels: Record<string, string> | undefined | null, locale: string): string | null {
  if (!labels) return null
  if (labels[locale]) return labels[locale]
  const [language] = locale.split('-')
  if (language && labels[language]) return labels[language]
  const values = Object.values(labels)
  return values.length > 0 ? values[0] : null
}

/**
 * Pure mapping from an already-loaded `Cart` + its live lines to the snapshot shape —
 * no DB access of its own beyond the `CartPromotionApplication` read for adjustments.
 * Exported separately from `getCartSalesSnapshot` so a caller that already holds both
 * (e.g. a future admin re-derivation) is not forced through the session-bound guard below.
 */
export async function buildCartSalesSnapshot(
  em: EntityManager,
  cart: Cart,
  lines: CartLine[],
): Promise<CartSalesSnapshot> {
  const scope: CartSalesSnapshotScope = { tenantId: cart.tenantId, organizationId: cart.organizationId }

  // §9: a locked cart can never have a flagged line — this filter is defensive, mirroring
  // `buildRecomputeCartTotalsPhase`'s own `lines.filter((line) => line.flagState == null)`
  // exactly, so the snapshot's lines are provably the same set that produced `cart.totals`.
  // Gift lines (`origin: 'promotion'`) are NOT excluded — TC-CART-LOCK-06's own wording
  // ("gift lines included").
  const snapshotLines: CartSalesSnapshotLine[] = lines
    .filter((line) => line.flagState == null)
    .map((line) => ({ cartLineId: line.id, snapshot: toCartTotalsLineSnapshot(line, cart.currencyCode) }))

  const applications = (await findWithDecryption(
    em,
    CartPromotionApplication,
    { cartId: cart.id, scope: 'order', tenantId: scope.tenantId, organizationId: scope.organizationId },
    {},
    scope,
  )) as CartPromotionApplication[]

  // A promotion no longer active is synced to a "zeroed" row (`effect: {}`, `amountNet`/
  // `amountGross`: null, `lib/promotionContext.ts`'s own documented design) rather than
  // deleted — skip those; only a row that actually carries an amount is a live adjustment.
  const adjustments: SalesAdjustmentDraft[] = applications
    .filter((application) => application.amountNet != null && application.amountGross != null)
    .map((application) => {
      const effect = (application.effect ?? {}) as { currency?: string; label?: Record<string, string> }
      return {
        scope: 'order' as const,
        kind: 'discount',
        promotionId: application.promotionId,
        amountNet: Number(application.amountNet),
        amountGross: Number(application.amountGross),
        currencyCode: effect.currency ?? cart.currencyCode,
        label: pickEffectLabel(effect.label, cart.locale),
      }
    })

  return {
    lines: snapshotLines,
    adjustments,
    totals: (cart.totals ?? {}) as Record<string, unknown>,
    currencyCode: cart.currencyCode,
    updatedAt: cart.updatedAt,
  }
}

export type GetCartSalesSnapshotInput = {
  cartId: string
  tenantId: string
  organizationId: string
  /** (C1) Must match the cart's own stored `checkoutSessionId`; a mismatch, or a cart that
   * is not `locked`, is the uniform `404` — same contract as `unlock`/`markConverted`. */
  checkoutSessionId: string
}

/**
 * `cartService.getSalesSnapshot` — answers only for a `locked` cart whose
 * `checkout_session_id` matches (§3.1a/§9.1 rev 10 "Session binding (C1)").
 */
export async function getCartSalesSnapshot(
  em: EntityManager,
  input: GetCartSalesSnapshotInput,
): Promise<CartSalesSnapshot> {
  const scope: CartSalesSnapshotScope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const cart = await findOneWithDecryption(
    em,
    Cart,
    { id: input.cartId, tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'basket' as const },
    {},
    scope,
  )
  if (!cart || cart.status !== 'locked' || cart.checkoutSessionId !== input.checkoutSessionId) {
    throw notFound('[internal] cart not found')
  }

  const lines = (await findWithDecryption(
    em,
    CartLine,
    { cartId: cart.id, deletedAt: null, tenantId: scope.tenantId, organizationId: scope.organizationId },
    {},
    scope,
  )) as CartLine[]

  return buildCartSalesSnapshot(em, cart, lines)
}
