/**
 * @jest-environment jsdom
 */

// jsdom does not ship TextEncoder/TextDecoder/Response globals — polyfill from
// the Node util + undici modules before any consumer module imports them.
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
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

jest.mock('@open-mercato/ai-assistant', () => ({
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
  'ai_assistant.chat.assistantRoleLabel': 'Assistant',
  'ai_assistant.chat.cancel': 'Cancel streaming response',
  'ai_assistant.chat.composerLabel': 'Message composer',
  'ai_assistant.chat.composerPlaceholder': 'Message the AI agent...',
  'ai_assistant.chat.debugPanelTitle': 'Debug panel',
  'ai_assistant.chat.emptyTranscript':
    'No messages yet. Ask the agent anything to get started.',
  'ai_assistant.chat.errorTitle': 'Agent dispatch failed',
  'ai_assistant.chat.regionLabel': 'AI chat',
  'ai_assistant.chat.send': 'Send message',
  'ai_assistant.chat.shortcutHint':
    'Press Cmd/Ctrl+Enter to send, Escape to cancel.',
  'ai_assistant.chat.thinking': 'Thinking...',
  'ai_assistant.chat.transcriptLabel': 'Chat transcript',
  'ai_assistant.chat.uiPartPending': 'Pending UI part:',
  'ai_assistant.chat.userRoleLabel': 'You',
}

// Minimal Response-like shape honouring only the methods the hook calls:
// `ok`, `status`, `body`, `clone()`, `json()`, `text()`.
type ResponseLike = {
  ok: boolean
  status: number
  body: ReadableStream<Uint8Array> | null
  clone: () => ResponseLike
  json: () => Promise<unknown>
  text: () => Promise<string>
}

function createStreamingResponse(chunks: string[]): ResponseLike {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  const raw = chunks.join('')
  const self: ResponseLike = {
    ok: true,
    status: 200,
    body: stream,
    clone: () => ({ ...self, body: null }),
    json: async () => ({}),
    text: async () => raw,
  }
  return self
}

function createErrorResponse(status: number, payload: Record<string, unknown>): ResponseLike {
  const jsonText = JSON.stringify(payload)
  const self: ResponseLike = {
    ok: false,
    status,
    body: null,
    clone: () => ({ ...self }),
    json: async () => payload,
    text: async () => jsonText,
  }
  return self
}

describe('<AiChat>', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the composer with the i18n placeholder and region labels', () => {
    renderWithProviders(<AiChat agent="customers.account_assistant" />, { dict })

    const textarea = screen.getByLabelText('Message composer') as HTMLTextAreaElement
    expect(textarea.placeholder).toBe('Message the AI agent...')
    expect(screen.getByRole('log', { name: 'Chat transcript' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'AI chat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
  })

  it('submits the message on Cmd+Enter and streams assistant text into the transcript', async () => {
    const fetchMock = apiFetch as unknown as jest.Mock
    fetchMock.mockResolvedValueOnce(
      createStreamingResponse(['Hello', ', ', 'world!']),
    )

    renderWithProviders(<AiChat agent="customers.account_assistant" />, { dict })

    const textarea = screen.getByLabelText('Message composer') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Hi there' } })

    await act(async () => {
      fireEvent.keyDown(textarea, {
        key: 'Enter',
        metaKey: true,
      })
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/ai_assistant/ai/chat')
    expect(String(url)).toContain('agent=customers.account_assistant')
    expect(init.method).toBe('POST')
    const parsedBody = JSON.parse(init.body as string)
    expect(parsedBody.messages[0]).toMatchObject({ role: 'user', content: 'Hi there' })

    await waitFor(() => {
      expect(screen.getByText('Hello, world!')).toBeInTheDocument()
    })
    expect(screen.getByText('Hi there')).toBeInTheDocument()
  })

  it('surfaces dispatcher error envelopes via Alert and onError callback', async () => {
    const fetchMock = apiFetch as unknown as jest.Mock
    fetchMock.mockResolvedValueOnce(
      createErrorResponse(404, {
        error: 'Unknown agent "bogus.agent"',
        code: 'agent_unknown',
      }),
    )

    const onError = jest.fn()
    renderWithProviders(
      <AiChat agent="bogus.agent" onError={onError} />,
      { dict },
    )

    const textarea = screen.getByLabelText('Message composer') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'test' } })
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    })

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'agent_unknown',
          message: expect.stringContaining('Unknown agent'),
        }),
      )
    })

    expect(screen.getByText('Agent dispatch failed')).toBeInTheDocument()
    expect(screen.getByText(/Unknown agent/)).toBeInTheDocument()
    expect(screen.getByText('agent_unknown')).toBeInTheDocument()
  })

  it('Escape aborts an in-flight streaming response', async () => {
    const fetchMock = apiFetch as unknown as jest.Mock
    // Build a stream we can keep open until the component aborts it.
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
    const encoder = new TextEncoder()
    const pendingStream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
        controller.enqueue(encoder.encode('partial'))
      },
      cancel() {
        // no-op; act as if cancellation succeeds
      },
    })

    fetchMock.mockImplementationOnce(async (_input: unknown, init: RequestInit) => {
      const signal = init.signal as AbortSignal | undefined
      if (signal) {
        signal.addEventListener('abort', () => {
          try {
            streamController?.error(new DOMException('Aborted', 'AbortError'))
          } catch {
            // already closed
          }
        })
      }
      const responseLike: ResponseLike = {
        ok: true,
        status: 200,
        body: pendingStream,
        clone: () => ({
          ok: true,
          status: 200,
          body: null,
          clone: () => responseLike,
          json: async () => ({}),
          text: async () => '',
        }),
        json: async () => ({}),
        text: async () => '',
      }
      return responseLike
    })

    renderWithProviders(<AiChat agent="customers.account_assistant" />, { dict })
    const textarea = screen.getByLabelText('Message composer') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'stream please' } })
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
    })

    // Wait for the partial chunk to show up so we are definitely streaming.
    await waitFor(() => {
      expect(screen.getByText('partial')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Escape' })
    })

    // The assistant message keeps whatever we streamed so far but the thinking
    // indicator should be gone (status === 'idle').
    await waitFor(() => {
      expect(screen.queryByText('Thinking...')).not.toBeInTheDocument()
    })
  })
})
