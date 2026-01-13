'use client'

import * as React from 'react'
import { useRef, useEffect, useState } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import type { ChatMessage, ToolCall } from '../../types'
import { MessageBubble } from './MessageBubble'
import { ToolCallDisplay } from './ToolCallDisplay'

interface ChatViewProps {
  messages: ChatMessage[]
  pendingToolCalls: ToolCall[]
  isStreaming: boolean
  onSendMessage: (content: string) => Promise<void>
}

export function ChatView({
  messages,
  pendingToolCalls,
  isStreaming,
  onSendMessage,
}: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [inputValue, setInputValue] = useState('')

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, pendingToolCalls])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputValue.trim() || isStreaming) return

    const content = inputValue
    setInputValue('')
    await onSendMessage(content)
  }

  return (
    <div className="flex flex-col h-[60vh]">
      {/* Messages Area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-2"
      >
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Start a conversation with AI
          </div>
        ) : (
          <div className="space-y-1">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {/* Show pending tool calls */}
            {pendingToolCalls
              .filter((tc) => tc.status === 'running' || tc.status === 'pending')
              .map((toolCall) => (
                <ToolCallDisplay key={toolCall.id} toolCall={toolCall} />
              ))}

            {/* Streaming indicator */}
            {isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
              <div className="flex items-center gap-2 py-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>AI is thinking...</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="border-t p-4">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type your message..."
            className={cn(
              'flex-1 bg-muted rounded-lg px-4 py-2 text-sm outline-none',
              'focus:ring-2 focus:ring-ring'
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
