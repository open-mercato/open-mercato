'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { MessageContentProps } from '@open-mercato/shared/modules/messages/types'
import { Badge } from '@open-mercato/ui/primitives/badge'

export function InboxEmailContent({ message }: MessageContentProps) {
  const t = useT()

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs">
          {t('inbox_ops.title', 'AI Inbox Actions')}
        </Badge>
        {message.senderName ? (
          <span className="text-sm text-muted-foreground">
            {message.senderName}
          </span>
        ) : null}
      </div>

      <div>
        <h3 className="text-base font-semibold">{message.subject}</h3>
        {message.sentAt ? (
          <p className="text-xs text-muted-foreground">
            {new Date(message.sentAt).toLocaleString()}
          </p>
        ) : null}
      </div>

      {message.body ? (
        <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/30 p-4 text-sm leading-relaxed">
          {message.body}
        </pre>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t('inbox_ops.no_email_content', 'No email content available')}
        </p>
      )}
    </div>
  )
}

export default InboxEmailContent
