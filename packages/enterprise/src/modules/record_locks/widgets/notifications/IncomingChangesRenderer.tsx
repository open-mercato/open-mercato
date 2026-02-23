'use client'

import * as React from 'react'
import { GitPullRequestArrow, Calendar } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { NotificationRendererProps } from '@open-mercato/shared/modules/notifications/types'

type ChangeRow = {
  field: string
  incoming: string
  current: string
}

function parseRows(notification: NotificationRendererProps['notification']): ChangeRow[] {
  const raw = notification.bodyVariables?.changedRowsJson
  if (!raw || typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((row): row is ChangeRow => (
        row
        && typeof row === 'object'
        && typeof (row as ChangeRow).field === 'string'
        && typeof (row as ChangeRow).incoming === 'string'
        && typeof (row as ChangeRow).current === 'string'
      ))
      .slice(0, 12)
  } catch {
    return []
  }
}

export function IncomingChangesRenderer({ notification }: NotificationRendererProps) {
  const t = useT()
  const rows = React.useMemo(() => parseRows(notification), [notification])
  const isUnread = notification.status === 'unread'

  return (
    <div
      className={cn(
        'group relative px-4 py-3 hover:bg-muted/50 transition-colors border-l-4 border-l-sky-500',
        isUnread && 'bg-sky-50/50 dark:bg-sky-950/20',
      )}
    >
      {isUnread ? (
        <div className="absolute left-1.5 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-primary" />
      ) : null}

      <div className="flex gap-3">
        <div className="mt-0.5 flex-shrink-0">
          <div className="h-10 w-10 rounded-lg bg-sky-100 dark:bg-sky-900/40 flex items-center justify-center">
            <GitPullRequestArrow className="h-5 w-5 text-sky-600 dark:text-sky-400" />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h4 className={cn('text-sm font-medium', isUnread && 'font-semibold')}>
              {notification.title}
            </h4>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {formatRelativeTime(notification.createdAt, { translate: t }) ?? ''}
            </span>
          </div>

          <div className="mt-2 overflow-x-auto rounded border border-border/70">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">{t('record_locks.conflict.field', 'Field')}</th>
                  <th className="px-2 py-1.5 text-left font-medium">{t('record_locks.conflict.incoming_label', 'Incoming')}</th>
                  <th className="px-2 py-1.5 text-left font-medium">{t('record_locks.conflict.current_label', 'Current')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((row, index) => (
                  <tr key={`${row.field}-${index}`} className="border-t border-border/50">
                    <td className="px-2 py-1.5 align-top text-foreground">{row.field}</td>
                    <td className="px-2 py-1.5 align-top text-muted-foreground">{row.incoming}</td>
                    <td className="px-2 py-1.5 align-top text-muted-foreground">{row.current}</td>
                  </tr>
                )) : (
                  <tr>
                    <td className="px-2 py-2 text-muted-foreground" colSpan={3}>
                      {t('record_locks.conflict.no_field_details', 'Field-level conflict details are unavailable for this record. Choose a resolution to continue.')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

export default IncomingChangesRenderer
