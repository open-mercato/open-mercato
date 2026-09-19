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
  'sales.documents.lineItems.unitPriceNet': 'sales.documents.lineItems.unitPrice',
  'sales.documents.lineItems.unitPriceGross': 'sales.documents.lineItems.unitPrice',
  'sales.documents.lineItems.totalNet': 'sales.documents.lineItems.total',
  'sales.documents.lineItems.totalGross': 'sales.documents.lineItems.total',
  'sales.documents.totals.subtotalNet': 'sales.documents.totals.subtotal',
  'sales.documents.totals.subtotalGross': 'sales.documents.totals.subtotal',
  'sales.documents.totals.totalNet': 'sales.documents.totals.total',
  'sales.documents.totals.totalGross': 'sales.documents.totals.total',
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
