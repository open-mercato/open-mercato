"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { FormHeader, type ActionItem } from '@open-mercato/ui/backend/forms'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Archive, Forward, MailMinus, Reply, Trash2 } from 'lucide-react'
import { PriorityBadge } from '../../utils/PriorityBadge'

type MainMessageHeaderProps = {
  subject: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  canReply: boolean
  canForwardAll: boolean
  actionsDisabled?: boolean
  activeActionId?: 'forwardAll' | 'archiveConversation' | 'markAllUnread' | 'deleteConversation' | null
  onReply: () => void
  onForwardAll: () => void
  onArchiveConversation: () => void
  onMarkAllUnread: () => void
  onDeleteConversation: () => void
}

export function MainMessageHeader(props: MainMessageHeaderProps) {
  const t = useT()

  const menuActions = React.useMemo<ActionItem[]>(() => [
    {
      id: 'reply',
      label: t('messages.reply', 'Reply'),
      icon: Reply,
      onSelect: props.onReply,
      disabled: props.actionsDisabled || !props.canReply,
    },
    {
      id: 'forward-all',
      label: t('messages.actions.forwardAll', 'Forward all'),
      icon: Forward,
      onSelect: props.onForwardAll,
      disabled: props.actionsDisabled || !props.canForwardAll,
      loading: props.activeActionId === 'forwardAll',
    },
    {
      id: 'archive-conversation',
      label: t('messages.actions.archiveConversation', 'Archive conversation'),
      icon: Archive,
      onSelect: props.onArchiveConversation,
      disabled: props.actionsDisabled,
      loading: props.activeActionId === 'archiveConversation',
    },
    {
      id: 'mark-all-unread',
      label: t('messages.actions.markAllUnread', 'Mark all unread'),
      icon: MailMinus,
      onSelect: props.onMarkAllUnread,
      disabled: props.actionsDisabled,
      loading: props.activeActionId === 'markAllUnread',
    },
    {
      id: 'delete-conversation',
      label: t('messages.actions.deleteConversation', 'Delete conversation'),
      icon: Trash2,
      onSelect: props.onDeleteConversation,
      disabled: props.actionsDisabled,
      loading: props.activeActionId === 'deleteConversation',
    },
  ], [
    props.actionsDisabled,
    props.canForwardAll,
    props.canReply,
    props.onArchiveConversation,
    props.onDeleteConversation,
    props.onForwardAll,
    props.onMarkAllUnread,
    props.onReply,
    props.activeActionId,
    t,
  ])

  return (
    <FormHeader
      mode="detail"
      backHref="/backend/messages"
      backLabel={t('messages.actions.backToList', 'Back to messages')}
      title={(
        <span className="inline-flex items-center gap-2">
          <span className="truncate">{props.subject}</span>
          <PriorityBadge priority={props.priority} />
        </span>
      )}
      utilityActions={props.canReply ? (
        <IconButton
          type="button"
          variant="outline"
          size="default"
          aria-label={t('messages.reply', 'Reply')}
          onClick={props.onReply}
          disabled={props.actionsDisabled || !props.canReply}
        >
          <Reply className="h-4 w-4" aria-hidden />
        </IconButton>
      ) : undefined}
      menuTriggerMode="icon"
      menuAriaLabel={t('messages.actions.conversationActions', 'Conversation actions')}
      menuActions={menuActions}
    />
  )
}
