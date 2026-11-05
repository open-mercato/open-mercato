import type { StatusBadgeVariant, StatusMap } from '@open-mercato/ui/primitives/status-badge'

export type SyncRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'

export const syncRunStatusVariants: StatusMap<SyncRunStatus> = {
  pending: 'neutral',
  running: 'info',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
  paused: 'warning',
}

export function getSyncRunStatusVariant(status: string): StatusBadgeVariant {
  return syncRunStatusVariants[status as SyncRunStatus] ?? 'neutral'
}

export type SyncSummaryKind =
  | 'enabled'
  | 'disabled'
  | 'ready'
  | 'missing'
  | 'scheduled'
  | 'paused'
  | 'none'

export const syncSummaryVariants: Record<SyncSummaryKind, StatusBadgeVariant> = {
  enabled: 'success',
  ready: 'success',
  disabled: 'neutral',
  missing: 'warning',
  scheduled: 'info',
  paused: 'warning',
  none: 'neutral',
}

export function getSyncSummaryVariant(kind: SyncSummaryKind): StatusBadgeVariant {
  return syncSummaryVariants[kind] ?? 'neutral'
}
