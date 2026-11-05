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
