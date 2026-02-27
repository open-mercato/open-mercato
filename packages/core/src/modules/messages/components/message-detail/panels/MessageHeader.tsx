"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { FormHeader, type ActionItem } from '@open-mercato/ui/backend/forms'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  FilePenLine,
  Forward,
  Mail,
  MailOpen,
  Reply,
  Trash2,
} from 'lucide-react'
import type { MessageDetail } from '../types'
import { formatDateTime } from '../utils'

type MessageHeaderProps = {
  detail: MessageDetail
  updatingState: boolean
  isArchived: boolean
  showSubject?: boolean
  onReply: () => void
  onForward: () => void
  onEdit: () => void
  onToggleRead: () => void
  onToggleArchive: () => void
  onDelete: () => void
  collapseToggle?: {
    expanded: boolean
    onToggle: () => void
  }
}

export function MessageHeader(props: MessageHeaderProps) {
  const t = useT()
  const showSubject = props.showSubject !== false
  const canReply = !props.detail.isDraft && props.detail.typeDefinition.allowReply
  const actionItems = React.useMemo(() => {
    const items: ActionItem[] = []

    if (props.detail.isDraft && props.detail.canEditDraft) {
      items.push({
        id: 'edit',
        label: t('messages.actions.edit', 'Edit'),
        icon: FilePenLine,
        onSelect: props.onEdit,
      })
    }

    if (!props.detail.isDraft && props.detail.typeDefinition.allowForward) {
      items.push({
        id: 'forward',
        label: t('messages.forward', 'Forward'),
        icon: Forward,
        onSelect: props.onForward,
      })
    }

    if (!props.detail.isDraft) {
      items.push({
        id: 'toggle-read',
        label: props.detail.isRead
          ? t('messages.actions.markUnread', 'Mark unread')
          : t('messages.actions.markRead', 'Mark read'),
        icon: props.detail.isRead ? Mail : MailOpen,
        onSelect: props.onToggleRead,
        disabled: props.updatingState,
      })
    }

    if (!props.detail.isDraft) {
      items.push({
        id: 'toggle-archive',
        label: props.isArchived
          ? t('messages.actions.unarchive', 'Unarchive')
          : t('messages.actions.archive', 'Archive'),
        icon: props.isArchived ? ArchiveRestore : Archive,
        onSelect: props.onToggleArchive,
        disabled: props.updatingState,
      })
    }

    items.push({
      id: 'delete',
      label: t('messages.actions.delete', 'Delete'),
      icon: Trash2,
      onSelect: props.onDelete,
      disabled: props.updatingState,
    })

    return items
  }, [props, t])

  return (
    <div className="flex items-start gap-2">
      {props.collapseToggle ? (
        <IconButton
          type="button"
          onClick={props.collapseToggle.onToggle}
          variant="ghost"
          size="sm"
          className="mt-1 text-muted-foreground hover:text-foreground"
          aria-label={props.collapseToggle.expanded
            ? t('messages.detail.hideDetails', 'Hide details')
            : t('messages.detail.showDetails', 'Show details')}
        >
          {props.collapseToggle.expanded ? (
            <ChevronUp className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronDown className="h-4 w-4" aria-hidden />
          )}
        </IconButton>
      ) : null}

      <div className="min-w-0 flex-1">
        <FormHeader
          mode="detail"
          title={showSubject ? props.detail.subject : undefined}
          subtitle={`${t('messages.detail.from', 'From')}: ${props.detail.senderName || props.detail.senderEmail || props.detail.senderUserId}`}
          statusBadge={<p className="text-xs text-muted-foreground">{formatDateTime(props.detail.sentAt)}</p>}
          utilityActions={canReply ? (
            <IconButton
              type="button"
              variant="outline"
              size="default"
              aria-label={t('messages.reply', 'Reply')}
              onClick={props.onReply}
            >
              <Reply className="h-4 w-4" aria-hidden />
            </IconButton>
          ) : undefined}
          menuTriggerMode="icon"
          menuAriaLabel={t('ui.actions.actions', 'Actions')}
          menuActions={actionItems}
        />
      </div>
    </div>
  )
}
