/**
 * When a price drop is worth telling somebody about.
 *
 * Pure, because every rule here is a judgement that will be argued with: how big a drop counts, what to do
 * when a price disappears, and how soon the same watch may fire again.
 */

/** Below this the drop is noise — a rounding change, a tax recalculation, a currency adjustment. */
export const MINIMUM_DROP_PERCENT = 5

/**
 * How long after telling somebody before the same watch may fire again.
 *
 * A shop that moves a price down in three steps over an afternoon would otherwise send three emails about
 * the same product. Seven days is a week's worth of pricing experiments collapsed into one message.
 */
export const NOTIFY_COOLDOWN_DAYS = 7

export type PriceDropDecision =
  | { fire: true; previous: number; current: number; dropPercent: number }
  | { fire: false; reason: 'no_current_price' | 'no_reference_price' | 'not_cheaper' | 'too_small' | 'cooling_down' }

export type PriceDropInput = {
  /** What the customer last saw, as stored. Null for a watch whose reference could not be read. */
  watchedPriceGross: string | null | undefined
  /** What it costs now. Null when the product has no active price, which is NOT a drop. */
  currentPriceGross: string | null | undefined
  notifiedAt: Date | null | undefined
  now: Date
  minimumDropPercent?: number
  cooldownDays?: number
}

function parseMoney(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === '') return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * Decides whether this watch fires now.
 *
 * A missing CURRENT price is deliberately not a drop: a product that has been unpublished, or whose price row
 * was deleted, has not become cheaper — and "it is gone" is not the message the customer asked for.
 */
export function decidePriceDrop(input: PriceDropInput): PriceDropDecision {
  const current = parseMoney(input.currentPriceGross)
  if (current === null) return { fire: false, reason: 'no_current_price' }

  const previous = parseMoney(input.watchedPriceGross)
  if (previous === null) return { fire: false, reason: 'no_reference_price' }

  if (current >= previous) return { fire: false, reason: 'not_cheaper' }

  const dropPercent = ((previous - current) / previous) * 100
  if (dropPercent < (input.minimumDropPercent ?? MINIMUM_DROP_PERCENT)) return { fire: false, reason: 'too_small' }

  if (input.notifiedAt) {
    const cooldownMs = (input.cooldownDays ?? NOTIFY_COOLDOWN_DAYS) * 86_400_000
    if (input.now.getTime() - input.notifiedAt.getTime() < cooldownMs) return { fire: false, reason: 'cooling_down' }
  }

  return {
    fire: true,
    previous,
    current,
    // Rounded to whole percent: "23% off" is what a message says, and carrying more precision invites copy
    // that reads like a spreadsheet.
    dropPercent: Math.round(dropPercent),
  }
}

/**
 * The reference price to store after a scan.
 *
 * After firing, the reference becomes the NEW price, so the next drop is measured from what the customer was
 * just told. Without a fire the reference follows the price UPWARDS only: a customer who started watching at
 * 100 and saw it rise to 120 should be told when it comes back to 100, not congratulated for reaching 114.
 */
export function nextReferencePrice(
  decision: PriceDropDecision,
  watchedPriceGross: string | null | undefined,
  currentPriceGross: string | null | undefined,
): string | null | undefined {
  if (decision.fire) return currentPriceGross ?? null
  const current = parseMoney(currentPriceGross)
  const previous = parseMoney(watchedPriceGross)
  if (current === null) return watchedPriceGross
  if (previous === null) return currentPriceGross ?? null
  return current > previous ? currentPriceGross : watchedPriceGross
}
