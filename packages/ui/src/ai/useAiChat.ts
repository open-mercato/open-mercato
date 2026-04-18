"use client"

import * as React from 'react'
import { createAiAgentTransport } from '@open-mercato/ai-assistant'
import { apiFetch } from '../backend/utils/api'

/**
 * Chat message shape used by {@link AiChat}. Kept intentionally minimal so the
 * component stays independent of the AI SDK's evolving `UIMessage` type. The
 * dispatcher route (`POST /api/ai_assistant/ai/chat`) accepts exactly this
 * shape for `messages`.
 */
export interface AiChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export interface UseAiChatInput {
  agent: string
  apiPath?: string
  pageContext?: Record<string, unknown>
  attachmentIds?: string[]
  debug?: boolean
  initialMessages?: Array<Pick<AiChatMessage, 'role' | 'content'>>
  onError?: (err: { code?: string; message: string }) => void
}

export interface AiChatErrorEnvelope {
  code?: string
  message: string
}

export interface UseAiChatResult {
  messages: AiChatMessage[]
  status: 'idle' | 'submitting' | 'streaming'
  error: AiChatErrorEnvelope | null
  lastRequestDebug: { url: string; body: unknown } | null
  lastResponseDebug: { status: number; text: string } | null
  sendMessage: (input: string) => Promise<void>
  cancel: () => void
  reset: () => void
}

function makeMessageId(): string {
  const random = Math.random().toString(36).slice(2, 10)
  const time = Date.now().toString(36)
  return `msg_${time}_${random}`
}

function getTransportEndpoint(agent: string, apiPath?: string): string {
  // Reuse the transport factory so UI consumers share the dispatcher URL
  // convention with server-side callers (e.g. runAiAgentText / Playwright
  // fixtures). The factory returns a ChatTransport<UI_MESSAGE> whose internal
  // endpoint we do not directly read — instead we reconstruct the same URL
  // shape here so downstream error handling stays deterministic.
  //
  // When the AI SDK exposes a public endpoint getter (or the stream format
  // switches from plain text to UIMessageChunk) we can call
  // transport.sendMessages(...) directly.
  const transport = createAiAgentTransport({ agentId: agent, endpoint: apiPath })
  void transport
  const base = apiPath && apiPath.length > 0 ? apiPath : '/api/ai_assistant/ai/chat'
  const separator = base.includes('?') ? '&' : '?'
  return `${base}${separator}agent=${encodeURIComponent(agent)}`
}

async function readErrorEnvelope(response: Response): Promise<AiChatErrorEnvelope> {
  try {
    const data = (await response.clone().json()) as
      | { error?: unknown; code?: unknown; message?: unknown }
      | null
    if (data && typeof data === 'object') {
      const rawMessage =
        (typeof data.error === 'string' && data.error) ||
        (typeof data.message === 'string' && data.message) ||
        ''
      const rawCode = typeof data.code === 'string' ? data.code : undefined
      if (rawMessage || rawCode) {
        return {
          code: rawCode,
          message: rawMessage || 'Agent dispatch failed.',
        }
      }
    }
  } catch {
    // Fall through to text fallback
  }
  const text = await response.text().catch(() => '')
  return { message: text || `Agent dispatch failed (${response.status}).` }
}

