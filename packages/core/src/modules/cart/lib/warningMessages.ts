import type { TranslateWithFallbackFn } from '@open-mercato/shared/lib/i18n/translate'

// Step 8.5 (QA F13) — every `warnings[].message` this module returns reaches an anonymous
// storefront buyer over the public cart API, so it MUST be real, translated copy, never an
// `[internal]`-prefixed developer placeholder (root `AGENTS.md`'s own `[internal]` contract:
// reserved for genuinely internal/dev-facing strings, never text a real end user reads). The
// five distinct messages below were previously duplicated verbatim across `lib/cartView.ts`
// and six `api/current/**/route.ts` files; this is the single source of truth for all of them,
// keyed by a semantic label rather than the wire `code` field, because ONE wire code
// (`product_unavailable`) legitimately carries two different texts depending on whether an
// existing line was flagged ("this LINE is no longer available") or a brand-new add was
// rejected before any line existed ("this PRODUCT is not available").
export type CartWarningMessageKey =
  | 'out_of_stock'
  | 'line_unavailable'
  | 'product_unavailable'
  | 'promotion_no_longer_valid'
  | 'quantity_capped'

const CART_WARNING_MESSAGE_CATALOGUE: Record<CartWarningMessageKey, { key: string; fallback: string }> = {
  out_of_stock: {
    key: 'cart.warnings.out_of_stock',
    fallback: 'This line is out of stock',
  },
  line_unavailable: {
    key: 'cart.warnings.line_unavailable',
    fallback: 'This line is no longer available for the buyer’s assortment scope',
  },
  product_unavailable: {
    key: 'cart.warnings.product_unavailable',
    fallback: 'This product is not available for the buyer’s assortment scope',
  },
  promotion_no_longer_valid: {
    key: 'cart.warnings.code_no_longer_valid',
    fallback: 'A previously applied code is no longer valid',
  },
  quantity_capped: {
    key: 'cart.warnings.quantity_capped',
    fallback: 'The requested quantity was capped at the maximum allowed',
  },
}

export function resolveCartWarningMessage(
  messageKey: CartWarningMessageKey,
  translate: TranslateWithFallbackFn,
): string {
  const entry = CART_WARNING_MESSAGE_CATALOGUE[messageKey]
  return translate(entry.key, entry.fallback)
}
