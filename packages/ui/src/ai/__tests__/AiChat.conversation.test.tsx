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
