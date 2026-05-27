'use client'

import * as React from 'react'
import { Reply, ReplyAll, Forward } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
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
      <Button
        variant="ghost"
        size="sm"
        onClick={props.onReply}
        disabled={props.disabled}
        aria-label={t('customers.email.timeline.reply', 'Reply')}
      >
        <Reply className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={props.onReplyAll}
        disabled={props.disabled}
        aria-label={t('customers.email.timeline.replyAll', 'Reply all')}
      >
        <ReplyAll className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={props.onForward}
        disabled={props.disabled}
        aria-label={t('customers.email.timeline.forward', 'Forward')}
      >
        <Forward className="h-4 w-4" />
      </Button>
    </div>
  )
}

export default EmailReplyForwardActions
