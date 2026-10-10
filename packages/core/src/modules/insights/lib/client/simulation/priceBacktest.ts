export const PRICE_BACKTEST_SIMULATION_KIND = 'catalog.price_backtest'

export type PriceFormValues = Record<string, unknown>

export type PriceBacktestGroupDescription = {
  family: string
  currencyCode: string | null
  basis: 'net' | 'gross' | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readAmountText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * The price backtest proposal of the CURRENT price row form, mirroring what the row's save will
 * store: the save keeps the net amount whenever it is filled in and derives the gross amount
 * through the tax calculation, and uses the gross amount only when the net one is empty. So the
 * proposal sets the net amount when it is filled in, else the gross amount (an edited gross
 * amount next to a filled-in net one would not be saved, and is not simulated either).
 */
export function buildPriceBacktestProposal(values: PriceFormValues, priceId: string | null): Record<string, unknown> {
  const net = readAmountText(values.unitPriceNet)
  const gross = readAmountText(values.unitPriceGross)
  const currency = readAmountText(values.currencyCode)
  const proposal: Record<string, unknown> = {
    priceId: priceId ?? values.id,
    currencyCode: currency ? currency.toUpperCase() : values.currencyCode,
  }
  if (net !== null) proposal.unitPriceNet = net
  else if (gross !== null) proposal.unitPriceGross = gross
  return proposal
}

/**
 * The form values of a simulated proposal, so that saving the form stores exactly the simulated
 * amounts: a net-only proposal clears the gross field (derived on save), a gross-only proposal
 * clears the net field (otherwise the net amount would win). Null for anything else.
 */
export function priceBacktestProposalToFormValues(proposal: unknown): Record<string, unknown> | null {
  if (!isRecord(proposal) || typeof proposal.priceId !== 'string') return null
  const net = readAmountText(proposal.unitPriceNet)
  const gross = readAmountText(proposal.unitPriceGross)
  if (net === null && gross === null) return null
  return { unitPriceNet: net ?? '', unitPriceGross: gross ?? '' }
}

/** Reads a price backtest group key: `<family>:<currency>:<basis>`, or `<family>` for a family without lines. */
export function describePriceBacktestGroup(groupKey: string): PriceBacktestGroupDescription {
  const [family, currencyCode, basis] = groupKey.split(':')
  return {
    family: family ?? groupKey,
    currencyCode: currencyCode && currencyCode.length > 0 ? currencyCode : null,
    basis: basis === 'net' || basis === 'gross' ? basis : null,
  }
}
