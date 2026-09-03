import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'

/**
 * The one disposition → operator-facing status mapping (spec
 * `2026-08-11-agent-taxonomy.md`, Phase 4).
 *
 * It is EXHAUSTIVE over the stored dispositions and its default arm is
 * `unknown`, never `approved`. Two states earn their own badge:
 *
 * - `noneProposed` — the agent looked and had nothing to offer. That is the
 *   agent's own terminus, not a verdict anyone gave, and rendering it as an
 *   approval was the mislabel Phase 4 closes.
 * - `unknown` — a stored value this build does not recognise. Saying so is a
 *   fact about the data; painting it green would be a claim about a decision.
 *
 * Pure and dependency-free (types only) so the Caseload queue, the proposal
 * card and the trace inspector all read one implementation.
 */
export type ProposalCaseStatus =
  | 'actionRequired'
  | 'approved'
  | 'autoApproved'
  | 'rejected'
  | 'noneProposed'
  | 'unknown'

export function proposalCaseStatus(disposition: string | null | undefined): ProposalCaseStatus {
  switch (disposition) {
    case 'pending':
      return 'actionRequired'
    case 'rejected':
      return 'rejected'
    case 'auto_approved':
      return 'autoApproved'
    case 'none_proposed':
      return 'noneProposed'
    case 'approved':
    case 'edited':
      return 'approved'
    default:
      return 'unknown'
  }
}

export const PROPOSAL_CASE_STATUS_VARIANT: Record<ProposalCaseStatus, StatusBadgeVariant> = {
  actionRequired: 'info',
  approved: 'success',
  autoApproved: 'info',
  rejected: 'error',
  noneProposed: 'neutral',
  unknown: 'neutral',
}

export const PROPOSAL_CASE_STATUS_DOT: Record<ProposalCaseStatus, string> = {
  actionRequired: 'bg-status-info-icon',
  approved: 'bg-status-success-icon',
  autoApproved: 'bg-status-info-icon',
  rejected: 'bg-status-error-icon',
  noneProposed: 'bg-status-neutral-icon',
  unknown: 'bg-status-neutral-icon',
}

export function proposalCaseStatusVariant(disposition: string | null | undefined): StatusBadgeVariant {
  return PROPOSAL_CASE_STATUS_VARIANT[proposalCaseStatus(disposition)]
}

export function proposalCaseStatusLabelKey(disposition: string | null | undefined): string {
  return `agent_orchestrator.caseload.status.${proposalCaseStatus(disposition)}`
}
