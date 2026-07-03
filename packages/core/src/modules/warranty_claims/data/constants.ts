import type { WarrantyClaimStatus, WarrantyClaimType } from './validators'

export const CLAIM_STATUS_TRANSITIONS: Record<WarrantyClaimStatus, WarrantyClaimStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['in_review', 'cancelled'],
  in_review: ['info_requested', 'approved', 'rejected', 'cancelled'],
  info_requested: ['in_review', 'rejected', 'cancelled'],
  approved: ['awaiting_return', 'resolved', 'cancelled'],
  awaiting_return: ['received', 'cancelled'],
  received: ['inspecting'],
  inspecting: ['resolved'],
  resolved: ['closed'],
  rejected: ['in_review', 'closed'],
  closed: [],
  cancelled: [],
}

export const DEFAULT_SLA_HOURS = 48

export const CLAIM_NUMBER_PREFIXES: Record<WarrantyClaimType, string> = {
  warranty: 'WTY',
  return: 'RMA',
  core_return: 'COR',
  vendor_recovery: 'VRC',
}

export const WARRANTY_CLAIM_DICTIONARY_KINDS = [
  'warranty-claim-fault-code',
  'warranty-claim-reason',
  'warranty-claim-rejection-reason',
] as const

export type WarrantyClaimDictionaryKind = (typeof WARRANTY_CLAIM_DICTIONARY_KINDS)[number]
