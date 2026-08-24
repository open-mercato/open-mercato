import * as React from 'react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@open-mercato/ui/primitives/accordion'
import type { ChangeRow } from './changeRows'
import { isRecord } from './changeRows'
export { extractChangeRows, isRecord } from './changeRows'
export type { ChangeRow } from './changeRows'

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
  if (typeof value === 'string') return <span className="wrap-anywhere">{value}</span>
  return (
    <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap wrap-anywhere rounded-md bg-muted/50 px-2 py-1 text-xs leading-5 text-muted-foreground">
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

export type ChangedFieldsTableProps = {
  changeRows: ChangeRow[]
  noneLabel: string
  t: TranslateFn
  beforeLabel?: string
  afterLabel?: string
}

export function ChangedFieldsTable({ changeRows, noneLabel, t, beforeLabel, afterLabel }: ChangedFieldsTableProps) {
  const beforeHeading = beforeLabel ?? t('audit_logs.actions.details.before')
  const afterHeading = afterLabel ?? t('audit_logs.actions.details.after')
  return (
    <section>
      <h3 className="text-sm font-semibold">
        {t('audit_logs.actions.details.changed_fields')}
      </h3>
      {changeRows.length ? (
        <div className="@container/changes mt-2">
          <div className="overflow-x-auto rounded-lg border">
            <table className="block w-full divide-y text-sm @lg/changes:table @lg/changes:min-w-full">
              <thead className="hidden bg-muted/50 @lg/changes:table-header-group">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">
                    {t('audit_logs.actions.details.field')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">
                    {beforeHeading}
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">
                    {afterHeading}
                  </th>
                </tr>
              </thead>
              <tbody className="block divide-y @lg/changes:table-row-group">
                {changeRows.map((row) => (
                  <tr key={row.field} className="block px-4 py-3 align-top @lg/changes:table-row @lg/changes:p-0">
                    <td className="block font-medium @lg/changes:table-cell @lg/changes:px-4 @lg/changes:py-2 @lg/changes:align-top">
                      {humanizeField(normalizeChangeField(row.field))}
                    </td>
                    <td className="mt-2 block @lg/changes:mt-0 @lg/changes:table-cell @lg/changes:px-4 @lg/changes:py-2">
                      <span className="mb-0.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground @lg/changes:hidden">
                        {beforeHeading}
                      </span>
                      {renderValue(row.from, noneLabel)}
                    </td>
                    <td className="mt-2 block @lg/changes:mt-0 @lg/changes:table-cell @lg/changes:px-4 @lg/changes:py-2">
                      <span className="mb-0.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground @lg/changes:hidden">
                        {afterHeading}
                      </span>
                      {renderValue(row.to, noneLabel)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

const COLLAPSIBLE_JSON_ITEM_VALUE = 'open'

export function CollapsibleJsonSection({ label, value, truncateAt = DEFAULT_TRUNCATE_AT }: CollapsibleJsonSectionProps) {
  const [openValue, setOpenValue] = React.useState<string>('')
  const [showFull, setShowFull] = React.useState(false)

  const isOpen = openValue === COLLAPSIBLE_JSON_ITEM_VALUE
  const stringified = React.useMemo(() => (isOpen ? safeStringify(value) : ''), [isOpen, value])
  const isTruncated = stringified.length > truncateAt
  const displayText = !showFull && isTruncated ? stringified.slice(0, truncateAt) : stringified

  return (
    <Accordion type="single" collapsible value={openValue} onValueChange={setOpenValue}>
      <AccordionItem value={COLLAPSIBLE_JSON_ITEM_VALUE}>
        <AccordionTrigger>
          <span className="font-semibold text-foreground group-data-[state=open]/accordion-trigger:text-primary">
            {label}
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
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
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
