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

/**
 * Display-only default confidence threshold for the proposal verdict hint.
 * The real auto-approval gate is configured per workflow node
 * (`onResult.autoApproveThreshold`, demo default 0.8) and lives in the
 * disposition service — the card cannot know a given node's threshold, so it
 * uses this standard value purely to label a proposal as "recommended for
 * approval" vs "needs your input". It never drives an actual disposition.
 */
export const VERDICT_DISPLAY_THRESHOLD = 0.8

export type ProposalVerdict = {
  status: 'success' | 'warning'
  labelKey: string
}

/**
 * Confidence-driven verdict shown above a proposal. High confidence
 * (≥ {@link VERDICT_DISPLAY_THRESHOLD}) reads as recommended for approval;
 * a low or missing confidence reads as needing human input (fail-closed,
 * matching the disposition gate's treatment of null confidence).
 */
export function proposalVerdict(confidence: number | null | undefined): ProposalVerdict {
  if (typeof confidence === 'number' && confidence >= VERDICT_DISPLAY_THRESHOLD) {
    return { status: 'success', labelKey: 'agent_orchestrator.proposal.verdict.approve' }
  }
  return { status: 'warning', labelKey: 'agent_orchestrator.proposal.verdict.ask' }
}
