import type { CSSProperties } from 'react'

/**
 * `working`, `waiting` and `needs_attention` are the run PRESENTATION states
 * (`lib/step-presentation.ts`). They are additive: `in_progress` and `paused`
 * keep their exact meaning and colour for every caller that already uses them,
 * and nothing that existed was re-pointed.
 *
 * They exist because the two questions "is the system doing something?" and
 * "are we blocked on the outside world?" had no separate names here — so a
 * running agent and a task sitting on someone's desk since Tuesday painted the
 * same amber pause.
 */
export type WorkflowStatus =
  | 'completed'
  | 'in_progress'
  | 'pending'
  | 'failed'
  | 'paused'
  | 'not_started'
  | 'error'
  | 'working'
  | 'waiting'
  | 'needs_attention'

export const STATUS_COLORS = {
  completed: {
    bg: 'bg-status-success-bg',
    border: 'border-status-success-border',
    text: 'text-status-success-text',
    icon: 'text-status-success-icon',
    hex: 'var(--status-success-icon)',
  },
  in_progress: {
    bg: 'bg-status-info-bg',
    border: 'border-status-info-border',
    text: 'text-status-info-text',
    icon: 'text-status-info-icon',
    hex: 'var(--status-info-icon)',
  },
  pending: {
    bg: 'bg-status-warning-bg',
    border: 'border-status-warning-border',
    text: 'text-status-warning-text',
    icon: 'text-status-warning-icon',
    hex: 'var(--status-warning-icon)',
  },
  failed: {
    bg: 'bg-status-error-bg',
    border: 'border-status-error-border',
    text: 'text-status-error-text',
    icon: 'text-status-error-icon',
    hex: 'var(--status-error-icon)',
  },
  paused: {
    bg: 'bg-status-warning-bg',
    border: 'border-status-warning-border',
    text: 'text-status-warning-text',
    icon: 'text-status-warning-icon',
    hex: 'var(--status-warning-icon)',
  },
  not_started: {
    bg: 'bg-muted',
    border: 'border-border',
    text: 'text-foreground',
    icon: 'text-muted-foreground',
    hex: 'var(--muted-foreground)',
  },
  error: {
    bg: 'bg-status-error-bg',
    border: 'border-status-error-border',
    text: 'text-status-error-text',
    icon: 'text-status-error-icon',
    hex: 'var(--status-error-icon)',
  },
  working: {
    bg: 'bg-status-info-bg',
    border: 'border-status-info-border',
    text: 'text-status-info-text',
    icon: 'text-status-info-icon',
    hex: 'var(--status-info-icon)',
  },
  waiting: {
    bg: 'bg-status-warning-bg',
    border: 'border-status-warning-border',
    text: 'text-status-warning-text',
    icon: 'text-status-warning-icon',
    hex: 'var(--status-warning-icon)',
  },
  // "Destructive-adjacent" (spec Part 2): a parked run is not a failed run, so
  // it does not get `failed`'s glyph — but it does need a human, so it borrows
  // the error tokens rather than sitting quietly in amber next to a timer.
  needs_attention: {
    bg: 'bg-status-error-bg',
    border: 'border-status-error-border',
    text: 'text-status-error-text',
    icon: 'text-status-error-icon',
    hex: 'var(--status-error-icon)',
  },
} as const

/**
 * Normalize a raw execution/step status (any of the vocabularies used across the
 * instance viewer, events, and definition graph) into a `WorkflowStatus` for
 * node/minimap coloring. Keep this the single source of truth so every node
 * type colors failed (red) and paused (yellow) steps consistently.
 */
