import type { CauseKind } from '@open-mercato/shared/lib/causation/types'

export type VersionHistoryEntry = {
  id: string
  commandId: string
  actionLabel: string | null
  executionState: string
  actorUserId: string | null
  actorUserName: string | null
  resourceKind: string | null
  resourceId: string | null
  parentResourceKind?: string | null
  parentResourceId?: string | null
  undoToken: string | null
  createdAt: string
  updatedAt: string
  snapshotBefore?: unknown | null
  snapshotAfter?: unknown | null
  changes?: Record<string, unknown> | null
  context?: Record<string, unknown> | null
  causeKind?: CauseKind | null
  causeId?: string | null
  correlationId?: string | null
  causedByLogId?: string | null
}

export type VersionHistoryConfig = {
  resourceKind: string
  resourceId: string
  resourceIdFallback?: string
  organizationId?: string
  includeRelated?: boolean
}
