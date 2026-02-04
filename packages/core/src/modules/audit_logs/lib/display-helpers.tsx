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

export function normalizeChangeField(field: string) {
  const parts = field.split('.')
  if (parts.length === 2) {
    return parts[1]
  }
  return field
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
