type UndoSnapshot = {
  before?: unknown | null
  after?: unknown | null
}

export type UndoPayload<T> = {
  before?: T | null
  after?: T | null
}

export type UndoEnvelope<T> = {
  undo?: T
  value?: { undo?: T }
  __redoInput?: unknown
  [key: string]: unknown
}

type UndoLogEntry = {
  commandPayload?: unknown | null
  payload?: unknown | null
  snapshotBefore?: unknown | null
  snapshotAfter?: unknown | null
} & UndoSnapshot

function snapshotFallback<T>(logEntry: UndoLogEntry): T | null {
  const before = logEntry.snapshotBefore
  const after = logEntry.snapshotAfter
  if (before === undefined && after === undefined) return null
  if (before === null && after === null) return null
  return { before: before ?? null, after: after ?? null } as T
}

export function extractUndoPayload<T>(logEntry: UndoLogEntry | null | undefined): T | null {
  if (!logEntry) return null
  const rawPayload = logEntry.commandPayload ?? logEntry.payload
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return snapshotFallback(logEntry)
  }
  const payload = rawPayload as UndoEnvelope<T>
  if (payload.undo) return payload.undo
  if (payload.value && typeof payload.value === 'object' && payload.value.undo) {
    return payload.value.undo as T
  }
  for (const [key, value] of Object.entries(payload)) {
    if (key === '__redoInput') continue
    if (value && typeof value === 'object' && 'undo' in value) {
      const undo = (value as { undo?: T }).undo
      if (undo !== undefined) return undo ?? null
    }
  }
  return snapshotFallback(logEntry)
}
