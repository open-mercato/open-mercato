"use client"

import * as React from 'react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { VersionHistoryEntry } from './types'
import { InjectionSpot } from '../injection/InjectionSpot'
import { VERSION_HISTORY_ENTRY_AFTER_INJECTION_SPOT_ID } from '../injection/spotIds'
import { getVersionHistoryActionLabel, getVersionHistoryStatusLabel } from './labels'
import {
  ChangedFieldsTable,
  CollapsibleJsonSection,
  extractChangeRows,
  formatDate,
} from '@open-mercato/core/modules/audit_logs/lib/display-helpers'

export type VersionHistoryEntryInjectionContext = {
  logId: string
  resourceKind: string | null
  resourceId: string | null
}

export type VersionHistoryDetailProps = {
  entry: VersionHistoryEntry
  t: TranslateFn
}

export function VersionHistoryDetail({ entry, t }: VersionHistoryDetailProps) {
  const noneLabel = t('audit_logs.common.none')
  const statusLabel = getVersionHistoryStatusLabel(entry.executionState, t)
  const actionLabel = getVersionHistoryActionLabel(entry, t)
  const changeRows = React.useMemo(
    () => extractChangeRows(entry.changes, entry.snapshotBefore),
    [entry.changes, entry.snapshotBefore],
  )
  const entryInjectionContext = React.useMemo<VersionHistoryEntryInjectionContext>(
    () => ({ logId: entry.id, resourceKind: entry.resourceKind ?? null, resourceId: entry.resourceId ?? null }),
    [entry.id, entry.resourceKind, entry.resourceId],
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
            <dd className="break-words text-sm">{actionLabel}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('audit_logs.version_history.detail.date')}
            </dt>
            <dd className="break-words text-sm">{formatDate(entry.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('audit_logs.version_history.detail.actor')}
            </dt>
            <dd className="break-words text-sm">{entry.actorUserName || entry.actorUserId || noneLabel}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('audit_logs.version_history.detail.status')}
            </dt>
            <dd className="break-words text-sm">{statusLabel}</dd>
          </div>
        </dl>
      </section>

      <section className="empty:hidden">
        <InjectionSpot spotId={VERSION_HISTORY_ENTRY_AFTER_INJECTION_SPOT_ID} context={entryInjectionContext} />
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
