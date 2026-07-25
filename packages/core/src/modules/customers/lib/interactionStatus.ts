// Single source of truth for interaction (CRM task) open/terminal semantics.
//
// The editable list of statuses lives in the `interaction-statuses` dictionary and
// is configurable per tenant. The behaviorally-significant question — does a status
// mean the task is still open, or is it closed/terminal — stays in code here so every
// call site agrees. A status not known to code counts as OPEN (non-terminal): it shows
// in the open-activities badge and is never auto-treated as completed. That is the safe
// default and matches the deal open-activities enricher's `status NOT IN (terminal)` filter.

export const INTERACTION_STATUS_COMPLETED = 'done' as const
export const INTERACTION_STATUS_CANCELED = 'canceled' as const
export const INTERACTION_STATUS_PLANNED = 'planned' as const

// `completed` is a legacy spelling accepted defensively; `done` is the canonical
// terminal-success value persisted by the complete action and the email logger.
export const TERMINAL_INTERACTION_STATUS_LIST: readonly string[] = [
  INTERACTION_STATUS_COMPLETED,
  INTERACTION_STATUS_CANCELED,
  'completed',
]

const TERMINAL_INTERACTION_STATUSES = new Set<string>(TERMINAL_INTERACTION_STATUS_LIST)

export function isTerminalInteractionStatus(value: string | null | undefined): boolean {
  return value != null && TERMINAL_INTERACTION_STATUSES.has(value)
}

export function isOpenInteractionStatus(value: string | null | undefined): boolean {
  return !isTerminalInteractionStatus(value)
}
