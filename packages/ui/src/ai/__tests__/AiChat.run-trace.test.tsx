/**
 * @jest-environment jsdom
 */

const nodeUtil = require('node:util') as typeof import('node:util')
if (typeof globalThis.TextEncoder === 'undefined') {
  ;(globalThis as unknown as { TextEncoder: unknown }).TextEncoder = nodeUtil.TextEncoder
}
if (typeof globalThis.TextDecoder === 'undefined') {
  ;(globalThis as unknown as { TextDecoder: unknown }).TextDecoder = nodeUtil.TextDecoder
}
const nodeStreamWeb = require('node:stream/web') as typeof import('node:stream/web')
if (typeof (globalThis as unknown as { ReadableStream?: unknown }).ReadableStream === 'undefined') {
  ;(globalThis as unknown as { ReadableStream: unknown }).ReadableStream = nodeStreamWeb.ReadableStream
}

import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { BackendChromePayload } from '@open-mercato/shared/modules/navigation/backendChrome'

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-transport', () => ({
  createAiAgentTransport: jest.fn(() => ({
    sendMessages: jest.fn(),
    reconnectToStream: jest.fn(),
  })),
}))

jest.mock('../../backend/utils/api', () => ({
  apiFetch: jest.fn(),
}))

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

jest.mock('../../backend/BackendChromeProvider', () => ({
  ...jest.requireActual('../../backend/BackendChromeProvider'),
  useBackendChrome: jest.fn(),
}))

import { apiFetch } from '../../backend/utils/api'
import { useBackendChrome } from '../../backend/BackendChromeProvider'
import { AiChat } from '../AiChat'
import { LoopTracePanel, type LoopTracePanelTrace } from '../LoopTracePanel'
import { serverMessageToChatMessage, type AiServerMessage } from '../conversation-store'
import {
  buildAiRunTraceHref,
  readRunIdFromLoopTrace,
  readRunIdFromMessageMetadata,
} from '../run-trace-link'

const useBackendChromeMock = useBackendChrome as jest.MockedFunction<typeof useBackendChrome>

const RUN_ID = '6f1c2a4e-9d3b-4c1a-8e7f-2b5d9a0c1e33'

const dict = {
  'ai_assistant.chat.composerLabel': 'Message composer',
  'ai_assistant.chat.viewRunTrace': 'View run trace',
  'ai_assistant.chat.openFullTrace': 'Open full trace',
  'ui.ai.loopTrace.title': 'Pętla',
  'ui.ai.loopTrace.steps': 'Kroki: {count}',
  'ui.ai.loopTrace.tokens': '{count} tok.',
  'ui.ai.loopTrace.noSteps': 'Brak kroków.',
}

class MockResizeObserver {
  observe = jest.fn()
  disconnect = jest.fn()
}

function setGrantedFeatures(grantedFeatures: string[] | null) {
  useBackendChromeMock.mockReturnValue({
    payload: grantedFeatures === null
      ? null
      : ({ grantedFeatures } as unknown as BackendChromePayload),
    isLoading: false,
    isReady: true,
    refresh: async () => {},
  })
}

