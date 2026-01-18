'use client'

import * as React from 'react'
import { useRef, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@open-mercato/ui/primitives/button'
import type { ToolInfo, ChatMessage, PendingToolCall, OpenCodeQuestion } from '../../types'
import { MessageBubble } from './MessageBubble'
import { ToolCallConfirmation } from './ToolCallConfirmation'

interface ToolChatPageProps {
  tool: ToolInfo | null  // Can be null for general chat
  messages: ChatMessage[]
  pendingToolCalls: PendingToolCall[]
  isStreaming: boolean
  isThinking?: boolean
  onApproveToolCall: (toolCallId: string) => Promise<void>
  onRejectToolCall: (toolCallId: string) => void
  pendingQuestion?: OpenCodeQuestion | null
  onAnswerQuestion?: (answer: number) => Promise<void>
}

export function ToolChatPage({
  tool,
  messages,
  pendingToolCalls,
  isStreaming,
  isThinking = false,
  onApproveToolCall,
  onRejectToolCall,
  pendingQuestion,
  onAnswerQuestion,
}: ToolChatPageProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages (debounced)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }, 100)

    return () => clearTimeout(timeoutId)
  }, [messages, pendingToolCalls, isStreaming, isThinking, pendingQuestion])

  return (
    <div className="p-3 space-y-3">
      {/* Tool description header - only shown if tool is selected */}
      {tool && (
        <div className="-mx-3 -mt-3 mb-3 px-3 py-2 border-b bg-muted/20">
          <p className="text-xs text-muted-foreground line-clamp-2">{tool.description}</p>
        </div>
      )}

      {/* Chat messages */}
      <div className="space-y-3">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {/* Only show tool calls that require user action (pending dangerous tools or errors) */}
        {pendingToolCalls
          .filter((tc) => tc.status === 'pending' || tc.status === 'error')
          .map((toolCall) => (
            <ToolCallConfirmation
              key={toolCall.id}
              toolCall={toolCall}
              onApprove={() => onApproveToolCall(toolCall.id)}
              onReject={() => onRejectToolCall(toolCall.id)}
            />
          ))}

        {/* OpenCode confirmation question */}
        {pendingQuestion && pendingQuestion.questions[0] && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg space-y-3">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-sm font-medium">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{pendingQuestion.questions[0].header || 'Confirmation Required'}</span>
            </div>
            <div className="text-sm prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1 [&_strong]:font-semibold">
              <Markdown remarkPlugins={[remarkGfm]}>
                {pendingQuestion.questions[0].question}
              </Markdown>
            </div>
            <div className="flex gap-2 flex-wrap">
              {pendingQuestion.questions[0].options.map((option, index) => (
                <Button
                  key={index}
                  variant={index === 0 ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onAnswerQuestion?.(index)}
                  disabled={isStreaming}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Thinking indicator - OpenCode is processing */}
        {isThinking && !pendingQuestion && (
          <div className="flex items-center gap-2 py-3 px-3 bg-muted/50 rounded-lg text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Agent is working...</span>
          </div>
        )}

        {/* Streaming indicator - fallback for non-thinking streaming */}
        {isStreaming && !isThinking && !pendingQuestion && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="flex items-center gap-2 py-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>AI is responding...</span>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