export function useAiChat(input: UseAiChatInput): UseAiChatResult {
  const { agent, apiPath, pageContext, attachmentIds, debug, initialMessages, onError } = input

  const [messages, setMessages] = React.useState<AiChatMessage[]>(() =>
    (initialMessages ?? []).map((entry) => ({
      id: makeMessageId(),
      role: entry.role,
      content: entry.content,
    })),
  )
  const [status, setStatus] = React.useState<'idle' | 'submitting' | 'streaming'>('idle')
  const [error, setError] = React.useState<AiChatErrorEnvelope | null>(null)
  const [lastRequestDebug, setLastRequestDebug] = React.useState<
    { url: string; body: unknown } | null
  >(null)
  const [lastResponseDebug, setLastResponseDebug] = React.useState<
    { status: number; text: string } | null
  >(null)

  const abortRef = React.useRef<AbortController | null>(null)
  const onErrorRef = React.useRef(onError)
  React.useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  const emitError = React.useCallback((envelope: AiChatErrorEnvelope) => {
    setError(envelope)
    try {
      onErrorRef.current?.(envelope)
    } catch {
      // UI layer must never throw because a caller-supplied error handler
      // misbehaved.
    }
  }, [])

  const cancel = React.useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setStatus('idle')
  }, [])

  const reset = React.useCallback(() => {
    cancel()
    setMessages([])
    setError(null)
    setLastRequestDebug(null)
    setLastResponseDebug(null)
  }, [cancel])

  const sendMessage = React.useCallback(
    async (textInput: string) => {
      const trimmed = textInput.trim()
      if (!trimmed) return
      if (abortRef.current) {
        abortRef.current.abort()
      }

      setError(null)
      const userMessage: AiChatMessage = {
        id: makeMessageId(),
        role: 'user',
        content: trimmed,
      }
      const assistantMessage: AiChatMessage = {
        id: makeMessageId(),
        role: 'assistant',
        content: '',
      }
      const assistantId = assistantMessage.id
      // Snapshot prior messages for request payload so the dispatcher sees the
      // full turn history including the just-added user message.
      const outgoingHistory = [...messages, userMessage]
      setMessages([...outgoingHistory, assistantMessage])
      setStatus('submitting')

      const controller = new AbortController()
      abortRef.current = controller

      const url = getTransportEndpoint(agent, apiPath)
      const body = {
        messages: outgoingHistory.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        pageContext,
        attachmentIds,
        debug,
      }
      setLastRequestDebug({ url, body })

      let response: Response
      try {
        response = await apiFetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream, text/plain, application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      } catch (requestError) {
        if ((requestError as { name?: string })?.name === 'AbortError') {
          setStatus('idle')
          abortRef.current = null
          return
        }
        const message =
          requestError instanceof Error
            ? requestError.message
            : 'Network request failed.'
        emitError({ message })
        setStatus('idle')
        abortRef.current = null
        return
      }

      if (!response.ok) {
        const envelope = await readErrorEnvelope(response)
        setLastResponseDebug({ status: response.status, text: envelope.message })
        emitError(envelope)
        setStatus('idle')
        setMessages((current) => current.filter((entry) => entry.id !== assistantId))
        abortRef.current = null
        return
      }

      const bodyStream = response.body
      if (!bodyStream) {
        setLastResponseDebug({ status: response.status, text: '' })
        setStatus('idle')
        abortRef.current = null
        return
      }

      setStatus('streaming')
      const reader = bodyStream.getReader()
      const decoder = new TextDecoder()
      let streamedText = ''
      try {
        // Plain text streaming: the dispatcher currently returns a
        // `toTextStreamResponse`-formatted body where every chunk is raw
        // assistant text. When the spec migrates to UIMessageChunk format we
        // will parse each chunk through the AI SDK's stream reader.
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (!value) continue
          const piece = decoder.decode(value, { stream: true })
          if (!piece) continue
          streamedText += piece
          const snapshot = streamedText
          setMessages((current) =>
            current.map((entry) =>
              entry.id === assistantId ? { ...entry, content: snapshot } : entry,
            ),
          )
        }
        const tail = decoder.decode()
        if (tail) {
          streamedText += tail
          const finalSnapshot = streamedText
          setMessages((current) =>
            current.map((entry) =>
              entry.id === assistantId ? { ...entry, content: finalSnapshot } : entry,
            ),
          )
        }
        setLastResponseDebug({ status: response.status, text: streamedText })
      } catch (streamError) {
        if ((streamError as { name?: string })?.name === 'AbortError') {
          // Cancelled by the user — keep whatever we have so far and exit
          // quietly.
        } else {
          const message =
            streamError instanceof Error
              ? streamError.message
              : 'Stream interrupted.'
          emitError({ message })
        }
      } finally {
        reader.releaseLock()
        if (abortRef.current === controller) {
          abortRef.current = null
        }
        setStatus('idle')
      }
    },
    [agent, apiPath, attachmentIds, debug, emitError, messages, pageContext],
  )

  React.useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
    }
  }, [])

  return {
    messages,
    status,
    error,
    lastRequestDebug,
    lastResponseDebug,
    sendMessage,
    cancel,
    reset,
  }
}
