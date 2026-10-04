export type SnapshotRecord = Record<string, unknown>

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function toSnapshotRecord(value: unknown): SnapshotRecord | null {
  const parsed = typeof value === 'string' ? parseJson(value) : value
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as SnapshotRecord) : null
}
