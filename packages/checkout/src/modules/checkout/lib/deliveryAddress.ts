import { createHash } from 'node:crypto'

// Release 5, Step 2.13 (C13). `CheckoutSession.shippingAddress` is an untyped jsonb blob
// (`PATCH /sessions/current` accepts `z.record(z.string(), z.unknown())`, §9's own
// skeleton from Step 2.12) — this is the ONE place that defensively narrows it into the
// `{ countryCode, postalCode, city, line1, line2? }` shape `shippingCarrierService
// .calculateRates` actually requires (`shipping_carriers/lib/shipping-service.ts`).

export type CarrierAddress = {
  countryCode: string
  postalCode: string
  city: string
  line1: string
  line2?: string
}

function readStringField(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

/** Returns `null` when the buyer has not supplied enough of a destination to quote
 * against — the caller answers `422 delivery_unavailable` rather than guessing. */
export function resolveDestinationAddress(shippingAddress: Record<string, unknown> | null | undefined): CarrierAddress | null {
  if (!shippingAddress) return null
  const countryCode = readStringField(shippingAddress, ['countryCode', 'country_code', 'country'])
  const postalCode = readStringField(shippingAddress, ['postalCode', 'postal_code', 'zip', 'zipCode'])
  const city = readStringField(shippingAddress, ['city'])
  const line1 = readStringField(shippingAddress, ['line1', 'addressLine1', 'street', 'line_1'])
  if (!countryCode || !postalCode || !city || !line1) return null
  const line2 = readStringField(shippingAddress, ['line2', 'addressLine2', 'line_2'])
  return { countryCode, postalCode, city, line1, ...(line2 ? { line2 } : {}) }
}

export function hashAddressForCache(address: CarrierAddress): string {
  return createHash('sha256').update(JSON.stringify(address)).digest('hex')
}

/** Order-independent, value-stable hash of the cart's rate-relevant lines — used as the
 * "cart hash" half of §5.3's `(address hash, cart hash)` cache key, so a line add/remove/
 * quantity change busts the cache without the caller needing a dedicated `Cart.updatedAt`
 * read. */
export function hashCartLinesForCache(
  lines: Array<{ lineId: string; productId: string; variantId: string | null; quantity: string }>,
): string {
  const sorted = [...lines].sort((a, b) => a.lineId.localeCompare(b.lineId))
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
}
