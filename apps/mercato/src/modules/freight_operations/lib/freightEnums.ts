/**
 * The client-safe copies of the freight enums.
 *
 * Screens and dialogs must not import `data/entities` (ORM decorators would
 * land in the browser bundle), so the option lists and their English fallback
 * labels live here. The values are the wire vocabulary — they must stay
 * identical to the entity constants the server validates against.
 */

export const CONTRACT_STATUS_VALUES = ['draft', 'active', 'suspended', 'terminated'] as const
export const BILLING_CYCLE_VALUES = ['monthly', 'biweekly', 'weekly', 'per_abstract', 'on_demand'] as const
export const RATE_BASIS_VALUES = ['per_trip', 'per_ton', 'per_km', 'per_hour', 'per_day', 'round_trip', 'flat_monthly'] as const
export const DRIVER_INCENTIVE_TYPE_VALUES = ['none', 'per_trip', 'per_km', 'per_hour', 'percentage_of_rate', 'fixed_monthly'] as const
export const TRIP_SOURCE_VALUES = ['contract', 'spot'] as const
export const TRIP_EXECUTION_STATUS_VALUES = ['planned', 'dispatched', 'in_transit', 'delivered', 'cancelled'] as const
export const TRIP_BILLING_STATUS_VALUES = ['unbilled', 'in_abstract', 'billed', 'excluded'] as const
export const CHARGE_KIND_VALUES = ['waiting', 'toll', 'border', 'loading', 'unloading', 'other'] as const
export const ABSTRACT_STATUS_VALUES = ['draft', 'submitted', 'disputed', 'approved', 'invoiced', 'cancelled'] as const
export const ABSTRACT_APPROVAL_MODE_VALUES = ['customer_portal', 'customer_offline', 'staff_internal'] as const
export const ABSTRACT_DISPUTE_STATUS_VALUES = ['none', 'disputed', 'resolved'] as const
export const ABSTRACT_LINE_RESOLUTION_VALUES = ['accepted_as_disputed', 'rejected_dispute', 'adjusted', 'removed'] as const
export const PAYMENT_METHOD_VALUES = ['bank_transfer', 'cheque', 'cash', 'adjustment'] as const
export const PAYMENT_STATUS_VALUES = ['recorded', 'voided'] as const

export const CONTRACT_STATUS_FALLBACKS: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  suspended: 'Suspended',
  terminated: 'Terminated',
}

export const BILLING_CYCLE_FALLBACKS: Record<string, string> = {
  monthly: 'Monthly',
  biweekly: 'Biweekly',
  weekly: 'Weekly',
  per_abstract: 'Per abstract',
  on_demand: 'On demand',
}

export const RATE_BASIS_FALLBACKS: Record<string, string> = {
  per_trip: 'Per trip',
  per_ton: 'Per ton',
  per_km: 'Per km',
  per_hour: 'Per hour',
  per_day: 'Per day',
  round_trip: 'Round trip',
  flat_monthly: 'Flat monthly',
}

export const DRIVER_INCENTIVE_TYPE_FALLBACKS: Record<string, string> = {
  none: 'None',
  per_trip: 'Per trip',
  per_km: 'Per km',
  per_hour: 'Per hour',
  percentage_of_rate: 'Share of the net rate',
  fixed_monthly: 'Fixed monthly',
}

export const TRIP_SOURCE_FALLBACKS: Record<string, string> = {
  contract: 'Contract',
  spot: 'Spot order',
}

export const TRIP_EXECUTION_STATUS_FALLBACKS: Record<string, string> = {
  planned: 'Planned',
  dispatched: 'Dispatched',
  in_transit: 'In transit',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

export const TRIP_BILLING_STATUS_FALLBACKS: Record<string, string> = {
  unbilled: 'Unbilled',
  in_abstract: 'In abstract',
  billed: 'Billed',
  excluded: 'Excluded',
}

export const CHARGE_KIND_FALLBACKS: Record<string, string> = {
  waiting: 'Waiting',
  toll: 'Toll',
  border: 'Border',
  loading: 'Loading',
  unloading: 'Unloading',
  other: 'Other',
}

export const ABSTRACT_STATUS_FALLBACKS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  disputed: 'Disputed',
  approved: 'Approved',
  invoiced: 'Invoiced',
  cancelled: 'Cancelled',
}

export const ABSTRACT_APPROVAL_MODE_FALLBACKS: Record<string, string> = {
  customer_portal: 'Customer portal',
  customer_offline: 'Recorded offline',
  staff_internal: 'Staff finalized',
}

export const ABSTRACT_DISPUTE_STATUS_FALLBACKS: Record<string, string> = {
  none: 'No dispute',
  disputed: 'Disputed',
  resolved: 'Resolved',
}

export const ABSTRACT_LINE_RESOLUTION_FALLBACKS: Record<string, string> = {
  accepted_as_disputed: 'Accepted as disputed',
  rejected_dispute: 'Rejected the dispute',
  adjusted: 'Adjusted the amount',
  removed: 'Removed from billing',
}

export const PAYMENT_METHOD_FALLBACKS: Record<string, string> = {
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
  cash: 'Cash',
  adjustment: 'Adjustment',
}

export const PAYMENT_STATUS_FALLBACKS: Record<string, string> = {
  recorded: 'Recorded',
  voided: 'Voided',
}
