export type WorkflowStatus =
  | 'completed'
  | 'in_progress'
  | 'pending'
  | 'failed'
  | 'paused'
  | 'not_started'

export const STATUS_COLORS = {
  completed: {
    bg: 'bg-emerald-100',
    border: 'border-emerald-300',
    text: 'text-emerald-900',
    icon: 'text-emerald-600',
    hex: '#10b981',
  },
  in_progress: {
    bg: 'bg-blue-100',
    border: 'border-blue-300',
    text: 'text-blue-900',
    icon: 'text-blue-600',
    hex: '#3b82f6',
  },
  pending: {
    bg: 'bg-yellow-100',
    border: 'border-yellow-300',
    text: 'text-yellow-900',
    icon: 'text-yellow-600',
    hex: '#eab308',
  },
  failed: {
    bg: 'bg-status-error-bg',
    border: 'border-status-error-border',
    text: 'text-status-error-text',
    icon: 'text-status-error-icon',
    hex: '#ef4444',
  },
  paused: {
    bg: 'bg-status-warning-bg',
    border: 'border-status-warning-border',
    text: 'text-status-warning-text',
    icon: 'text-status-warning-icon',
    hex: '#eab308',
  },
  not_started: {
    bg: 'bg-muted',
    border: 'border-border',
    text: 'text-foreground',
    icon: 'text-muted-foreground',
    hex: '#6b7280',
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
  if (status === 'paused' || status === 'waiting' || status === 'waiting_for_activities') return 'paused'
  return 'not_started'
}

export type EdgeState = 'completed' | 'pending'

export const EDGE_COLORS = {
  completed: {
    stroke: '#10b981',
    strokeClass: 'stroke-emerald-500',
    dashed: false,
  },
  pending: {
    stroke: '#9ca3af',
    strokeClass: 'stroke-muted-foreground',
    dashed: true,
  },
} as const
