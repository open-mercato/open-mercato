"use client"

import * as React from 'react'
import type { MessageContentProps } from '@open-mercato/shared/modules/messages/types'

export function DefaultMessageContent({ message }: MessageContentProps) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{message.subject}</h2>
        {message.sentAt && (
          <p className="text-sm text-muted-foreground">
            {new Date(message.sentAt).toLocaleString()}
          </p>
        )}
      </div>
      <div className="whitespace-pre-wrap text-sm text-foreground">
        {message.body}
      </div>
    </section>
  )
}

export default DefaultMessageContent
