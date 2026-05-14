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

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-transport', () => ({
  createAiAgentTransport: jest.fn(() => ({
    sendMessages: jest.fn(),
    reconnectToStream: jest.fn(),
  })),
}))

jest.mock('../../backend/utils/api', () => ({
  apiFetch: jest.fn(),
}))

// <AiChat> mounts `useAgentModels` (Phase 4b) which calls apiCall against
// /api/ai_assistant/ai/agents/<id>/models on first render. The chat-flow
// tests in this file don't exercise the picker, so stub apiCall with a
// no-providers response — keeps `apiFetch.mock.calls` scoped to the
// dispatcher and lets the existing `mockResolvedValueOnce` setup drive the
// assertion path without having to special-case the models endpoint.
jest.mock('../../backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({
    ok: true,
    status: 200,
    result: {
      agentId: 'customers.account_assistant',
      allowRuntimeModelOverride: false,
      defaultProviderId: 'openai',
      defaultModelId: 'gpt-5-mini',
      providers: [],
    },
  })),
}))

import { apiFetch } from '../../backend/utils/api'
import { apiCall } from '../../backend/utils/apiCall'
import { AiChat } from '../AiChat'

let lastResizeObserver: MockResizeObserver | null = null

class MockResizeObserver {
  observe = jest.fn()
  disconnect = jest.fn()

  constructor(
    private readonly callback: ResizeObserverCallback,
  ) {
    lastResizeObserver = this
  }

