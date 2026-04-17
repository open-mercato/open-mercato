'use client'

import * as React from 'react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Settings2, SquarePen, Plus, Trash2, UserRoundPlus, ArrowRight } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { getInitials } from './utils'

type ChangelogActionType = 'create' | 'edit' | 'delete' | 'assign' | 'system'
type ChangelogSource = 'ui' | 'api' | 'system'

type ChangelogEntryRowProps = {
  entry: {
    id: string
    createdAt: string
    actorUserId: string | null
    actorUserName: string | null
    actionType: ChangelogActionType
    source: ChangelogSource
    description: string | null
    changes: Array<{
      fieldName: string
      oldValue: string
      newValue: string
    }>
  }
}

const ACTION_ICONS: Record<ChangelogActionType, React.ComponentType<{ className?: string }>> = {
  create: Plus,
  edit: SquarePen,
  delete: Trash2,
  assign: UserRoundPlus,
  system: Settings2,
}

function formatFieldLabel(fieldName: string): string {
  return fieldName
    .replace(/\./g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase())
}

function formatRelativeTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const diffMs = date.getTime() - Date.now()
  const diffMinutes = Math.round(diffMs / 60000)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  if (Math.abs(diffMinutes) < 60) return formatter.format(diffMinutes, 'minute')

  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) return formatter.format(diffHours, 'hour')

  const diffDays = Math.round(diffHours / 24)
  return formatter.format(diffDays, 'day')
}

export function ChangelogEntryRow({ entry }: ChangelogEntryRowProps) {
  const t = useT()
  const ActionIcon = ACTION_ICONS[entry.actionType]
  const createdAt = new Date(entry.createdAt)
  const timeLabel = Number.isNaN(createdAt.getTime())
    ? '00:00'
    : createdAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const relativeLabel = formatRelativeTime(entry.createdAt)
  const actorLabel = entry.actorUserName ?? t('customers.changelog.user.system', 'System')
  const actionLabel = t(`customers.changelog.actions.${entry.actionType}`, formatFieldLabel(entry.actionType))
  const sourceLabel = entry.source === 'api'
    ? t('customers.changelog.source.api', 'API')
    : entry.source === 'system'
      ? t('customers.changelog.source.system', 'System')
      : t('customers.changelog.source.ui', 'UI')

  return (
    <div className="grid grid-cols-[92px_190px_120px_1fr_80px] gap-3 px-5 py-3 text-sm">
      <div className="space-y-0.5">
        <div className="font-medium text-foreground">{timeLabel}</div>
        <div className="text-xs text-muted-foreground">{relativeLabel}</div>
      </div>

      <div className="flex items-start gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
          {entry.actorUserId ? getInitials(actorLabel) : <Settings2 className="size-3.5" />}
        </div>
        <span className="truncate pt-1 text-sm text-foreground">{actorLabel}</span>
      </div>

      <div className="flex items-start gap-2 pt-0.5 text-sm text-foreground">
        <ActionIcon className="mt-0.5 size-4 text-muted-foreground" />
        <span>{actionLabel}</span>
      </div>

      <div className="min-w-0 space-y-1.5">
        {entry.changes.length > 0 ? (
          entry.changes.map((change) => (
            <div key={`${entry.id}-${change.fieldName}`} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-foreground">{formatFieldLabel(change.fieldName)}</span>
              <Badge
                variant="outline"
                className="max-w-[12rem] rounded-full border-status-error-border bg-status-error-bg px-2 py-0.5 text-xs font-medium text-status-error-text"
              >
                <span className="truncate">{change.oldValue || '—'}</span>
              </Badge>
              <ArrowRight className="size-3.5 text-muted-foreground" />
              <Badge
                variant="outline"
                className="max-w-[12rem] rounded-full border-status-success-border bg-status-success-bg px-2 py-0.5 text-xs font-medium text-status-success-text"
              >
                <span className="truncate">{change.newValue || '—'}</span>
              </Badge>
            </div>
          ))
        ) : (
          <span className="text-sm text-muted-foreground">{entry.description ?? actionLabel}</span>
        )}
      </div>

      <div className="flex items-start justify-end">
        <Badge variant="secondary" className="px-1.5 py-0 text-xs">
          {sourceLabel}
        </Badge>
      </div>
    </div>
  )
}

export default ChangelogEntryRow
