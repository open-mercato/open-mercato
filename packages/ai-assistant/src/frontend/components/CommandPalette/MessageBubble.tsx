'use client'

import * as React from 'react'
import { User, Bot } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ChatMessage } from '../../types'

interface MessageBubbleProps {
  message: ChatMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <div
      className={cn(
        'flex gap-3 py-3',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center w-8 h-8 rounded-full shrink-0',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      <div
        className={cn(
          'flex-1 min-w-0 px-4 py-2 rounded-lg text-sm',
          isUser
            ? 'bg-primary text-primary-foreground ml-12'
            : 'bg-muted text-foreground mr-12'
        )}
      >
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
      </div>
    </div>
  )
}
