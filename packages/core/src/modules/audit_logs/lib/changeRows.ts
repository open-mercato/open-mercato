export type ChangeRow = {
  field: string
  from: unknown
  to: unknown
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readPathValue(source: unknown, field: string): unknown {
  if (!isRecord(source)) return undefined

  return field.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current)) return undefined
    return current[segment]
  }, source)
}

function normalizeChangeRow(field: string, value: unknown, snapshotBefore: unknown): ChangeRow {
  const beforeValue = readPathValue(snapshotBefore, field)

  if (isRecord(value) && ('from' in value || 'to' in value || 'old' in value || 'new' in value)) {
    return {
      field,
      from: value.from ?? value.old ?? beforeValue,
      to: value.to ?? value.new ?? null,
    }
  }

  return {
    field,
    from: beforeValue,
    to: value,
  }
}

export function extractChangeRows(
  changes: Record<string, unknown> | null | undefined,
  snapshotBefore: unknown,
): ChangeRow[] {
  if (!isRecord(changes)) return []

  return Object.entries(changes)
    .map(([field, value]) => normalizeChangeRow(field, value, snapshotBefore))
    .sort((left, right) => left.field.localeCompare(right.field))
}
