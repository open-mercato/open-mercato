/**
 * Which products to put in front of one customer, decided without touching the database.
 *
 * Two signals, in a deliberate order: what people who bought what this customer bought went on to buy
 * (affinity), padded with what sells best overall. Affinity first because it is about this customer;
 * best-sellers exist so a message never arrives with an empty block, which is the failure an author
 * cannot see when they preview it against their own well-stocked account.
 */

export type AffinityCandidate = {
  sku: string
  name: string
  /** How many order lines pair it with something this customer owns. */
  coOccurrences: number
  /** How many DISTINCT customers that pairing came from. */
  distinctCustomers: number
}

export type BestSellerCandidate = {
  sku: string
  name: string
  orders: number
}

export type Recommendation = {
  sku: string
  name: string
  /** Which signal chose it, so a profile screen can say why. */
  source: 'affinity' | 'bestSeller'
}

export type RankingInput = {
  affinity: AffinityCandidate[]
  bestSellers: BestSellerCandidate[]
  /** SKUs the customer already owns. */
  alreadyPurchased: string[]
  limit: number
}

/**
 * Below this many distinct customers a pairing is a coincidence, not a pattern.
 *
 * One person buying a kettle and a guitar string in the same order is not a reason to offer guitar
 * strings to everyone who buys a kettle. Two is a low bar, but it is the difference between evidence and
 * an anecdote, and a shop with little history falls back to best-sellers rather than to noise.
 */
export const MINIMUM_AFFINITY_CUSTOMERS = 2

/** Nobody reads the eleventh suggestion, and a longer list is a slower query for no gain. */
export const MAX_RECOMMENDATIONS = 10

function byAffinity(left: AffinityCandidate, right: AffinityCandidate): number {
  // Distinct customers before raw co-occurrences: one customer ordering the same pair five times is
  // weaker evidence than five customers ordering it once, and counting lines would rank it higher.
  if (right.distinctCustomers !== left.distinctCustomers) return right.distinctCustomers - left.distinctCustomers
  if (right.coOccurrences !== left.coOccurrences) return right.coOccurrences - left.coOccurrences
  // A stable final tie-break, so the same customer sees the same order on a resend rather than a shuffle.
  return left.sku.localeCompare(right.sku)
}

function byBestSeller(left: BestSellerCandidate, right: BestSellerCandidate): number {
  if (right.orders !== left.orders) return right.orders - left.orders
  return left.sku.localeCompare(right.sku)
}

/**
 * Ranks and pads, excluding what the customer already owns.
 *
 * Excluding owned products is right for the general case and wrong for consumables — someone who bought
 * coffee wants coffee again. That case is the reorder-cycle engine's, which knows a product's interval;
 * guessing here would offer a fridge to somebody who just bought a fridge.
 */
export function rankRecommendations(input: RankingInput): Recommendation[] {
  const limit = Math.max(0, Math.min(input.limit, MAX_RECOMMENDATIONS))
  if (limit === 0) return []

  const excluded = new Set(input.alreadyPurchased)
  const chosen: Recommendation[] = []
  const taken = new Set<string>()

  const push = (sku: string, name: string, source: Recommendation['source']) => {
    if (chosen.length >= limit) return
    if (!sku || excluded.has(sku) || taken.has(sku)) return
    taken.add(sku)
    chosen.push({ sku, name: name || sku, source })
  }

  for (const candidate of [...input.affinity].sort(byAffinity)) {
    if (candidate.distinctCustomers < MINIMUM_AFFINITY_CUSTOMERS) continue
    push(candidate.sku, candidate.name, 'affinity')
  }

  for (const candidate of [...input.bestSellers].sort(byBestSeller)) {
    push(candidate.sku, candidate.name, 'bestSeller')
  }

  return chosen
}
