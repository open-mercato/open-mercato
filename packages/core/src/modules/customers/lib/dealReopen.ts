import { canonicalDealStatus, isClosedDealStatus } from './dealStatus'

export const dealReopenFeatures = ['customers.deals.manage', 'sales.reopen']
export const dealReopenValues = { status: 'open', closureOutcome: null, lossReasonId: null, lossNotes: null } as const

export function isDealClosedForReopen(deal: {
  closureOutcome?: string | null
  status: string | null
}): boolean {
  return deal.closureOutcome === 'won' || deal.closureOutcome === 'lost'
    || isClosedDealStatus(canonicalDealStatus(deal.status?.trim() ?? ''))
}
