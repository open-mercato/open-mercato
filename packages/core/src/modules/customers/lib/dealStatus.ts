// Single source of truth for deal open/closed (terminal) semantics.
//
// `customer_deals.status` is a lenient text column and the supported writers do not agree on
// one spelling: the closure hooks and the kanban board persist `win` / `lost`, the AI tool
// `customers.update_deal_stage` persists `won` / `lost`, the seeded vocabulary also carries
// `closed`, and rows written before 0.7.1 carry the misspelled `loose`. The terminal set
// below therefore covers every spelling a status writer persists, so status-based readers
// can share one classification. `closureOutcome` is a separate signal, and callers that
// combine both columns must handle it explicitly.
//
// A status not known to code counts as OPEN. Deal stages are configurable per tenant, so the
// lenient column can hold values this module has never seen — treating them as open keeps them
// visible in active-deal counts instead of silently reclassifying them as closed.

export const DEAL_STATUS_WIN = 'win' as const
export const DEAL_STATUS_LOST = 'lost' as const
export const DEAL_STATUS_CLOSED = 'closed' as const

/**
 * @deprecated Misspelling of the lost-deal status, canonical until 0.7.0. Writers now
 * persist {@link DEAL_STATUS_LOST}. This export stays so downstream modules keep
 * compiling and readers keep matching rows written before the 0.7.1 migration; it is
 * scheduled for removal no earlier than 0.9.0.
 */
export const DEAL_STATUS_LOSE = 'loose' as const

// `won` is the spelling the AI stage tool writes; `win` is what the UI closure flows
// persist. Both are accepted so neither writer produces an unreadable status.
export const WON_DEAL_STATUS_LIST: readonly string[] = [DEAL_STATUS_WIN, 'won']

// `lost` is canonical. `loose` is the pre-0.7.1 spelling the UI closure flows and the
// kanban board persisted; unmigrated rows and tenant dictionaries still carry it.
export const LOST_DEAL_STATUS_LIST: readonly string[] = [DEAL_STATUS_LOST, DEAL_STATUS_LOSE]

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

export function canonicalDealStatus(value: string): string {
  const lower = value.toLowerCase()
  if (lower === 'won') return DEAL_STATUS_WIN
  if (lower === 'loose') return DEAL_STATUS_LOST
  // Canonical spellings normalize to lower-case too, so an upper-case selection still
  // matches the lower-case persisted values and dictionary options.
  if (lower === 'win' || lower === 'lost' || lower === 'open' || lower === 'closed') return lower
  return value
}

/**
 * Expand operator-selected status filter values into the canonical vocabulary so a
 * single selection matches every spelling the supported writers persist (#5107).
 *
 * Alias groups (`win`/`won`, `lost`/`loose`, `closed`) are matched case-insensitively,
 * expanded to their canonical spellings, and also keep the caller's original token so
 * the result is always a strict superset of a verbatim match. Unknown values emit both
 * the trimmed original and its lower-case form — mixed-case tenant dictionary statuses
 * match exactly while `?status=Open` still hits lower-case stored rows.
 */
export function expandDealStatusAliases(values: string[]): string[] {
  const out = new Set<string>()
  for (const value of values) {
    const trimmed = value.trim()
    const lower = trimmed.toLowerCase()
    if (lower === 'win' || lower === 'won') {
      WON_DEAL_STATUS_LIST.forEach((entry) => out.add(entry))
      out.add(trimmed)
    } else if (lower === 'loose' || lower === 'lost') {
      LOST_DEAL_STATUS_LIST.forEach((entry) => out.add(entry))
      out.add(trimmed)
    } else if (lower === 'closed') {
      CLOSED_DEAL_STATUS_LIST.forEach((entry) => out.add(entry))
      out.add(trimmed)
    } else {
      out.add(trimmed)
      out.add(lower)
    }
  }
  return Array.from(out)
}
