import * as React from 'react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

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
  const base = parts.length === 2 ? parts[1] : field
  if (base.startsWith('cf_')) return base.slice(3)
  if (base.startsWith('cf:')) return base.slice(3)
  return base
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

export type ChangedFieldsTableProps = {
  changeRows: ChangeRow[]
  noneLabel: string
  t: TranslateFn
  beforeLabel?: string
  afterLabel?: string
}

export function ChangedFieldsTable({ changeRows, noneLabel, t, beforeLabel, afterLabel }: ChangedFieldsTableProps) {
  return (
    <section>
      <h3 className="text-sm font-semibold">
        {t('audit_logs.actions.details.changed_fields')}
      </h3>
      {changeRows.length ? (
        <div className="mt-2 overflow-x-auto rounded-lg border">
          <table className="min-w-full divide-y text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">
                  {t('audit_logs.actions.details.field')}
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">
                  {beforeLabel ?? t('audit_logs.actions.details.before')}
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">
                  {afterLabel ?? t('audit_logs.actions.details.after')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {changeRows.map((row) => (
                <tr key={row.field} className="align-top">
                  <td className="px-4 py-2 align-top font-medium">
                    {humanizeField(normalizeChangeField(row.field))}
                  </td>
                  <td className="px-4 py-2">
                    {renderValue(row.from, noneLabel)}
                  </td>
                  <td className="px-4 py-2">
                    {renderValue(row.to, noneLabel)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {t('audit_logs.actions.details.no_changes')}
        </p>
      )}
    </section>
  )
}

export type CollapsibleJsonSectionProps = {
  label: string
  value: unknown
  truncateAt?: number
}

const DEFAULT_TRUNCATE_AT = 5000

export function CollapsibleJsonSection({ label, value, truncateAt = DEFAULT_TRUNCATE_AT }: CollapsibleJsonSectionProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [showFull, setShowFull] = React.useState(false)

  const stringified = React.useMemo(() => (isOpen ? safeStringify(value) : ''), [isOpen, value])
  const isTruncated = stringified.length > truncateAt
  const displayText = !showFull && isTruncated ? stringified.slice(0, truncateAt) : stringified

  return (
    <details
      className="group rounded-lg border px-4 py-3"
      onToggle={(event) => setIsOpen((event.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-sm font-semibold text-foreground transition-colors group-open:text-primary">
        {label}
      </summary>
      {isOpen ? (
        <>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
            {displayText}
            {!showFull && isTruncated ? '\n…' : null}
          </pre>
          {isTruncated ? (
            <button
              type="button"
              className="mt-1 text-xs text-primary hover:underline"
              onClick={() => setShowFull((prev) => !prev)}
            >
              {showFull ? 'Show less' : `Show all (${Math.ceil(stringified.length / 1024)} KB)`}
            </button>
          ) : null}
        </>
      ) : null}
    </details>
  )
}
