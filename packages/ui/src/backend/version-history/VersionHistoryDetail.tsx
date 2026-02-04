"use client"

import * as React from 'react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { VersionHistoryEntry } from './types'
import {
  extractChangeRows,
  getChangeRows,
  formatDate,
  humanizeField,
  normalizeChangeField,
  renderValue,
  safeStringify,
} from '@open-mercato/core/modules/audit_logs/lib/display-helpers'

export type VersionHistoryDetailProps = {
  entry: VersionHistoryEntry
  t: TranslateFn
}

export function VersionHistoryDetail({ entry, t }: VersionHistoryDetailProps) {
  const noneLabel = t('audit_logs.common.none')
  const changeRows = React.useMemo(
    () => getChangeRows({ changes: entry.changes, snapshotBefore: entry.snapshotBefore, snapshotAfter: entry.snapshotAfter }),
    [entry.changes, entry.snapshotAfter, entry.snapshotBefore],
  )
  const hasContext = !!entry.context && typeof entry.context === 'object' && Object.keys(entry.context).length > 0
  const snapshots = React.useMemo(() => {
    const items: { label: string; value: unknown }[] = []
    if (entry.snapshotBefore != null) {
      items.push({ label: t('audit_logs.actions.details.snapshot_before'), value: entry.snapshotBefore })
    }
    if (entry.snapshotAfter != null) {
      items.push({ label: t('audit_logs.actions.details.snapshot_after'), value: entry.snapshotAfter })
    }
    return items
  }, [entry.snapshotAfter, entry.snapshotBefore, t])

  return (
    <div className="flex flex-1 flex-col gap-6">
      <section className="space-y-3 text-sm">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('audit_logs.version_history.detail.action')}
            </dt>
            <dd className="text-sm">{entry.actionLabel || entry.commandId}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('audit_logs.version_history.detail.date')}
            </dt>
            <dd className="text-sm">{formatDate(entry.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('audit_logs.version_history.detail.actor')}
            </dt>
            <dd className="text-sm">{entry.actorUserName || entry.actorUserId || noneLabel}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('audit_logs.version_history.detail.status')}
            </dt>
            <dd className="text-sm capitalize">{entry.executionState}</dd>
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

      {hasContext ? (
        <section>
          <details className="group rounded-lg border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-foreground transition-colors group-open:text-primary">
              {t('audit_logs.actions.details.context')}
            </summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
              {safeStringify(entry.context)}
            </pre>
          </details>
        </section>
      ) : null}

      {snapshots.length ? (
        <section className="space-y-4">
          {snapshots.map((snapshot) => (
            <details key={snapshot.label} className="group rounded-lg border px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold text-foreground transition-colors group-open:text-primary">
                {snapshot.label}
              </summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
                {safeStringify(snapshot.value)}
              </pre>
            </details>
          ))}
        </section>
      ) : null}
    </div>
  )
}