export function toWorkflowStatus(status?: string): WorkflowStatus {
  if (!status || status === 'pending') return 'not_started'
  if (status === 'running' || status === 'in_progress' || status === 'active') return 'in_progress'
  if (status === 'completed') return 'completed'
  if (status === 'failed' || status === 'error') return 'failed'
  // The presentation states pass straight through: the run surfaces resolve
  // them up front (`lib/step-presentation.ts`) and this must not re-collapse
  // them back into the lifecycle vocabulary the resolver exists to replace.
  if (status === 'working') return 'working'
  if (status === 'waiting') return 'waiting'
  if (status === 'needs_attention') return 'needs_attention'
  // `waiting_for_activities` is the ENGINE working — an activity is executing
  // in a worker — so it is no longer painted as a pause.
  if (status === 'waiting_for_activities') return 'working'
  if (status === 'paused') return 'paused'
  return 'not_started'
}

export type EdgeState = 'completed' | 'pending' | 'error'

/**
 * `dashArray` and `strokeWidth` are part of the state, not hard-coded stroke
 * options: the error route's longer dash pattern is a second, non-color signal,
 * and the edge pairs it with an always-visible icon+label chip so status is
 * never color-only.
 *
 * A dash has to MEAN something. Error routes use `8,4`, data-mapping links
 * `2,3` and compensation ghosts `10,4,2,4`; `pending` — the default state every
 * route in the editor falls back to — is therefore SOLID, so the signal is not
 * spent on a canvas where every wire is dashed. It is also the lightest and
 * thinnest state: a neutral wire should recede behind the cards it connects,
 * while a state that carries meaning stays heavier.
 *
 * The default stroke is mixed to 70% of `--muted-foreground`, not the design
 * mock's 55%: at this weight, 55% of a mid-grey on a near-white plane measures
 * ~2.2:1, under the 3:1 WCAG minimum for non-text graphical objects. 70% is
 * visually near-identical and compliant. `color-mix` keeps the value on the
 * token, so dark mode is handled by `--muted-foreground` itself.
 */
export const EDGE_COLORS = {
  completed: {
    stroke: 'var(--status-success-icon)',
    strokeClass: 'stroke-status-success-icon',
    strokeWidth: 2,
    dashed: false,
    dashArray: undefined,
  },
  pending: {
    stroke: 'color-mix(in oklab, var(--muted-foreground) 70%, transparent)',
    strokeClass: 'stroke-muted-foreground',
    strokeWidth: 1.5,
    dashed: false,
    dashArray: undefined,
  },
  error: {
    stroke: 'var(--status-error-icon)',
    strokeClass: 'stroke-status-error-icon',
    strokeWidth: 2,
    dashed: true,
    dashArray: '8,4',
  },
} as const

export type StepRunStatus = 'completed' | 'active' | 'failed' | 'skipped' | 'paused' | 'pending'

export const STEP_STATUS_STYLES: Record<StepRunStatus, CSSProperties> = {
  completed: {
    backgroundColor: 'var(--status-success-bg)',
    color: 'var(--status-success-text)',
    borderColor: 'var(--status-success-border)',
    borderWidth: '3px',
    borderRadius: '16px',
  },
  active: {
    backgroundColor: 'var(--status-info-bg)',
    color: 'var(--status-info-text)',
    borderColor: 'var(--status-info-border)',
    borderWidth: '3px',
    borderRadius: '16px',
    boxShadow: '0 0 0 3px var(--status-info-border)',
  },
  failed: {
    backgroundColor: 'var(--status-error-bg)',
    color: 'var(--status-error-text)',
    borderColor: 'var(--status-error-border)',
    borderWidth: '3px',
    borderRadius: '16px',
  },
  skipped: {
    backgroundColor: 'var(--status-warning-bg)',
    color: 'var(--status-warning-text)',
    borderColor: 'var(--status-warning-border)',
    borderWidth: '3px',
    borderRadius: '16px',
  },
  paused: {
    backgroundColor: 'var(--status-warning-bg)',
    color: 'var(--status-warning-text)',
    borderColor: 'var(--status-warning-icon)',
    borderWidth: '3px',
    borderRadius: '16px',
  },
  pending: {
    backgroundColor: 'var(--status-neutral-bg)',
    color: 'var(--status-neutral-text)',
    borderColor: 'var(--status-neutral-border)',
    borderWidth: '2px',
    borderRadius: '8px',
  },
}
