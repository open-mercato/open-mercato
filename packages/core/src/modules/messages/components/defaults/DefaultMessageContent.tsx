"use client"

import * as React from 'react'
import type { MessageContentProps } from '@open-mercato/shared/modules/messages/types'
import { MarkdownContent } from '@open-mercato/ui/backend/markdown/MarkdownContent'

export function DefaultMessageContent({ message }: MessageContentProps) {
  return (
    <section className="space-y-4">
      <div>
        <MarkdownContent
          body={message.body}
          format={message.bodyFormat}
          className="text-sm text-foreground whitespace-pre-wrap [&>*]:mb-2 [&>*:last-child]:mb-0 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs"
        />
      </div>
    </section>
  )
}

export default DefaultMessageContent
