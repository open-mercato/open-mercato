import type { CSSProperties } from 'react'

export type WorkflowStatus = 'completed' | 'in_progress' | 'pending' | 'not_started' | 'error'

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
} as const

export type EdgeState = 'completed' | 'pending'

export const EDGE_COLORS = {
  completed: {
    stroke: 'var(--status-success-icon)',
    strokeClass: 'stroke-status-success-icon',
    dashed: false,
  },
  pending: {
    stroke: 'var(--muted-foreground)',
    strokeClass: 'stroke-muted-foreground',
    dashed: true,
  },
} as const

export type StepRunStatus = 'completed' | 'active' | 'failed' | 'skipped' | 'pending'

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
  pending: {
    backgroundColor: 'var(--status-neutral-bg)',
    color: 'var(--status-neutral-text)',
    borderColor: 'var(--status-neutral-border)',
    borderWidth: '2px',
    borderRadius: '8px',
  },
}
