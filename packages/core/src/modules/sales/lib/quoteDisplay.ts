import { formatDate } from '@open-mercato/shared/lib/display/datetime'
import { formatMoney } from '@open-mercato/shared/lib/display/money'
import { showsSinglePricePlusTax, taxLineLabelKey, taxNoteKey } from '@open-mercato/shared/lib/display/price'
import type { DisplayProfile } from '@open-mercato/shared/lib/display/profile'

type Translate = (key: string, fallback?: string, params?: Record<string, string | number>) => string

export type QuoteDisplayTotals = {
  currencyCode: string
  subtotalNetAmount?: string | null
  subtotalGrossAmount?: string | null
  discountTotalAmount?: string | null
  taxTotalAmount?: string | null
  grandTotalNetAmount?: string | null
  grandTotalGrossAmount?: string | null
  validUntil?: Date | string | null
  taxStatus?: string | null
}

export type QuoteDisplayLineInput = {
  currencyCode?: string | null
  unitPriceNet?: string | null
  unitPriceGross?: string | null
  totalNetAmount?: string | null
  totalGrossAmount?: string | null
}

export type QuoteDisplayLine = {
  unitPrice: string | null
  total: string | null
}

/**
 * Everything a quote surface needs to render already formatted, built once on the server.
 *
 * The public quote page and the quote emails both reach customers who are not signed in, so they
 * cannot resolve the merchant's market themselves - the provider only knows the market of whoever
 * is logged in, and for these two surfaces that is nobody. Formatting on the server, against the
 * quote's OWN organization, is what makes a US merchant's customer see `$48,250.00` and
 * `10/18/2026` in an email client that has no idea which market the quote came from.
 */
export type QuoteDisplayViewModel = {
  singlePricePlusTax: boolean
  validUntil: string | null
  subtotal: string | null
  discountTotal: string | null
  taxTotal: string | null
  grandTotal: string | null
  /** The market's name for the tax line ("Sales tax", "VAT"), already translated. */
  taxLabel: string
  /** The market's note under an estimated tax line, already translated, or `null`. */
  taxNote: string | null
  lines: QuoteDisplayLine[]
}

function money(
  amount: string | null | undefined,
  currencyCode: string | null | undefined,
  profile: DisplayProfile | null,
  locale: string | null | undefined,
): string | null {
  if (amount === null || amount === undefined || amount === '') return null
  return formatMoney(amount, currencyCode, profile, { locale })
}

/**
 * Build the preformatted view model for one quote.
 *
 * Under `single_price_plus_tax` the single price is the NET amount, whatever a line's price kind
 * says, because the tax line is rendered separately and a gross amount beside it double counts
 * (spec, Price presentation). Under `dual_net_gross` the gross amount is the headline, exactly as
 * today.
 */
export function buildQuoteDisplayViewModel(
  totals: QuoteDisplayTotals,
  lines: QuoteDisplayLineInput[],
  profile: DisplayProfile | null,
  translate: Translate,
  locale?: string | null,
): QuoteDisplayViewModel {
  const singlePricePlusTax = showsSinglePricePlusTax(profile)
  const currency = totals.currencyCode
  const headline = (net: string | null | undefined, gross: string | null | undefined) =>
    (singlePricePlusTax ? net : (gross ?? net))

  const marketTaxNoteKey = taxNoteKey(profile)
  const taxIsEstimate = (totals.taxStatus ?? null) !== 'calculated'

  return {
    singlePricePlusTax,
    validUntil: formatDate(totals.validUntil ?? null, profile, { locale }),
    subtotal: money(headline(totals.subtotalNetAmount, totals.subtotalGrossAmount), currency, profile, locale),
    discountTotal: money(totals.discountTotalAmount, currency, profile, locale),
    taxTotal: money(totals.taxTotalAmount, currency, profile, locale),
    grandTotal: money(headline(totals.grandTotalNetAmount, totals.grandTotalGrossAmount), currency, profile, locale),
    taxLabel: translate(taxLineLabelKey(profile), translate('sales.quotes.public.tax', 'Tax')),
    taxNote: singlePricePlusTax && taxIsEstimate && marketTaxNoteKey ? translate(marketTaxNoteKey) : null,
    lines: lines.map((line) => ({
      unitPrice: money(
        headline(line.unitPriceNet, line.unitPriceGross),
        line.currencyCode ?? currency,
        profile,
        locale,
      ),
      total: money(
        headline(line.totalNetAmount, line.totalGrossAmount),
        line.currencyCode ?? currency,
        profile,
        locale,
      ),
    })),
  }
}
