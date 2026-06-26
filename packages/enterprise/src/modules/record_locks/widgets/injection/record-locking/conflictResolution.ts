import type { RecordLockUiConflict } from '@open-mercato/enterprise/modules/record_locks/lib/clientLockStore'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: string | null | undefined): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  return UUID_PATTERN.test(trimmed)
}

export function resolveConflictId(
  conflict: Pick<RecordLockUiConflict, 'id'> | null | undefined,
): string | null {
  const id = conflict?.id
  return isUuid(id) ? id : null
}

export type AcceptIncomingOutcome = 'released' | 'reloaded' | 'skipped'

export type AcceptIncomingFlow = {
  conflict: RecordLockUiConflict | null | undefined
  resourceKind: string | null | undefined
  resourceId: string | null | undefined
  revalidateConflictId: () => Promise<string | null>
  releaseIncoming: (conflictId: string) => Promise<void>
  clearConflictState: () => void
  reload: () => void
}

export async function runAcceptIncoming(flow: AcceptIncomingFlow): Promise<AcceptIncomingOutcome> {
  if (!flow.conflict || !flow.resourceKind || !flow.resourceId) return 'skipped'
  let conflictId = resolveConflictId(flow.conflict)
  if (!conflictId) {
    conflictId = await flow.revalidateConflictId()
  }
  if (conflictId) {
    await flow.releaseIncoming(conflictId)
  }
  flow.clearConflictState()
  flow.reload()
  return conflictId ? 'released' : 'reloaded'
}
