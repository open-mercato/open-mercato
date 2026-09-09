"use client"

import { Button } from '@open-mercato/ui/primitives/button'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ConnectionStatus, EditorMode, EditorWordCount, PresenceUser } from './editorTypes'
import type { FallbackSaveStatus } from './useFallbackContentPersistence'
import { firstSafeDocumentsDisplayLabel } from '../../../lib/displayLabels'

const STATUS_STYLES: Record<ConnectionStatus, { pill: string; dot: string }> = {
  connected: { pill: 'border-status-success-border bg-status-success-bg text-status-success-text', dot: 'bg-status-success-icon' },
  connecting: { pill: 'border-status-warning-border bg-status-warning-bg text-status-warning-text', dot: 'bg-status-warning-icon' },
  reconnecting: { pill: 'border-status-warning-border bg-status-warning-bg text-status-warning-text', dot: 'bg-status-warning-icon' },
  offline: { pill: 'border-status-error-border bg-status-error-bg text-status-error-text', dot: 'bg-status-error-icon' },
}

export function EditorStatusPresence({ status, users, counts, mode, canEdit, onModeChange, fallbackSave }: {
  status: ConnectionStatus
  users: PresenceUser[]
  counts: EditorWordCount
  mode: EditorMode
  canEdit: boolean
  onModeChange: (mode: EditorMode) => void
  fallbackSave?: { status: FallbackSaveStatus; onSave: () => void }
}) {
  const t = useT()
  const style = STATUS_STYLES[status]
  const fallbackUserLabel = t('documents.users.unknown')
  const safeUsers = users.flatMap((user) => {
    const name = firstSafeDocumentsDisplayLabel(user.name, fallbackUserLabel)
    return name ? [{ ...user, name }] : []
  })
  const visible = safeUsers.slice(0, 4)
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
      {canEdit ? (
        <SegmentedControl size="sm" value={mode} onValueChange={(value) => onModeChange(value as EditorMode)} aria-label={t('documents.editor.mode.label')}>
          <SegmentedControlItem value="edit">{t('documents.editor.mode.edit')}</SegmentedControlItem>
          <SegmentedControlItem value="preview">{t('documents.editor.mode.preview')}</SegmentedControlItem>
        </SegmentedControl>
      ) : null}
      {visible.length > 0 ? (
        <div className="flex -space-x-2" aria-label={t('documents.editor.realtime.presenceLabel')}>
          {visible.map((user) => <Avatar key={user.key} label={user.name} title={user.name} size="xs" className="border border-background ring-2 ring-background" style={{ backgroundColor: user.color }} />)}
          {safeUsers.length > visible.length ? <span className="inline-flex size-5 items-center justify-center rounded-full border border-background bg-muted text-xs font-semibold text-muted-foreground ring-2 ring-background">+{safeUsers.length - visible.length}</span> : null}
        </div>
      ) : null}
      <span className="order-last w-full text-center text-xs text-muted-foreground sm:order-none sm:w-auto sm:text-left">{t('documents.editor.wordCount', { words: counts.words, characters: counts.characters })}</span>
      {fallbackSave ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {t(fallbackSave.status === 'error' ? 'documents.editor.error.save' : `documents.editor.status.${fallbackSave.status}`)}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={fallbackSave.status === 'saving' || fallbackSave.status === 'saved'}
            onClick={fallbackSave.onSave}
          >
            {t('documents.actions.save')}
          </Button>
        </div>
      ) : null}
      <span
        className={cn('inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs font-medium', style.pill)}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className={cn('size-2 rounded-full', style.dot)} aria-hidden="true" />
        {t(`documents.editor.realtime.${status}`)}
      </span>
    </div>
  )
}