function createSseResponse(chunks: Array<Record<string, unknown>>) {
  const encoder = new TextEncoder()
  const raw = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')
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
  const self = {
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

function buildTrace(overrides: Partial<LoopTracePanelTrace> = {}): LoopTracePanelTrace {
  return {
    agentId: 'customers.account_assistant',
    turnId: 'turn-1',
    steps: [],
    stopReason: 'finish-reason',
    totalDurationMs: 420,
    totalUsage: { inputTokens: 10, outputTokens: 5 },
    ...overrides,
  }
}

async function sendTurn(trace: Record<string, unknown>) {
  const fetchMock = apiFetch as unknown as jest.Mock
  fetchMock.mockResolvedValueOnce(
    createSseResponse([
      { type: 'text-delta', id: 'text-1', delta: 'Answer ready.' },
      { type: 'loop-finish', trace },
    ]),
  )
  renderWithProviders(<AiChat agent="customers.account_assistant" />, { dict })
  const textarea = screen.getByLabelText('Message composer') as HTMLTextAreaElement
  fireEvent.change(textarea, { target: { value: 'Question' } })
  await act(async () => {
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
  })
  await waitFor(() => {
    expect(screen.getByText('Answer ready.')).toBeInTheDocument()
  })
}

function buildServerMessage(overrides: Partial<AiServerMessage>): AiServerMessage {
  return {
    id: 'server-1',
    clientMessageId: 'client-1',
    role: 'assistant',
    content: 'Persisted answer',
    uiParts: [],
    attachmentIds: [],
    files: [],
    model: null,
    metadata: null,
    createdAt: new Date().toISOString(),
    senderUserId: null,
    ...overrides,
  }
}

describe('chat run trace links', () => {
  beforeAll(() => {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver
  })

  beforeEach(() => {
    jest.clearAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
    setGrantedFeatures(['ai_assistant.view', 'ai_assistant.runs.view'])
  })

  describe('runId extraction', () => {
    it('reads the run id from a loop-finish trace', () => {
      expect(readRunIdFromLoopTrace({ runId: RUN_ID })).toBe(RUN_ID)
      expect(readRunIdFromLoopTrace({ runId: '  ' })).toBeNull()
      expect(readRunIdFromLoopTrace({})).toBeNull()
      expect(readRunIdFromLoopTrace(null)).toBeNull()
    })

    it('reads the run id from persisted message metadata', () => {
      expect(readRunIdFromMessageMetadata({ runId: RUN_ID })).toBe(RUN_ID)
      expect(readRunIdFromMessageMetadata({ runId: 42 })).toBeNull()
      expect(readRunIdFromMessageMetadata(null)).toBeNull()
    })

    it('maps metadata.runId onto assistant messages loaded from the server', () => {
      const assistant = serverMessageToChatMessage(buildServerMessage({ metadata: { runId: RUN_ID } }))
      expect(assistant?.runId).toBe(RUN_ID)
      const withoutRun = serverMessageToChatMessage(buildServerMessage({ metadata: {} }))
      expect(withoutRun?.runId).toBeUndefined()
      const user = serverMessageToChatMessage(
        buildServerMessage({ role: 'user', metadata: { runId: RUN_ID } }),
      )
      expect(user?.runId).toBeUndefined()
    })

    it('builds the run detail href', () => {
      expect(buildAiRunTraceHref(RUN_ID)).toBe(`/backend/config/ai-assistant/runs/${RUN_ID}`)
    })
  })

  describe('<AiChat> footer button', () => {
    it('links the streamed assistant message to its run when the feature is granted', async () => {
      await sendTurn(buildTrace({ runId: RUN_ID }))
      const link = await screen.findByRole('link', { name: 'View run trace' })
      expect(link.getAttribute('href')).toBe(`/backend/config/ai-assistant/runs/${RUN_ID}`)
    })

    it('accepts a wildcard feature grant', async () => {
      setGrantedFeatures(['ai_assistant.*'])
      await sendTurn(buildTrace({ runId: RUN_ID }))
      expect(await screen.findByRole('link', { name: 'View run trace' })).toBeInTheDocument()
    })

    it('hides the button without ai_assistant.runs.view', async () => {
      setGrantedFeatures(['ai_assistant.view'])
      await sendTurn(buildTrace({ runId: RUN_ID }))
      expect(screen.queryByRole('link', { name: 'View run trace' })).not.toBeInTheDocument()
    })

    it('hides the button when the turn carries no run id', async () => {
      await sendTurn(buildTrace())
      expect(screen.queryByRole('link', { name: 'View run trace' })).not.toBeInTheDocument()
    })
  })

  describe('<LoopTracePanel>', () => {
    it('renders translated labels', () => {
      renderWithProviders(<LoopTracePanel trace={buildTrace()} />, { dict })
      expect(screen.getByText('Pętla')).toBeInTheDocument()
      expect(screen.getByText('Kroki: 0')).toBeInTheDocument()
      expect(screen.getByText('15 tok.')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { expanded: false }))
      expect(screen.getByText('Brak kroków.')).toBeInTheDocument()
    })

    it('shows the open-full-trace link when a run id is known and the feature is granted', () => {
      renderWithProviders(<LoopTracePanel trace={buildTrace({ runId: RUN_ID })} />, { dict })
      const link = screen.getByRole('link', { name: 'Open full trace' })
      expect(link.getAttribute('href')).toBe(`/backend/config/ai-assistant/runs/${RUN_ID}`)
    })

    it('hides the link without a run id', () => {
      renderWithProviders(<LoopTracePanel trace={buildTrace()} />, { dict })
      expect(screen.queryByRole('link', { name: 'Open full trace' })).not.toBeInTheDocument()
    })

    it('hides the link without ai_assistant.runs.view', () => {
      setGrantedFeatures(['ai_assistant.view'])
      renderWithProviders(<LoopTracePanel trace={buildTrace({ runId: RUN_ID })} />, { dict })
      expect(screen.queryByRole('link', { name: 'Open full trace' })).not.toBeInTheDocument()
    })
  })
})
