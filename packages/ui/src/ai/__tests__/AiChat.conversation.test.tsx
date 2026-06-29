/**
 * @jest-environment jsdom
 *
 * Step 5.15 — `<AiChat>` `conversationId` threading.
 *
 * Covers the Phase 3 WS-D contract:
 *  1. Same explicit `conversationId` prop across two mounts yields the same
 *     id (the component MUST forward caller-provided ids verbatim).
 *  2. Without the prop, two separate mounts mint two DIFFERENT ids — each
 *     mount gets a fresh conversation.
 *  3. The id is included in the `POST /api/ai_assistant/ai/chat` body so
 *     downstream `prepareMutation` sees it.
 */

// jsdom polyfills (same as AiChat.test.tsx).
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
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
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

describe('<AiChat> conversationId threading (Step 5.15)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('forwards an explicit conversationId prop verbatim across remounts', () => {
    const explicitId = 'conv-explicit-abc123'

    const { unmount: unmountA } = renderWithProviders(
      <AiChat agent="customers.account_assistant" conversationId={explicitId} />,
      { dict },
    )
    const regionA = document.querySelector('[data-ai-chat-conversation-id]')
    expect(regionA?.getAttribute('data-ai-chat-conversation-id')).toBe(explicitId)
    unmountA()

    const { unmount: unmountB } = renderWithProviders(
      <AiChat agent="customers.account_assistant" conversationId={explicitId} />,
      { dict },
    )
    const regionB = document.querySelector('[data-ai-chat-conversation-id]')
    expect(regionB?.getAttribute('data-ai-chat-conversation-id')).toBe(explicitId)
    unmountB()
  })

  it('mints a fresh conversationId on each mount when the prop is omitted', () => {
    const { unmount: unmountA } = renderWithProviders(
      <AiChat agent="customers.account_assistant" />,
      { dict },
    )
    const regionA = document.querySelector('[data-ai-chat-conversation-id]')
    const idA = regionA?.getAttribute('data-ai-chat-conversation-id') ?? ''
    expect(idA.length).toBeGreaterThan(0)
    unmountA()

    const { unmount: unmountB } = renderWithProviders(
      <AiChat agent="customers.account_assistant" />,
      { dict },
    )
    const regionB = document.querySelector('[data-ai-chat-conversation-id]')
    const idB = regionB?.getAttribute('data-ai-chat-conversation-id') ?? ''
    expect(idB.length).toBeGreaterThan(0)
    expect(idB).not.toBe(idA)
    unmountB()
  })

  it('includes conversationId in the POST body forwarded to the dispatcher', async () => {
    const fetchMock = apiFetch as unknown as jest.Mock
    fetchMock.mockResolvedValueOnce(createStreamingResponse(['ok']))

    renderWithProviders(
      <AiChat agent="customers.account_assistant" conversationId="conv-body-xyz" />,
      { dict },
    )

    const textarea = screen.getByLabelText('Message composer') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'hi' } })
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    const parsedBody = JSON.parse(init.body as string)
    expect(parsedBody.conversationId).toBe('conv-body-xyz')
  })

  it('invokes onConversationNotFound and does not import local messages when server returns 404', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = jest.fn((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/ai_assistant/ai/conversations/conv-stale')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ error: 'not found' }),
        } as unknown as Response)
      }
      // Any /import call would be a regression we must catch:
      if (url.includes('/import')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        } as unknown as Response)
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as unknown as Response)
    }) as unknown as typeof fetch
    globalThis.fetch = fetchMock

    const onConversationNotFound = jest.fn()

    try {
      renderWithProviders(
        <AiChat
          agent="customers.account_assistant"
          conversationId="conv-stale"
          onConversationNotFound={onConversationNotFound}
        />,
        { dict },
      )

      // hydrate effect is async — wait one tick for the 404 to land
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(onConversationNotFound).toHaveBeenCalledTimes(1)
      // No /import call must happen on 404 — cross-tenant data write guard.
      const importCalls = fetchMock.mock.calls.filter(([url]) => {
        const u = typeof url === 'string' ? url : (url as { toString(): string }).toString()
        return u.includes('/conversations/import')
      })
      expect(importCalls).toHaveLength(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('does NOT invoke onConversationNotFound on transient transport failure (503)', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = jest.fn((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/ai_assistant/ai/conversations/conv-503')) {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: async () => ({ error: 'upstream' }),
        } as unknown as Response)
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as unknown as Response)
    }) as unknown as typeof fetch
    globalThis.fetch = fetchMock

    const onConversationNotFound = jest.fn()

    try {
      renderWithProviders(
        <AiChat
          agent="customers.account_assistant"
          conversationId="conv-503"
          onConversationNotFound={onConversationNotFound}
        />,
        { dict },
      )

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(onConversationNotFound).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('hydrates the transcript from server storage for an existing conversation', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        conversation: {
          conversationId: 'conv-server-xyz',
          agentId: 'customers.account_assistant',
          title: null,
          status: 'open',
          visibility: 'private',
          pageContext: null,
          createdAt: '2026-05-18T10:00:00.000Z',
          updatedAt: '2026-05-18T10:00:00.000Z',
          lastMessageAt: '2026-05-18T10:00:00.000Z',
          importedFromLocalAt: null,
        },
        messages: [
          {
            id: 'server-msg-1',
            clientMessageId: 'client-msg-1',
            role: 'user',
            content: 'Server question',
            uiParts: [],
            attachmentIds: ['att-image-1'],
            files: [
              {
                name: 'IMG_5328.JPEG',
                mimeType: 'image/jpeg',
              },
            ],
            model: null,
            metadata: null,
            createdAt: '2026-05-18T10:00:00.000Z',
          },
          {
            id: 'server-msg-2',
            clientMessageId: 'client-msg-2',
            role: 'assistant',
            content: 'Server answer',
            uiParts: [],
            attachmentIds: [],
            files: [],
            model: null,
            metadata: null,
            createdAt: '2026-05-18T10:00:01.000Z',
          },
        ],
        nextCursor: null,
      }),
    })) as unknown as typeof fetch
    globalThis.fetch = fetchMock

    try {
      renderWithProviders(
        <AiChat agent="customers.account_assistant" conversationId="conv-server-xyz" />,
        { dict },
      )

      expect(await screen.findByText('Server question')).toBeInTheDocument()
      const image = await screen.findByRole('img', { name: 'IMG_5328.JPEG' })
      expect(image).toHaveAttribute(
        'src',
        '/api/attachments/image/att-image-1?width=320&height=320&cropType=contain',
      )
      const download = screen.getByLabelText('Download IMG_5328.JPEG')
      expect(download).toHaveAttribute(
        'href',
        '/api/attachments/file/att-image-1?download=1',
      )
      fireEvent.click(image)
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'IMG_5328.JPEG' })).toBeInTheDocument()
      const images = screen.getAllByRole('img', { name: 'IMG_5328.JPEG' })
      expect(images[1]).toHaveAttribute('src', '/api/attachments/image/att-image-1')
      expect(await screen.findByText('Server answer')).toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/ai_assistant/ai/conversations/conv-server-xyz?limit=100',
        expect.objectContaining({ credentials: 'include' }),
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

// <AiChat> mounts useAgentModels (Phase 4b) which hits /api/ai_assistant/ai/agents/<id>/models
// on first render via apiCall. Stub apiCall with a no-providers response so this files
// chat-flow assertions remain scoped to the dispatcher mock above.
jest.mock('../../backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({
    ok: true,
    status: 200,
    result: {
      allowRuntimeModelOverride: false,
      defaultProviderId: 'openai',
      defaultModelId: 'gpt-5-mini',
      providers: [],
    },
  })),
}))
