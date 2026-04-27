export type StageTotal = { currency: string; sum: number }

type DealValueLike = {
  valueAmount: number | null
  valueCurrency: string | null
}

export function computeStageTotals(
  deals: ReadonlyArray<DealValueLike>,
  baseCurrency: string | null,
): StageTotal[] {
  const byCurrency = new Map<string, number>()
  deals.forEach((deal) => {
    if (deal.valueAmount === null) return
    const code = (deal.valueCurrency ?? 'USD').toUpperCase()
    byCurrency.set(code, (byCurrency.get(code) ?? 0) + deal.valueAmount)
  })
  return Array.from(byCurrency.entries())
    .map(([currency, sum]) => ({ currency, sum }))
    .sort((a, b) => {
      if (baseCurrency) {
        if (a.currency === baseCurrency) return -1
        if (b.currency === baseCurrency) return 1
      }
      return a.currency.localeCompare(b.currency)
    })
}
