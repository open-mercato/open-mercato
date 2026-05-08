/**
 * @jest-environment jsdom
 *
 * Regression for issue #1816: when the AI assistant is "Thinking" (mid-stream)
 * and the user closes the dock or switches to another agent, `<AiChat>`
 * unmounts. Without the fix, the partial assistant content was never
 * persisted (the persist effect skipped during streaming) and the abort on
 * unmount discarded it — reopening the assistant showed an empty assistant
 * turn instead of the in-progress reply.
 *
 * After the fix, the unmount cleanup flushes the latest message snapshot —
 * including the partial assistant content — to localStorage so reopening the
 * chat continues from where it left off.
 */

// jsdom polyfills (mirrors AiChat.test.tsx).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeUtil = require('node:util') as typeof import('node:util')
if (typeof globalThis.TextEncoder === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).TextEncoder = nodeUtil.TextEncoder
}
if (typeof globalThis.TextDecoder === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).TextDecoder = nodeUtil.TextDecoder as unknown as typeof TextDecoder
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeStreamWeb = require('node:stream/web') as typeof import('node:stream/web')
if (typeof (globalThis as unknown as { ReadableStream?: unknown }).ReadableStream === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).ReadableStream = nodeStreamWeb.ReadableStream
}

import * as React from 'react'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-transport', () => ({
  createAiAgentTransport: jest.fn(() => ({
    sendMessages: jest.fn(),
    reconnectToStream: jest.fn(),
  })),
}))

jest.mock('../../backend/utils/api', () => ({
  apiFetch: jest.fn(),
}))

import { apiFetch } from '../../backend/utils/api'
import { AiChat } from '../AiChat'

const dict = {
  'ai_assistant.chat.composerLabel': 'Message composer',
  'ai_assistant.chat.composerPlaceholder': 'Message the AI agent...',
  'ai_assistant.chat.regionLabel': 'AI chat',
  'ai_assistant.chat.send': 'Send message',
  'ai_assistant.chat.transcriptLabel': 'Chat transcript',
}

type ResponseLike = {
  ok: boolean
  status: number
  body: ReadableStream<Uint8Array> | null
  headers?: { get: (name: string) => string | null }
  clone: () => ResponseLike
  json: () => Promise<unknown>
  text: () => Promise<string>
}

interface PendingResponse {
  response: ResponseLike
  emit: (chunk: string) => Promise<void>
  close: () => Promise<void>
}

function createPendingStreamingResponse(): PendingResponse {
  const encoder = new TextEncoder()
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller
    },
  })
  const headers = {
    get: (name: string) => {
      if (name.toLowerCase() === 'content-type') return 'text/event-stream'
      return null
    },
  }
  const self: ResponseLike = {
    ok: true,
    status: 200,
    body: stream,
    headers,
    clone: () => ({ ...self, body: null }),
    json: async () => ({}),
    text: async () => '',
  }
  return {
    response: self,
    emit: async (chunk: string) => {
      controllerRef?.enqueue(encoder.encode(chunk))
      // Yield to the microtask queue so the consumer's `reader.read()` resolves
      // before the test inspects state.
      await Promise.resolve()
      await Promise.resolve()
    },
    close: async () => {
      controllerRef?.close()
      await Promise.resolve()
    },
  }
}

function readPersistedAssistantText(agent: string, conversationId: string): string | null {
  const raw = window.localStorage.getItem(`om-ai-chat:${agent}:${conversationId}`)
  if (!raw) return null
  const parsed = JSON.parse(raw) as { messages?: Array<{ role: string; content: string }> }
  if (!parsed?.messages) return null
  const assistant = [...parsed.messages].reverse().find((entry) => entry?.role === 'assistant')
  return assistant?.content ?? null
}

const SSE_TEXT_DELTA = (delta: string) =>
  `data: ${JSON.stringify({ type: 'text-delta', delta })}\n\n`

describe('<AiChat> unmount-mid-stream persistence (issue #1816)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('persists the partial assistant reply when the chat unmounts mid-stream', async () => {
    const fetchMock = apiFetch as unknown as jest.Mock
    const pending = createPendingStreamingResponse()
    fetchMock.mockResolvedValueOnce(pending.response)

    const conversationId = 'conv-thinking-unmount-1'
    const { unmount } = renderWithProviders(
      <AiChat agent="customers.account_assistant" conversationId={conversationId} />,
      { dict },
    )

    const textarea = screen.getByLabelText('Message composer') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'hello' } })
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    // Stream a partial assistant reply but DO NOT close the stream — the
    // assistant is still "Thinking" from the user's perspective.
    await act(async () => {
      await pending.emit(SSE_TEXT_DELTA('Working on it'))
    })

    // The user closes the assistant / switches agent — `<AiChat>` unmounts
    // while the request is still in flight.
    await act(async () => {
      unmount()
    })

    // The partial assistant content must survive in localStorage so the
    // next mount can show it.
    const persisted = readPersistedAssistantText('customers.account_assistant', conversationId)
    expect(persisted).toBe('Working on it')
  })

  it('rehydrates the partial assistant reply when the chat is reopened with the same conversationId', async () => {
    const fetchMock = apiFetch as unknown as jest.Mock
    const pending = createPendingStreamingResponse()
    fetchMock.mockResolvedValueOnce(pending.response)

    const conversationId = 'conv-thinking-unmount-2'
    const { unmount: unmountA } = renderWithProviders(
      <AiChat agent="customers.account_assistant" conversationId={conversationId} />,
      { dict },
    )

    const textarea = screen.getByLabelText('Message composer') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'how are you' } })
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    await act(async () => {
      await pending.emit(SSE_TEXT_DELTA('Almost there'))
    })

    await act(async () => {
      unmountA()
    })

    // Reopen the same chat — the persisted partial reply should show up
    // in the transcript instead of an empty assistant message.
    const { unmount: unmountB } = renderWithProviders(
      <AiChat agent="customers.account_assistant" conversationId={conversationId} />,
      { dict },
    )

    const transcript = screen.getByRole('log', { name: 'Chat transcript' })
    expect(transcript.textContent ?? '').toContain('Almost there')
    unmountB()
  })
})
