"use client"

import * as React from 'react'
import type { MessageContentProps } from '@open-mercato/shared/modules/messages/types'
import { PriorityBadge } from './PriorityBadge'

export function DefaultMessageContent({ message }: MessageContentProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <PriorityBadge priority={message.priority} />
      </div>
      <div className="whitespace-pre-wrap text-sm text-foreground">
        {message.body}
      </div>
    </section>
  )
}

export default DefaultMessageContent
