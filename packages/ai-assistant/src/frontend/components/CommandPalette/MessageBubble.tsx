'use client'

import * as React from 'react'
import { User, Bot } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
        {isUser ? (
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        ) : (
          <div className={cn(
            'prose prose-sm dark:prose-invert max-w-none break-words',
            // Reset margins for first/last children
            '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
            // Paragraph spacing - also handle plain text with whitespace-pre-line
            '[&_p]:my-2 [&_p]:leading-relaxed [&_p]:whitespace-pre-line',
            // List styling
            '[&_ul]:my-2 [&_ul]:pl-4 [&_ol]:my-2 [&_ol]:pl-4',
            '[&_li]:my-0.5 [&_li]:leading-relaxed',
            // Headers
            '[&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-2',
            '[&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1',
            '[&_h3]:text-sm [&_h3]:font-medium [&_h3]:mt-2 [&_h3]:mb-1',
            // Code blocks
            '[&_pre]:bg-background/50 [&_pre]:rounded [&_pre]:p-2 [&_pre]:my-2 [&_pre]:overflow-x-auto',
            '[&_code]:bg-background/50 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs',
            // Strong/emphasis
            '[&_strong]:font-semibold [&_em]:italic',
            // Blockquotes
            '[&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-3 [&_blockquote]:italic'
          )}>
            <Markdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </Markdown>
          </div>
        )}
      </div>
    </div>
  )
}
