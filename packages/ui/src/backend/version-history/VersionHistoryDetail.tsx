"use client"

import * as React from 'react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { VersionHistoryEntry } from './types'
import { getVersionHistoryStatusLabel } from './labels'
import {
  ChangedFieldsTable,
  CollapsibleJsonSection,
  extractChangeRows,
  formatDate,
} from '@open-mercato/core/modules/audit_logs/lib/display-helpers'

export type VersionHistoryDetailProps = {
  entry: VersionHistoryEntry
  t: TranslateFn
}

export function VersionHistoryDetail({ entry, t }: VersionHistoryDetailProps) {
  const noneLabel = t('audit_logs.common.none')
  const statusLabel = getVersionHistoryStatusLabel(entry.executionState, t)
  const changeRows = React.useMemo(
    () => extractChangeRows(entry.changes, entry.snapshotBefore),
    [entry.changes, entry.snapshotBefore],
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
            <dd className="text-sm">{statusLabel}</dd>
          </div>
        </dl>
      </section>

      <ChangedFieldsTable changeRows={changeRows} noneLabel={noneLabel} t={t} />

      {hasContext ? (
        <section>
          <CollapsibleJsonSection label={t('audit_logs.actions.details.context')} value={entry.context} />
        </section>
      ) : null}

      {snapshots.length ? (
        <section className="space-y-4">
          {snapshots.map((snapshot) => (
            <CollapsibleJsonSection key={snapshot.label} label={snapshot.label} value={snapshot.value} />
          ))}
        </section>
      ) : null}
    </div>
  )
}
