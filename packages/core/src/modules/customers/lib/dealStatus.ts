// Single source of truth for deal open/closed (terminal) semantics.
//
// `customer_deals.status` is a lenient text column and the supported writers do not agree on
// one spelling: the closure hooks and the kanban board persist `win` / `loose`, the AI tool
// `customers.update_deal_stage` persists `won` / `lost`, and the seeded vocabulary also carries
// `closed`. The terminal set below therefore covers every spelling a status writer persists, so
// status-based readers can share one classification. `closureOutcome` is a separate signal and
// callers that combine both columns must handle it explicitly.
//
// A status not known to code counts as OPEN. Deal stages are configurable per tenant, so the
// lenient column can hold values this module has never seen — treating them as open keeps them
// visible in active-deal counts instead of silently reclassifying them as closed.

export const DEAL_STATUS_WIN = 'win' as const
export const DEAL_STATUS_LOSE = 'loose' as const
export const DEAL_STATUS_CLOSED = 'closed' as const

// `won` / `lost` are the spellings the AI stage tool writes; `win` / `loose` are what the UI
// closure flows persist. Both are accepted so neither writer produces an unreadable status.
export const WON_DEAL_STATUS_LIST: readonly string[] = [DEAL_STATUS_WIN, 'won']

export const LOST_DEAL_STATUS_LIST: readonly string[] = [DEAL_STATUS_LOSE, 'lost']

export const CLOSED_DEAL_STATUS_LIST: readonly string[] = [
  ...WON_DEAL_STATUS_LIST,
  ...LOST_DEAL_STATUS_LIST,
  DEAL_STATUS_CLOSED,
]

const WON_DEAL_STATUSES = new Set<string>(WON_DEAL_STATUS_LIST)
const LOST_DEAL_STATUSES = new Set<string>(LOST_DEAL_STATUS_LIST)
const CLOSED_DEAL_STATUSES = new Set<string>(CLOSED_DEAL_STATUS_LIST)

export function isWonDealStatus(value: string | null | undefined): boolean {
  return value != null && WON_DEAL_STATUSES.has(value)
}

export function isLostDealStatus(value: string | null | undefined): boolean {
  return value != null && LOST_DEAL_STATUSES.has(value)
}

export function isClosedDealStatus(value: string | null | undefined): boolean {
  return value != null && CLOSED_DEAL_STATUSES.has(value)
}

export function isOpenDealStatus(value: string | null | undefined): boolean {
  return !isClosedDealStatus(value)
}
