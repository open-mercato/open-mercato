import * as React from 'react'

export type ChangeRow = {
  field: string
  from: unknown
  to: unknown
}

export function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function humanizeField(field: string) {
  return field
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (s) => s.toUpperCase())
}

export function renderValue(value: unknown, fallback: string) {
  if (value === undefined || value === null || value === '') {
    return <span className="text-muted-foreground">{fallback}</span>
  }
  if (typeof value === 'boolean') return <span>{value ? 'true' : 'false'}</span>
  if (typeof value === 'number' || typeof value === 'bigint') return <span>{String(value)}</span>
  if (value instanceof Date) return <span>{value.toISOString()}</span>
  if (typeof value === 'string') return <span className="break-words">{value}</span>
  return (
    <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 px-2 py-1 text-xs leading-5 text-muted-foreground">
      {safeStringify(value)}
    </pre>
  )
}

export function safeStringify(value: unknown) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function formatResource(
  item: { resourceKind: string | null; resourceId: string | null },
  fallback: string,
) {
  if (!item.resourceKind && !item.resourceId) return fallback
  return [item.resourceKind, item.resourceId].filter(Boolean).join(' · ')
}

export function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function extractChangeRows(
  changes: Record<string, unknown> | null | undefined,
  snapshotBefore: unknown,
): ChangeRow[] {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return []
  const before = isRecord(snapshotBefore) ? snapshotBefore : null
  return Object.entries(changes).map(([field, value]) => {
    if (isRecord(value) && ('from' in value || 'to' in value)) {
      const from = (value as Record<string, unknown>).from ?? before?.[field]
      const to = (value as Record<string, unknown>).to ?? null
      return { field, from, to }
    }
    return {
      field,
      from: before?.[field],
      to: value,
    }
  }).sort((a, b) => a.field.localeCompare(b.field))
}

type DiffEntry = {
  field: string
  from: unknown
  to: unknown
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a instanceof Date || b instanceof Date) {
    const aDate = a instanceof Date ? a : null
    const bDate = b instanceof Date ? b : null
    return aDate?.toISOString?.() === bDate?.toISOString?.()
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((value, index) => deepEqual(value, b[index]))
  }
  if (isRecord(a) && isRecord(b)) {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    return keysA.every((key) => deepEqual(a[key], b[key]))
  }
  return false
}

function buildSnapshotDiff(
  before: unknown,
  after: unknown,
  prefix = '',
  depth = 0,
  maxDepth = 2,
): DiffEntry[] {
  if (!isRecord(before) || !isRecord(after)) {
    if (deepEqual(before, after)) return []
    return [{ field: prefix || 'value', from: before, to: after }]
  }

  const entries: DiffEntry[] = []
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of Array.from(keys).sort()) {
    const from = before[key]
    const to = after[key]
    if (isRecord(from) && isRecord(to) && depth < maxDepth) {
      entries.push(...buildSnapshotDiff(from, to, `${prefix}${key}.`, depth + 1, maxDepth))
      continue
    }
    if (deepEqual(from, to)) continue
    entries.push({ field: `${prefix}${key}`, from, to })
  }
  return entries
}

export function extractChangeRowsFromSnapshots(
  snapshotBefore: unknown,
  snapshotAfter: unknown,
): ChangeRow[] {
  if (snapshotBefore == null || snapshotAfter == null) return []
  return buildSnapshotDiff(snapshotBefore, snapshotAfter)
    .map((entry) => ({ field: entry.field, from: entry.from, to: entry.to }))
    .sort((a, b) => a.field.localeCompare(b.field))
}
