'use client'

import * as React from 'react'
import { useRef, useEffect, useState } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import type { ToolInfo, ChatMessage, PendingToolCall } from '../../types'
import { MessageBubble } from './MessageBubble'
import { ToolCallConfirmation } from './ToolCallConfirmation'

interface ToolChatPageProps {
  tool: ToolInfo | null  // Can be null for general chat
  messages: ChatMessage[]
  pendingToolCalls: PendingToolCall[]
  isStreaming: boolean
  onSendMessage: (content: string) => Promise<void>
  onApproveToolCall: (toolCallId: string) => Promise<void>
  onRejectToolCall: (toolCallId: string) => void
}

export function ToolChatPage({
  tool,
  messages,
  pendingToolCalls,
  isStreaming,
  onSendMessage,
  onApproveToolCall,
  onRejectToolCall,
}: ToolChatPageProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [inputValue, setInputValue] = useState('')

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, pendingToolCalls])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputValue.trim() || isStreaming) return

    const content = inputValue
    setInputValue('')
    await onSendMessage(content)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Prevent escape from bubbling to close the palette
    if (e.key === 'Escape') {
      e.stopPropagation()
    }
  }

  return (
    <div className="flex flex-col h-[400px]">
      {/* Tool description header - only shown if tool is selected */}
      {tool && (
        <div className="px-3 py-2 border-b bg-muted/20">
          <p className="text-xs text-muted-foreground line-clamp-2">{tool.description}</p>
        </div>
      )}

      {/* Chat messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
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

        {/* Streaming indicator */}
        {isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="flex items-center gap-2 py-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>AI is thinking...</span>
          </div>
        )}
      </div>

      {/* Input area */}
      <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="border-t p-3">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Describe what you want to do..."
            className={cn(
              'flex-1 bg-muted rounded-lg px-4 py-2 text-sm outline-none',
              'focus:ring-2 focus:ring-ring',
              'disabled:opacity-50'
            )}
            disabled={isStreaming}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!inputValue.trim() || isStreaming}
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
