"use client"

import * as React from 'react'
import {
  ChevronDown,
  ChevronUp,
  Expand,
  Mail,
  Paperclip,
  Send,
  X,
} from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { TimelineEntry, TimelinePanelConfig } from '@open-mercato/shared/modules/timeline/types'

// --- Formatting utilities ---

export function formatRelativeTime(isoDate: string): string {
  const now = Date.now()
  const then = new Date(isoDate).getTime()
  if (!Number.isFinite(then)) return isoDate
  const diffMs = now - then
  if (diffMs < 0) {
    const absDiffSec = Math.abs(diffMs) / 1000
    if (absDiffSec < 60) return 'in <1m'
    if (absDiffSec < 3600) return `in ${Math.round(absDiffSec / 60)}m`
    if (absDiffSec < 86400) return `in ${Math.round(absDiffSec / 3600)}h`
    return `in ${Math.round(absDiffSec / 86400)}d`
  }
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
  if (seconds <= 0) return '< 1m'
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

// --- Internal components ---

const FIELD_CHANGE_INLINE_THRESHOLD = 2

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
            <span className="font-medium">{t('timeline.email.from', 'From')}:</span>{' '}
            {fromAddress}
          </div>
        ) : null}
        {toAddresses.length > 0 ? (
          <div>
            <span className="font-medium">{t('timeline.email.to', 'To')}:</span>{' '}
            {toAddresses.map(formatEmailAddress).join(', ')}
          </div>
        ) : null}
        {hasAttachments ? (
          <div className="flex items-center gap-1">
            <Paperclip className="h-3 w-3" />
            <span>{t('timeline.email.hasAttachments', 'Has attachments')}</span>
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
  const isOutbound = entry.kind.includes('sent')

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
            aria-label={t('timeline.email.close', 'Close')}
          >
            <X className="size-4" />
          </IconButton>
        </div>

        <div className="px-4 py-3 border-b space-y-1 text-xs text-muted-foreground">
          {fromAddress ? (
            <div>
              <span className="font-medium">{t('timeline.email.from', 'From')}:</span>{' '}
              {entry.actor.label} &lt;{fromAddress}&gt;
            </div>
          ) : null}
          {toAddresses.length > 0 ? (
            <div>
              <span className="font-medium">{t('timeline.email.to', 'To')}:</span>{' '}
              {toAddresses.map(formatEmailAddress).join(', ')}
            </div>
          ) : null}
          <div>
            <span className="font-medium">{t('timeline.email.date', 'Date')}:</span>{' '}
            {formatAbsoluteTime(entry.occurredAt)}
          </div>
          {hasAttachments ? (
            <div className="flex items-center gap-1">
              <Paperclip className="h-3 w-3" />
              <span>{t('timeline.email.hasAttachments', 'Has attachments')}</span>
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
              {t('timeline.email.noBody', 'No email body available.')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// --- Main component ---

export type TimelineItemProps<K extends string = string> = {
  entry: TimelineEntry<K>
  isLast: boolean
  t: TranslateFn
  config: TimelinePanelConfig<K>
  badge?: React.ReactNode
}

export function TimelineItem<K extends string>({ entry, isLast, t, config, badge }: TimelineItemProps<K>) {
  const [changesExpanded, setChangesExpanded] = React.useState(false)
  const [emailExpanded, setEmailExpanded] = React.useState(false)
  const [emailModalOpen, setEmailModalOpen] = React.useState(false)

  const kind = entry.kind as K
  const IconComponent = config.resolveActivityIcon && kind === ('activity_logged' as K)
    ? config.resolveActivityIcon(entry.detail)
    : config.kindIcons[kind]
  const bgClass = config.kindBgColors[kind] ?? ''
  const iconColorClass = config.kindIconColors[kind] ?? ''

  const changes = entry.changes
  const hasChanges = changes && changes.length > 0
  const showInline = hasChanges && changes.length <= FIELD_CHANGE_INLINE_THRESHOLD
  const showCollapsed = hasChanges && changes.length > FIELD_CHANGE_INLINE_THRESHOLD

  const isEmail = kind === ('email_sent' as K) || kind === ('email_received' as K)
  const isStageChanged = kind === ('stage_changed' as K)
  const isFileUploaded = kind === ('file_uploaded' as K)

  return (
    <div className="relative flex gap-3">
      {!isLast ? (
        <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border" aria-hidden />
      ) : null}
      <div
        className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border ${bgClass}`}
      >
        {IconComponent ? <IconComponent className={`h-3 w-3 ${iconColorClass}`} aria-hidden /> : null}
      </div>
      <div className="flex-1 pb-4">
        <div className="rounded-lg border bg-card p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-medium text-foreground truncate">{entry.actor.label}</span>
              {badge}
            </div>
            <span
              className="text-[11px] text-muted-foreground shrink-0"
              title={formatAbsoluteTime(entry.occurredAt)}
            >
              {formatRelativeTime(entry.occurredAt)}
            </span>
          </div>
          <p className="text-sm text-foreground">{entry.summary}</p>

          {isStageChanged && entry.detail ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {typeof entry.detail.durationSeconds === 'number' && entry.detail.durationSeconds > 0 ? (
                <span className="rounded bg-muted px-1.5 py-0.5">
                  {formatDuration(entry.detail.durationSeconds as number)}
                </span>
              ) : null}
            </div>
          ) : null}

          {isEmail && entry.detail ? (
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
                    ? t('timeline.email.collapse', 'Collapse')
                    : t('timeline.email.expand', 'Read more')}
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
                    {t('timeline.email.openFull', 'Open')}
                  </Button>
                ) : null}
              </div>
              {emailModalOpen ? (
                <EmailModal entry={entry} onClose={() => setEmailModalOpen(false)} t={t} />
              ) : null}
            </div>
          ) : null}

          {isFileUploaded && entry.detail ? (
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
                  ? t('timeline.hideChanges', 'Hide changes')
                  : t('timeline.showChanges', 'Show {count} changes', { count: changes.length })}
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
