'use client'

import * as React from 'react'
import { Reply, ReplyAll, Forward } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export interface EmailReplyForwardActionsProps {
  onReply: () => void
  onReplyAll: () => void
  onForward: () => void
  disabled?: boolean
}

export function EmailReplyForwardActions(props: EmailReplyForwardActionsProps) {
  const t = useT()
  return (
    <div className="flex gap-1" role="group" aria-label={t('customers.email.timeline.actionsAria', 'Email actions')}>
      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        onClick={props.onReply}
        disabled={props.disabled}
        aria-label={t('customers.email.timeline.reply', 'Reply')}
      >
        <Reply className="h-4 w-4" />
      </IconButton>
      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        onClick={props.onReplyAll}
        disabled={props.disabled}
        aria-label={t('customers.email.timeline.replyAll', 'Reply all')}
      >
        <ReplyAll className="h-4 w-4" />
      </IconButton>
      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        onClick={props.onForward}
        disabled={props.disabled}
        aria-label={t('customers.email.timeline.forward', 'Forward')}
      >
        <Forward className="h-4 w-4" />
      </IconButton>
    </div>
  )
}

export default EmailReplyForwardActions
