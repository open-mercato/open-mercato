export const CHECKOUT_ENTITY_IDS = {
  link: 'checkout:checkout_link',
  template: 'checkout:checkout_link_template',
  transaction: 'checkout:checkout_transaction',
} as const

export const CHECKOUT_PASSWORD_COOKIE = 'om_checkout_access'

/**
 * Logos are uploaded through the generic attachments route without a partition
 * override, so they land in the attachments module's default partition for
 * checkout entities. The public logo route pins its owner-scoped read to it.
 */
export const CHECKOUT_LOGO_ATTACHMENT_PARTITION = 'privateAttachments'

export const CHECKOUT_LINK_STATUSES = ['draft', 'active', 'inactive'] as const

export const CHECKOUT_TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'expired',
])
