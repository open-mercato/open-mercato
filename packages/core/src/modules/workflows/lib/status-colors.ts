export type WorkflowStatus = 'completed' | 'in_progress' | 'pending' | 'not_started' | 'error'

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
  not_started: {
    bg: 'bg-muted',
    border: 'border-border',
    text: 'text-foreground',
    icon: 'text-muted-foreground',
    hex: '#6b7280',
  },
  error: {
    bg: 'bg-status-error-bg',
    border: 'border-status-error-border',
    text: 'text-status-error-text',
    icon: 'text-status-error-icon',
    hex: '#dc2626',
  },
} as const

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
