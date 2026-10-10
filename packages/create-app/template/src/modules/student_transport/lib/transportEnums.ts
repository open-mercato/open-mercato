/**
 * Client-safe copies of the school-transport enums and their English fallback
 * labels (screens must not import `data/entities`).
 */

export const SUBSCRIPTION_ACCOUNT_TYPE_VALUES = ['b2c', 'b2b'] as const
export const SUBSCRIPTION_DURATION_VALUES = ['monthly', 'quarterly', 'annual', 'custom_b2b_contract'] as const
export const SUBSCRIPTION_DIRECTION_VALUES = ['two_way', 'one_way_pickup', 'one_way_drop'] as const
export const SUBSCRIPTION_STATUS_VALUES = ['draft', 'active', 'suspended', 'ended'] as const
export const ATTENDANCE_LEG_VALUES = ['pickup', 'dropoff'] as const
export const ATTENDANCE_STATUS_VALUES = ['boarded', 'alighted', 'absent_notified', 'absent_unnotified'] as const

export const SUBSCRIPTION_ACCOUNT_TYPE_FALLBACKS: Record<string, string> = {
  b2c: 'Parent pays (B2C)',
  b2b: 'School pays (B2B)',
}

export const SUBSCRIPTION_DURATION_FALLBACKS: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
  custom_b2b_contract: 'Custom B2B contract',
}

export const SUBSCRIPTION_DIRECTION_FALLBACKS: Record<string, string> = {
  two_way: 'Two-way (morning and afternoon)',
  one_way_pickup: 'One-way (morning pickup)',
  one_way_drop: 'One-way (afternoon drop-off)',
}

export const SUBSCRIPTION_STATUS_FALLBACKS: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  suspended: 'Suspended',
  ended: 'Ended',
}

export const ATTENDANCE_LEG_FALLBACKS: Record<string, string> = {
  pickup: 'Morning pickup',
  dropoff: 'Afternoon drop-off',
}

export const ATTENDANCE_STATUS_FALLBACKS: Record<string, string> = {
  boarded: 'Boarded',
  alighted: 'Alighted',
  absent_notified: 'Absent (reported)',
  absent_unnotified: 'Absent (not reported)',
}
