"use client"

import * as React from 'react'
import {
  ArrowRight,
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Expand,
  Mail,
  MessageSquare,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { TimelineEntry, TimelineEntryKind } from './types'
import { ALL_TIMELINE_KINDS } from './types'

export const KIND_ICONS: Record<TimelineEntryKind, React.ComponentType<{ className?: string }>> = {
  deal_created: Plus,
  deal_updated: Pencil,
  deal_deleted: Trash2,
  stage_changed: ArrowRight,
  comment_added: MessageSquare,
  activity_logged: Phone,
  email_sent: Send,
  email_received: Mail,
  file_uploaded: Paperclip,
}

export const KIND_BG: Record<TimelineEntryKind, string> = {
  deal_created: 'bg-green-100 dark:bg-green-900/30',
  deal_updated: 'bg-blue-100 dark:bg-blue-900/30',
  deal_deleted: 'bg-red-100 dark:bg-red-900/30',
  stage_changed: 'bg-purple-100 dark:bg-purple-900/30',
  comment_added: 'bg-yellow-100 dark:bg-yellow-900/30',
  activity_logged: 'bg-orange-100 dark:bg-orange-900/30',
  email_sent: 'bg-emerald-100 dark:bg-emerald-900/30',
  email_received: 'bg-cyan-100 dark:bg-cyan-900/30',
  file_uploaded: 'bg-gray-100 dark:bg-gray-800/50',
}

export const KIND_ICON_COLOR: Record<TimelineEntryKind, string> = {
  deal_created: 'text-green-600 dark:text-green-400',
  deal_updated: 'text-blue-600 dark:text-blue-400',
  deal_deleted: 'text-red-600 dark:text-red-400',
  stage_changed: 'text-purple-600 dark:text-purple-400',
  comment_added: 'text-yellow-600 dark:text-yellow-400',
  activity_logged: 'text-orange-600 dark:text-orange-400',
  email_sent: 'text-emerald-600 dark:text-emerald-400',
  email_received: 'text-cyan-600 dark:text-cyan-400',
  file_uploaded: 'text-gray-600 dark:text-gray-400',
}

export function resolveActivityIcon(detail: Record<string, unknown> | null): React.ComponentType<{ className?: string }> {
  const activityType = typeof detail?.activityType === 'string' ? detail.activityType : ''
  if (activityType === 'meeting' || activityType === 'appointment') return Calendar
  if (activityType === 'task' || activityType === 'todo') return CheckSquare
  return Phone
}

export function formatRelativeTime(isoDate: string): string {
  const now = Date.now()
  const then = new Date(isoDate).getTime()
  if (!Number.isFinite(then)) return isoDate
  const diffMs = now - then
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays}d ago`
  return new Date(isoDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatAbsoluteTime(isoDate: string): string {
  const date = new Date(isoDate)
  if (!Number.isFinite(date.getTime())) return isoDate
  return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value.length > 50 ? `${value.slice(0, 50)}...` : value
  if (Array.isArray(value)) return `${value.length} items`
  return String(value)
}

export function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const FIELD_CHANGE_INLINE_THRESHOLD = 2

export type TimelineItemProps = {
  entry: TimelineEntry
  isLast: boolean
  t: TranslateFn
  dealBadge?: React.ReactNode
}

function formatEmailAddress(addr: { email: string; name?: string }): string {
  return addr.name ? `${addr.name} <${addr.email}>` : addr.email
}

function EmailExpandedView({ detail, t }: { detail: Record<string, unknown>; t: TranslateFn }) {
  const bodyText = typeof detail.bodyText === 'string' ? detail.bodyText : null
  const fromAddress = typeof detail.fromAddress === 'string' ? detail.fromAddress : null
  const toAddresses = Array.isArray(detail.toAddresses) ? detail.toAddresses as Array<{ email: string; name?: string }> : []
  const hasAttachments = detail.hasAttachments === true

  return (
    <div className="mt-1.5 space-y-2 border-t pt-2">
      <div className="space-y-1 text-xs text-muted-foreground">
        {fromAddress ? (
          <div>
            <span className="font-medium">{t('customers.deals.timeline.email.from', 'From')}:</span>{' '}
            {fromAddress}
          </div>
        ) : null}
        {toAddresses.length > 0 ? (
          <div>
            <span className="font-medium">{t('customers.deals.timeline.email.to', 'To')}:</span>{' '}
            {toAddresses.map(formatEmailAddress).join(', ')}
          </div>
        ) : null}
        {hasAttachments ? (
          <div className="flex items-center gap-1">
            <Paperclip className="h-3 w-3" />
            <span>{t('customers.deals.timeline.email.hasAttachments', 'Has attachments')}</span>
          </div>
        ) : null}
      </div>
      {bodyText ? (
        <div className="text-xs text-foreground whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto rounded bg-muted/30 p-2">
          {bodyText}
        </div>
      ) : null}
    </div>
  )
}

function EmailModal({
  entry,
  onClose,
  t,
}: {
  entry: TimelineEntry
  onClose: () => void
  t: TranslateFn
}) {
  const detail = entry.detail
  if (!detail) return null

  const subject = typeof detail.subject === 'string' ? detail.subject : entry.summary
  const bodyText = typeof detail.bodyText === 'string' ? detail.bodyText : null
  const fromAddress = typeof detail.fromAddress === 'string' ? detail.fromAddress : null
  const toAddresses = Array.isArray(detail.toAddresses) ? detail.toAddresses as Array<{ email: string; name?: string }> : []
  const hasAttachments = detail.hasAttachments === true
  const isOutbound = entry.kind === 'email_sent'

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div
        className="relative z-10 w-full max-w-2xl max-h-[80vh] flex flex-col rounded-lg border bg-background shadow-xl mx-4"
        role="dialog"
        aria-modal="true"
        aria-label={subject}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            {isOutbound ? <Send className="h-4 w-4 text-emerald-500 shrink-0" /> : <Mail className="h-4 w-4 text-cyan-500 shrink-0" />}
            <h3 className="font-semibold text-sm truncate">{subject}</h3>
          </div>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={t('customers.deals.timeline.email.close', 'Close')}
          >
            <X className="size-4" />
          </IconButton>
        </div>

        <div className="px-4 py-3 border-b space-y-1 text-xs text-muted-foreground">
          {fromAddress ? (
            <div>
              <span className="font-medium">{t('customers.deals.timeline.email.from', 'From')}:</span>{' '}
              {entry.actor.label} &lt;{fromAddress}&gt;
            </div>
          ) : null}
          {toAddresses.length > 0 ? (
            <div>
              <span className="font-medium">{t('customers.deals.timeline.email.to', 'To')}:</span>{' '}
              {toAddresses.map(formatEmailAddress).join(', ')}
            </div>
          ) : null}
          <div>
            <span className="font-medium">{t('customers.deals.timeline.email.date', 'Date')}:</span>{' '}
            {formatAbsoluteTime(entry.occurredAt)}
          </div>
          {hasAttachments ? (
            <div className="flex items-center gap-1">
              <Paperclip className="h-3 w-3" />
              <span>{t('customers.deals.timeline.email.hasAttachments', 'Has attachments')}</span>
            </div>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {bodyText ? (
            <div className="text-sm text-foreground whitespace-pre-wrap break-words">
              {bodyText}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              {t('customers.deals.timeline.email.noBody', 'No email body available.')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export function TimelineItem({ entry, isLast, t, dealBadge }: TimelineItemProps) {
  const [changesExpanded, setChangesExpanded] = React.useState(false)
  const [emailExpanded, setEmailExpanded] = React.useState(false)
  const [emailModalOpen, setEmailModalOpen] = React.useState(false)
  const IconComponent = entry.kind === 'activity_logged'
    ? resolveActivityIcon(entry.detail)
    : KIND_ICONS[entry.kind]
  const bgClass = KIND_BG[entry.kind]
  const iconColorClass = KIND_ICON_COLOR[entry.kind]

  const changes = entry.changes
  const hasChanges = changes && changes.length > 0
  const showInline = hasChanges && changes.length <= FIELD_CHANGE_INLINE_THRESHOLD
  const showCollapsed = hasChanges && changes.length > FIELD_CHANGE_INLINE_THRESHOLD

  return (
    <div className="relative flex gap-3">
      {!isLast ? (
        <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border" aria-hidden />
      ) : null}
      <div
        className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border ${bgClass}`}
      >
        <IconComponent className={`h-3 w-3 ${iconColorClass}`} aria-hidden />
      </div>
      <div className="flex-1 pb-4">
        <div className="rounded-lg border bg-card p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-medium text-foreground truncate">{entry.actor.label}</span>
              {dealBadge}
            </div>
            <span
              className="text-[11px] text-muted-foreground shrink-0"
              title={formatAbsoluteTime(entry.occurredAt)}
            >
              {formatRelativeTime(entry.occurredAt)}
            </span>
          </div>
          <p className="text-sm text-foreground">{entry.summary}</p>

          {entry.kind === 'stage_changed' && entry.detail ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {typeof entry.detail.durationSeconds === 'number' && entry.detail.durationSeconds > 0 ? (
                <span className="rounded bg-muted px-1.5 py-0.5">
                  {formatDuration(entry.detail.durationSeconds as number)}
                </span>
              ) : null}
            </div>
          ) : null}

          {(entry.kind === 'email_sent' || entry.kind === 'email_received') && entry.detail ? (
            <div>
              {!emailExpanded && typeof entry.detail.bodyPreview === 'string' ? (
                <p className="text-xs text-muted-foreground line-clamp-2">{entry.detail.bodyPreview}</p>
              ) : null}
              {emailExpanded ? (
                <EmailExpandedView detail={entry.detail} t={t} />
              ) : null}
              <div className="flex items-center gap-1 mt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-1 py-0.5 text-xs text-muted-foreground"
                  onClick={() => setEmailExpanded((prev) => !prev)}
                >
                  {emailExpanded ? (
                    <ChevronUp className="mr-1 h-3 w-3" />
                  ) : (
                    <ChevronDown className="mr-1 h-3 w-3" />
                  )}
                  {emailExpanded
                    ? t('customers.deals.timeline.email.collapse', 'Collapse')
                    : t('customers.deals.timeline.email.expand', 'Read more')}
                </Button>
                {typeof entry.detail.bodyText === 'string' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto px-1 py-0.5 text-xs text-muted-foreground"
                    onClick={() => setEmailModalOpen(true)}
                  >
                    <Expand className="mr-1 h-3 w-3" />
                    {t('customers.deals.timeline.email.openFull', 'Open')}
                  </Button>
                ) : null}
              </div>
              {emailModalOpen ? (
                <EmailModal entry={entry} onClose={() => setEmailModalOpen(false)} t={t} />
              ) : null}
            </div>
          ) : null}

          {entry.kind === 'file_uploaded' && entry.detail ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {typeof entry.detail.fileSize === 'number' ? (
                <span>{formatFileSize(entry.detail.fileSize as number)}</span>
              ) : null}
            </div>
          ) : null}

          {showInline ? (
            <div className="space-y-0.5">
              {changes.map((change) => (
                <div key={change.field} className="text-xs text-muted-foreground">
                  <span className="font-medium">{change.label}</span>:{' '}
                  <span className="line-through opacity-60">{formatFieldValue(change.from)}</span>
                  {' \u2192 '}
                  <span>{formatFieldValue(change.to)}</span>
                </div>
              ))}
            </div>
          ) : null}

          {showCollapsed ? (
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto px-1 py-0.5 text-xs text-muted-foreground"
                onClick={() => setChangesExpanded((prev) => !prev)}
              >
                <ChevronDown
                  className={`mr-1 h-3 w-3 transition-transform ${changesExpanded ? 'rotate-180' : ''}`}
                />
                {changesExpanded
                  ? t('customers.deals.timeline.hideChanges', 'Hide changes')
                  : t('customers.deals.timeline.showChanges', 'Show {count} changes', { count: changes.length })}
              </Button>
              {changesExpanded ? (
                <div className="mt-1 space-y-0.5">
                  {changes.map((change) => (
                    <div key={change.field} className="text-xs text-muted-foreground">
                      <span className="font-medium">{change.label}</span>:{' '}
                      <span className="line-through opacity-60">{formatFieldValue(change.from)}</span>
                      {' \u2192 '}
                      <span>{formatFieldValue(change.to)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export type FilterState = Set<TimelineEntryKind>

export function FilterDropdown({
  selected,
  onChange,
  t,
}: {
  selected: FilterState
  onChange: (next: FilterState) => void
  t: TranslateFn
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const allSelected = selected.size === 0

  React.useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const kindLabels: Record<TimelineEntryKind, string> = {
    deal_created: t('customers.deals.timeline.kind.deal_created', 'Deal created'),
    deal_updated: t('customers.deals.timeline.kind.deal_updated', 'Deal updated'),
    deal_deleted: t('customers.deals.timeline.kind.deal_deleted', 'Deal deleted'),
    stage_changed: t('customers.deals.timeline.kind.stage_changed', 'Stage changed'),
    comment_added: t('customers.deals.timeline.kind.comment_added', 'Comment added'),
    activity_logged: t('customers.deals.timeline.kind.activity_logged', 'Activity logged'),
    email_sent: t('customers.deals.timeline.kind.email_sent', 'Email sent'),
    email_received: t('customers.deals.timeline.kind.email_received', 'Email received'),
    file_uploaded: t('customers.deals.timeline.kind.file_uploaded', 'File uploaded'),
  }

  function toggle(kind: TimelineEntryKind) {
    const next = new Set(selected)
    if (next.has(kind)) {
      next.delete(kind)
    } else {
      next.add(kind)
    }
    onChange(next)
  }

  function selectAll() {
    onChange(new Set())
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() => setOpen((prev) => !prev)}
      >
        {t('customers.deals.timeline.filterLabel', 'Filter')}
        {!allSelected ? ` (${selected.size})` : ''}
        <ChevronDown className={`ml-1 h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </Button>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-lg border bg-card p-2 shadow-lg">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start text-xs h-auto py-1"
            onClick={selectAll}
          >
            {t('customers.deals.timeline.filterAll', 'All events')}
          </Button>
          <div className="my-1 border-t" />
          {ALL_TIMELINE_KINDS.map((kind) => {
            const checked = allSelected || selected.has(kind)
            return (
              <label
                key={kind}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  className="rounded border-border"
                  checked={checked}
                  onChange={() => toggle(kind)}
                />
                <span>{kindLabels[kind]}</span>
              </label>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
