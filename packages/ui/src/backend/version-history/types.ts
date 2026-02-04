export type VersionHistoryEntry = {
  id: string
  commandId: string
  actionLabel: string | null
  executionState: string
  actorUserId: string | null
  actorUserName: string | null
  resourceKind: string | null
  resourceId: string | null
  createdAt: string
  updatedAt: string
  snapshotBefore?: unknown | null
  snapshotAfter?: unknown | null
  changes?: Record<string, unknown> | null
  context?: Record<string, unknown> | null
}

export type VersionHistoryConfig = {
  resourceKind: string
  resourceId: string
}
