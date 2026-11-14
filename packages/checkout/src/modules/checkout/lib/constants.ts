export const CHECKOUT_ENTITY_IDS = {
  link: 'checkout:checkout_link',
  template: 'checkout:checkout_link_template',
  transaction: 'checkout:checkout_transaction',
} as const

export const CHECKOUT_PASSWORD_COOKIE = 'om_checkout_access'

export const CHECKOUT_LINK_STATUSES = ['draft', 'active', 'inactive'] as const

export const CHECKOUT_TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'expired',
])

// Release 5, Step 2.13 (C13, §5.3): "lines without data contribute a configured default
// (single-parcel default: 1 kg, 30x20x10 cm)" — the spec's own literal numbers.
export const CHECKOUT_DEFAULT_PACKAGE_WEIGHT_KG = 1
export const CHECKOUT_DEFAULT_PACKAGE_LENGTH_CM = 30
export const CHECKOUT_DEFAULT_PACKAGE_WIDTH_CM = 20
export const CHECKOUT_DEFAULT_PACKAGE_HEIGHT_CM = 10

// §5.3/§13: "cached 5 min per (address hash, cart hash)".
export const CHECKOUT_DELIVERY_RATE_CACHE_TTL_MS = 5 * 60 * 1000