  trigger(width: number) {
    this.callback(
      [
        {
          contentRect: { width },
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    )
  }
}

const dict = {
  'ai_assistant.chat.assistantRoleLabel': 'Assistant',
  'ai_assistant.chat.cancel': 'Cancel streaming response',
  'ai_assistant.chat.composerLabel': 'Message composer',
  'ai_assistant.chat.composerPlaceholder': 'Message the AI agent...',
  'ai_assistant.chat.debugPanelTitle': 'Debug panel',
  'ai_assistant.chat.emptyTranscript':
    'No messages yet. Ask the agent anything to get started.',
  'ai_assistant.chat.errorTitle': 'Agent dispatch failed',
  'ai_assistant.chat.agentTasksTitle': 'Agent tasks',
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
  headers?: { get: (name: string) => string | null }
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

function createUiMessageSseResponse(chunks: Array<Record<string, unknown>>): ResponseLike {
  const encoder = new TextEncoder()
  const raw = chunks
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join('')
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${raw}data: [DONE]\n\n`))
      controller.close()
    },
  })
  const headers = {
    get: (name: string) => {
      const normalized = name.toLowerCase()
      if (normalized === 'content-type') return 'text/event-stream'
      if (normalized === 'x-vercel-ai-ui-message-stream') return 'v1'
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
    window.localStorage.clear()
    lastResizeObserver = null
  })

  it('renders the composer with the i18n placeholder and region labels', () => {
    renderWithProviders(<AiChat agent="customers.account_assistant" />, { dict })

    const textarea = screen.getByLabelText('Message composer') as HTMLTextAreaElement
    expect(textarea.placeholder).toBe('Message the AI agent...')
    expect(screen.getByRole('log', { name: 'Chat transcript' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'AI chat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
  })

  it('clears a stale stored model picker value back to the agent default', async () => {
    const apiCallMock = apiCall as unknown as jest.Mock
    apiCallMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      result: {
        agentId: 'customers.account_assistant',
        allowRuntimeModelOverride: true,
        defaultProviderId: 'openai',
        defaultModelId: 'gpt-5-mini',
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            isDefault: true,
            models: [
              {
                id: 'gpt-5-mini',
                name: 'GPT-5 Mini',
                isDefault: true,
              },
            ],
          },
        ],
      },
    })
    window.localStorage.setItem(
      'om-ai-model-picker:customers.account_assistant',
      JSON.stringify({ providerId: 'openai', modelId: 'gpt-4o' }),
    )

    renderWithProviders(<AiChat agent="customers.account_assistant" />, { dict })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Select AI model' })).toHaveAttribute(
        'title',
        'Default: openai / gpt-5-mini',
      )
    })
    expect(window.localStorage.getItem('om-ai-model-picker:customers.account_assistant')).toBeNull()
  })

  it('does not send provider or model overrides while the model picker is on Default', async () => {
    const apiCallMock = apiCall as unknown as jest.Mock
    apiCallMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      result: {
        agentId: 'customers.deal_analyzer',
        allowRuntimeModelOverride: true,
        defaultProviderId: 'openai',
        defaultModelId: 'gpt-5-mini',
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            isDefault: true,
            models: [
              {
                id: 'gpt-5-mini',
                name: 'GPT-5 Mini',
                isDefault: true,
              },
            ],
          },
        ],
      },
    })
    const fetchMock = apiFetch as unknown as jest.Mock
    fetchMock.mockResolvedValueOnce(createStreamingResponse(['Done']))

    renderWithProviders(<AiChat agent="customers.deal_analyzer" />, { dict })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Select AI model' })).toHaveAttribute(
        'title',
        'Default: openai / gpt-5-mini',
      )
    })

    const textarea = screen.getByLabelText('Message composer') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Analyze deals' } })
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    const [url] = fetchMock.mock.calls[0]
    const parsedUrl = new URL(String(url), 'http://localhost')
    expect(parsedUrl.searchParams.get('agent')).toBe('customers.deal_analyzer')
    expect(parsedUrl.searchParams.has('provider')).toBe(false)
    expect(parsedUrl.searchParams.has('model')).toBe(false)
  })

  it('renders a compact footer before a constrained host is measured', async () => {
    const apiCallMock = apiCall as unknown as jest.Mock
    apiCallMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      result: {
        agentId: 'customers.account_assistant',
        allowRuntimeModelOverride: true,
        defaultProviderId: 'openai',
        defaultModelId: 'gpt-5-mini',
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            isDefault: true,
            models: [
              {
                id: 'gpt-5-mini',
                name: 'GPT-5 Mini',
                isDefault: true,
              },
            ],
          },
        ],
      },
    })

    renderWithProviders(<AiChat agent="customers.account_assistant" defaultCompactFooter />, { dict })

    const footer = document.querySelector('[data-ai-chat-footer=""]')
    expect(footer).toHaveAttribute('data-ai-chat-footer-compact', 'true')
    expect(screen.getByText('Press Cmd/Ctrl+Enter to send, Escape to cancel.')).toHaveClass('hidden')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Select AI model' })).toHaveClass('w-8')
    })
    expect(screen.getByRole('button', { name: 'Send message' })).toHaveClass('w-8')
  })

  it('lets a default compact footer expand after resize measurement', async () => {
    const apiCallMock = apiCall as unknown as jest.Mock
    apiCallMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      result: {
        agentId: 'customers.account_assistant',
        allowRuntimeModelOverride: true,
        defaultProviderId: 'openai',
        defaultModelId: 'gpt-5-mini',
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            isDefault: true,
            models: [
              {
                id: 'gpt-5-mini',
                name: 'GPT-5 Mini',
                isDefault: true,
              },
            ],
          },
        ],
      },
    })
    const originalResizeObserver = globalThis.ResizeObserver
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver

    try {
      renderWithProviders(<AiChat agent="customers.account_assistant" defaultCompactFooter />, { dict })

      const footer = document.querySelector('[data-ai-chat-footer=""]')
      expect(footer).toHaveAttribute('data-ai-chat-footer-compact', 'true')

      await act(async () => {
        lastResizeObserver?.trigger(720)
      })

      await waitFor(() => {
        expect(footer).toHaveAttribute('data-ai-chat-footer-compact', 'false')
      })
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Select AI model' })).not.toHaveClass('w-8')
      })
      expect(screen.getByRole('button', { name: 'Send message' })).not.toHaveClass('w-8')
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
    }
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

  it('renders AI SDK tool-call chunks as tool call rows with display names', async () => {
    const fetchMock = apiFetch as unknown as jest.Mock
    fetchMock.mockResolvedValueOnce(
      createUiMessageSseResponse([
        {
          type: 'tool-input-start',
          toolCallId: 'call-1',
          toolName: 'customers__analyze_deals',
        },
        {
          type: 'tool-input-available',
          toolCallId: 'call-1',
          toolName: 'customers__analyze_deals',
          input: { dealStageFilter: 'open', daysOfActivityWindow: 30 },
        },
        {
          type: 'tool-output-available',
          toolCallId: 'call-1',
          output: { totalAnalyzed: 3, stalledCount: 1 },
        },
        { type: 'text-delta', id: 'text-1', delta: 'Analysis complete.' },
      ]),
    )

    renderWithProviders(<AiChat agent="customers.account_assistant" />, { dict })

    const textarea = screen.getByLabelText('Message composer') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Analyze deals' } })
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
    })

    await waitFor(() => {
      expect(screen.getByText('customers.analyze_deals')).toBeInTheDocument()
    })
    expect(screen.getByText('Agent tasks')).toBeInTheDocument()
    expect(screen.getByText('Analysis complete.')).toBeInTheDocument()
    expect(screen.queryByText(/Tool call:/i)).not.toBeInTheDocument()
  })

  it('submits suggested prompts visibly after React StrictMode mount replay', async () => {
    const fetchMock = apiFetch as unknown as jest.Mock
    fetchMock.mockResolvedValueOnce(createStreamingResponse(['Suggested answer']))

    renderWithProviders(
      <React.StrictMode>
        <AiChat
          agent="customers.account_assistant"
          suggestions={[{ label: 'Summarize customers', prompt: 'Summarize customers' }]}
        />
      </React.StrictMode>,
      { dict },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Summarize customers' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByText('Summarize customers')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Suggested answer')).toBeInTheDocument()
    })
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

  it('hides Thinking once visible text has streamed even if the stream remains open', async () => {
    const fetchMock = apiFetch as unknown as jest.Mock
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
    const encoder = new TextEncoder()
    const pendingStream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
        controller.enqueue(encoder.encode('partial answer'))
      },
    })

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: pendingStream,
      clone: () => ({
        ok: true,
        status: 200,
        body: null,
        clone: () => ({}),
        json: async () => ({}),
        text: async () => '',
      }),
      json: async () => ({}),
      text: async () => '',
    } as ResponseLike)

    renderWithProviders(<AiChat agent="catalog.catalog_assistant" />, { dict })
    const textarea = screen.getByLabelText('Message composer') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Suggest five questions' } })
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
    })

    await waitFor(() => {
      expect(screen.getByText('partial answer')).toBeInTheDocument()
    })
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument()

    await act(async () => {
      streamController?.close()
    })
  })
})
