'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ActionLogItem } from './AuditLogsActions'
import {
  ChangedFieldsTable,
  CollapsibleJsonSection,
  extractChangeRows,
  formatDate,
  formatResource,
} from '../lib/display-helpers'

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

  const changeRows = React.useMemo(
    () => extractChangeRows(item.changes, item.snapshotBefore),
    [item.changes, item.snapshotBefore],
  )

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

          <ChangedFieldsTable changeRows={changeRows} noneLabel={noneLabel} t={t} />

          {hasContext ? (
            <section>
              <CollapsibleJsonSection label={t('audit_logs.actions.details.context')} value={item.context} />
            </section>
          ) : null}

          {snapshots.length ? (
            <section className="space-y-4">
              {snapshots.map((entry) => (
                <CollapsibleJsonSection key={entry.label} label={entry.label} value={entry.value} />
              ))}
            </section>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  )
}
