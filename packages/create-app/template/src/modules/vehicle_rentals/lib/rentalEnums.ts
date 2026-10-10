/**
 * Client-safe copies of the rental enums and their English fallback labels.
 * Screens must not import `data/entities` (ORM decorators in the browser
 * bundle); the values are the wire vocabulary the server validates against.
 */

export const RENTAL_STATUS_VALUES = ['draft', 'active', 'completed', 'cancelled'] as const
export const RENTAL_TYPE_VALUES = ['with_driver', 'without_driver'] as const
export const RENTAL_CLIENT_TYPE_VALUES = ['b2b', 'b2c'] as const
export const RENTAL_DURATION_TYPE_VALUES = ['daily', 'weekly', 'monthly'] as const
export const RENTAL_CHECK_KIND_VALUES = ['handover', 'return', 'inspection'] as const

export const RENTAL_STATUS_FALLBACKS: Record<string, string> = {
  draft: 'Draft',
  active: 'On hire',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const RENTAL_TYPE_FALLBACKS: Record<string, string> = {
  with_driver: 'With driver',
  without_driver: 'Without driver',
}

export const RENTAL_CLIENT_TYPE_FALLBACKS: Record<string, string> = {
  b2b: 'Business (B2B)',
  b2c: 'Individual (B2C)',
}

export const RENTAL_DURATION_TYPE_FALLBACKS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
}

export const RENTAL_CHECK_KIND_FALLBACKS: Record<string, string> = {
  handover: 'Handover',
  return: 'Return',
  inspection: 'Inspection',
}
