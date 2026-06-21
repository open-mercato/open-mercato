"use client"

import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'

/**
 * Proposal disposition states exposed by the area-03 proposals API.
 * `pending`/`auto_approved` are system states; the rest are human verdicts.
 */
export type ProposalDispositionState =
  | 'pending'
  | 'auto_approved'
  | 'approved'
  | 'edited'
  | 'rejected'

/** Agent run lifecycle states exposed by the area-01 runs API. */
export type RunStatusState = 'running' | 'ok' | 'error'

/**
 * Cockpit "verbs" — the operator's four intent buckets. For the MVP every
 * pending proposal is a `decide`; the other verbs are reserved for the
 * USER_TASK shapes coming through areas 02/03.
 */
export type CockpitVerb = 'decide' | 'answer' | 'do' | 'know'

export const dispositionStatusMap: Record<ProposalDispositionState, StatusBadgeVariant> = {
  pending: 'warning',
  auto_approved: 'info',
  approved: 'success',
  edited: 'info',
  rejected: 'error',
}

export const runStatusMap: Record<RunStatusState, StatusBadgeVariant> = {
  running: 'info',
  ok: 'success',
  error: 'error',
}

/**
 * Left-accent border tokens per verb. `answer` is an AI touchpoint so it uses
 * the brand-violet accent; the other verbs use status tokens per ds-rules.
 */
export const verbAccentClass: Record<CockpitVerb, string> = {
  decide: 'border-l-4 border-status-warning-border',
  answer: 'border-l-4 border-brand-violet',
  do: 'border-l-4 border-status-info-border',
  know: 'border-l-4 border-status-neutral-border',
}

export function dispositionVariant(value: string | null | undefined): StatusBadgeVariant {
  if (value && value in dispositionStatusMap) {
    return dispositionStatusMap[value as ProposalDispositionState]
  }
  return 'neutral'
}

export function runStatusVariant(value: string | null | undefined): StatusBadgeVariant {
  if (value && value in runStatusMap) {
    return runStatusMap[value as RunStatusState]
  }
  return 'neutral'
}

export function dispositionLabelKey(value: string | null | undefined): string {
  const known: ProposalDispositionState[] = [
    'pending',
    'auto_approved',
    'approved',
    'edited',
    'rejected',
  ]
  const match = value && (known as string[]).includes(value) ? value : 'pending'
  return `agent_orchestrator.disposition.${match}`
}

export function runStatusLabelKey(value: string | null | undefined): string {
  const known: RunStatusState[] = ['running', 'ok', 'error']
  const match = value && (known as string[]).includes(value) ? value : 'running'
  return `agent_orchestrator.runStatus.${match}`
}
