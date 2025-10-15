'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ActionLogItem } from './AuditLogsActions'

type ChangeRow = {
  field: string
  from: unknown
  to: unknown
}

export function ActionLogDetailsDialog({ item, onClose }: { item: ActionLogItem; onClose: () => void }) {
  const t = useT()
  const noneLabel = t('audit_logs.common.none')
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const changeRows = React.useMemo<ChangeRow[]>(() => {
    const source = item.changes
    if (!source || typeof source !== 'object' || Array.isArray(source)) return []
    const before = isRecord(item.snapshotBefore) ? item.snapshotBefore : null
    return Object.entries(source).map(([field, value]) => {
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
  }, [item.changes, item.snapshotBefore])

  const hasContext = !!item.context && typeof item.context === 'object' && Object.keys(item.context).length > 0
  const snapshots = React.useMemo(() => {
    const entries: { label: string; value: unknown }[] = []
    if (item.snapshotBefore != null) {
      entries.push({ label: t('audit_logs.actions.details.snapshot_before'), value: item.snapshotBefore })
    }
    if (item.snapshotAfter != null) {
      entries.push({ label: t('audit_logs.actions.details.snapshot_after'), value: item.snapshotAfter })
    }
    return entries
  }, [item.snapshotAfter, item.snapshotBefore, t])

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex w-full items-end justify-center bg-black/30 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <button
        type="button"
        aria-label={t('audit_logs.actions.details.close')}
        className="absolute inset-0 -z-10 h-full w-full cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-log-details-heading"
        className="relative z-20 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-xl"
      >
        <header className="flex items-start justify-between gap-4 border-b px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('audit_logs.actions.details.title')}
            </p>
            <h2 id="action-log-details-heading" className="truncate text-lg font-semibold">
              {item.actionLabel || item.commandId}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDate(item.createdAt)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('audit_logs.actions.details.close')}
            onClick={onClose}
          >
            <X className="size-5" aria-hidden="true" />
          </Button>
        </header>
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-4 sm:px-6">
          <section className="space-y-3 text-sm">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('audit_logs.actions.columns.action')}
                </dt>
                <dd className="text-sm">{item.actionLabel || item.commandId}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('audit_logs.actions.columns.resource')}
                </dt>
                <dd className="text-sm break-words">
                  {formatResource(item, noneLabel)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('audit_logs.actions.columns.user')}
                </dt>
                <dd className="text-sm">{item.actorUserName || item.actorUserId || noneLabel}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('audit_logs.actions.columns.status')}
                </dt>
                <dd className="text-sm capitalize">{item.executionState}</dd>
              </div>
            </dl>
          </section>

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
                        {t('audit_logs.actions.details.before')}
                      </th>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">
                        {t('audit_logs.actions.details.after')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {changeRows.map((row) => (
                      <tr key={row.field} className="align-top">
                        <td className="px-4 py-2 align-top font-medium">
                          {humanizeField(row.field)}
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

          {hasContext ? (
            <section>
              <details className="group rounded-lg border px-4 py-3">
                <summary className="cursor-pointer text-sm font-semibold text-foreground transition-colors group-open:text-primary">
                  {t('audit_logs.actions.details.context')}
                </summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
                  {safeStringify(item.context)}
                </pre>
              </details>
            </section>
          ) : null}

          {snapshots.length ? (
            <section className="space-y-4">
              {snapshots.map((entry) => (
                <details key={entry.label} className="group rounded-lg border px-4 py-3">
                  <summary className="cursor-pointer text-sm font-semibold text-foreground transition-colors group-open:text-primary">
                    {entry.label}
                  </summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
                    {safeStringify(entry.value)}
                  </pre>
                </details>
              ))}
            </section>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  )
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function humanizeField(field: string) {
  return field
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (s) => s.toUpperCase())
}

function renderValue(value: unknown, fallback: string) {
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

function safeStringify(value: unknown) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatResource(item: Pick<ActionLogItem, 'resourceKind' | 'resourceId'>, fallback: string) {
  if (!item.resourceKind && !item.resourceId) return fallback
  return [item.resourceKind, item.resourceId].filter(Boolean).join(' · ')
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}
