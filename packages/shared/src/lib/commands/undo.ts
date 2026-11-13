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

export type UndoDateRevivalOptions = {
  /** Keys revived from ISO strings to `Date` wherever they appear in the payload (any depth, arrays included). */
  dateFields?: readonly string[]
  /** Dot-separated paths from the payload root revived from ISO strings to `Date`; arrays on the way are walked element-wise. */
  datePaths?: readonly string[]
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
}

function reviveDateValue(value: unknown, field: string): unknown {
  if (typeof value !== 'string') return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`[internal] Invalid ${field} snapshot date: ${value}`)
  }
  return date
}

/**
 * Shallow-clone a snapshot record and revive the named date fields from ISO strings
 * back to `Date`. `null`, `undefined` and existing `Date` values are kept as-is; an
 * unparsable string throws so a corrupt snapshot fails loudly instead of writing a bad row.
 */
export function reviveSnapshotDates<T extends Record<string, unknown>>(value: T, fields: readonly string[]): T {
  const revived: Record<string, unknown> = { ...value }
  for (const field of fields) {
    if (field in revived) revived[field] = reviveDateValue(revived[field], field)
  }
  return revived as T
}

function reviveDateFieldsDeep(value: unknown, fields: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => reviveDateFieldsDeep(item, fields))
  if (!isPlainRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      fields.has(key) ? reviveDateValue(entry, key) : reviveDateFieldsDeep(entry, fields),
    ]),
  )
}

function reviveDatePath(value: unknown, segments: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((item) => reviveDatePath(item, segments))
  if (!isPlainRecord(value) || segments.length === 0) return value
  const [head, ...rest] = segments
  if (!(head in value)) return value
  const entry = value[head]
  return { ...value, [head]: rest.length === 0 ? reviveDateValue(entry, head) : reviveDatePath(entry, rest) }
}

function reviveUndoPayloadDates<T>(payload: T | null, options: UndoDateRevivalOptions | undefined): T | null {
  if (payload === null || payload === undefined || !options) return payload
  let revived: unknown = payload
  if (options.dateFields && options.dateFields.length > 0) {
    revived = reviveDateFieldsDeep(revived, new Set(options.dateFields))
  }
  for (const path of options.datePaths ?? []) {
    const segments = path.split('.').filter((segment) => segment.length > 0)
    if (segments.length > 0) revived = reviveDatePath(revived, segments)
  }
  return revived as T
}

/**
 * Read the undo payload from a command log entry. Snapshots round-trip through `jsonb`,
 * so `Date` values come back as ISO strings; pass `dateFields` / `datePaths` to revive
 * them to `Date` (unparsable strings throw). Without options the raw payload is returned.
 */
export function extractUndoPayload<T>(
  logEntry: UndoLogEntry | null | undefined,
  options?: UndoDateRevivalOptions,
): T | null {
  return reviveUndoPayloadDates(extractRawUndoPayload<T>(logEntry), options)
}

function extractRawUndoPayload<T>(logEntry: UndoLogEntry | null | undefined): T | null {
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
