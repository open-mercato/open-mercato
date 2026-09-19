import { withProfile, type DisplayProfile } from './profile'

/**
 * Whether the market shows one price plus a separate tax line, rather than net and gross side by
 * side.
 */
export function showsSinglePricePlusTax(profile?: DisplayProfile | null): boolean {
  return withProfile(profile).pricePresentation === 'single_price_plus_tax'
}

/**
 * The neutral i18n key a net/gross label collapses to under `single_price_plus_tax`.
 *
 * A key mapping rather than 54 edits to `sales/i18n/en.json`: the EU labels are correct for
 * `dual_net_gross` and stay exactly as they are, so a tenant that never picked a market sees no
 * change. An unmapped key is returned untouched, so a caller can pass any label safely.
 */
const NEUTRAL_PRICE_LABEL_KEYS: Record<string, string> = {
  'sales.documents.detail.totals.subtotalNet': 'sales.documents.detail.totals.subtotal',
  'sales.documents.detail.totals.subtotalGross': 'sales.documents.detail.totals.subtotal',
  'sales.documents.detail.totals.shippingNet': 'sales.documents.detail.totals.shipping',
  'sales.documents.detail.totals.shippingGross': 'sales.documents.detail.totals.shipping',
  'sales.documents.detail.totals.grandTotalNet': 'sales.documents.detail.totals.grandTotal',
  'sales.documents.detail.totals.grandTotalGross': 'sales.documents.detail.totals.grandTotal',
  'catalog.products.price.net': 'catalog.products.price.label',
  'catalog.products.price.gross': 'catalog.products.price.label',
}

export function resolvePriceLabelKey(baseKey: string, profile?: DisplayProfile | null): string {
  if (!showsSinglePricePlusTax(profile)) return baseKey
  return NEUTRAL_PRICE_LABEL_KEYS[baseKey] ?? baseKey
}

/** The i18n key naming the tax line for this market ("Sales tax" in the US, "VAT" in the EU). */
export function taxLineLabelKey(profile?: DisplayProfile | null): string {
  return withProfile(profile).taxLineLabelKey
}

/** The i18n key of the note shown under an estimated tax line, when the market defines one. */
export function taxNoteKey(profile?: DisplayProfile | null): string | null {
  return withProfile(profile).taxNoteKey
}
