'use client'

import * as React from 'react'
import { useRef, useEffect, useState } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import type { ChatMessage, ToolCall, OpenCodeQuestion } from '../../types'
import { MessageBubble } from './MessageBubble'
import { ToolCallDisplay } from './ToolCallDisplay'

interface ChatViewProps {
  messages: ChatMessage[]
  pendingToolCalls: ToolCall[]
  isStreaming: boolean
  isThinking?: boolean
  onSendMessage: (content: string) => Promise<void>
  pendingQuestion?: OpenCodeQuestion | null
  onAnswerQuestion?: (answer: number) => Promise<void>
}

/**
 * Detect if a message is asking for confirmation.
 * Returns true if the message contains confirmation-like patterns.
 */
function detectConfirmationRequest(content: string): boolean {
  const patterns = [
    /are you sure/i,
    /do you want to proceed/i,
    /proceed with this/i,
    /confirm(ation)?/i,
    /would you like (me )?to/i,
    /should I (proceed|continue|go ahead)/i,
    /do you (want|wish) (me )?to/i,
    /\?\s*$/m, // ends with question mark (on any line)
  ]

  // Must contain at least one confirmation pattern
  const hasPattern = patterns.some(p => p.test(content))

  // Also check for dangerous operation keywords
  const dangerousKeywords = /\b(delete|remove|update|change|modify|create|add)\b/i

  return hasPattern && dangerousKeywords.test(content)
}

export function ChatView({
  messages,
  pendingToolCalls,
  isStreaming,
  isThinking = false,
  onSendMessage,
  pendingQuestion,
  onAnswerQuestion,
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

            {/* Confirmation question from OpenCode (formal API) */}
            {pendingQuestion && pendingQuestion.questions[0] && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg space-y-3">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-sm font-medium">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>{pendingQuestion.questions[0].header || 'Confirmation Required'}</span>
                </div>
                <p className="text-sm">{pendingQuestion.questions[0].question}</p>
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

            {/* Quick reply buttons for conversational confirmation requests */}
            {!pendingQuestion &&
              !isStreaming &&
              !isThinking &&
              messages.length > 0 &&
              messages[messages.length - 1]?.role === 'assistant' &&
              detectConfirmationRequest(messages[messages.length - 1].content) && (
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => onSendMessage('Yes, proceed with the change.')}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    Yes, proceed
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onSendMessage('No, cancel this operation.')}
                  >
                    No, cancel
                  </Button>
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
