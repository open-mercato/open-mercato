/**
 * @jest-environment jsdom
 */

/**
 * Acceptance tests for the visible agent task plan
 * (spec `.ai/specs/2026-05-13-ai-chat-visible-task-plan.md`).
 *
 * Asserts that:
 *   - `useAiChat` merges `data-agent-task-plan` snapshots and
 *     `data-agent-task-update` deltas into the assistant message.
 *   - `<AiChat>` renders running/done/failed states above tool-call rows
 *     without hiding text output.
 *   - Unknown task-plan chunks are ignored safely.
 */

// jsdom polyfills (same shape as the existing AiChat tests).
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
import { AiChat } from '../AiChat'

const dict = {
  'ai_assistant.chat.assistantRoleLabel': 'Assistant',
  'ai_assistant.chat.cancel': 'Cancel streaming response',
  'ai_assistant.chat.composerLabel': 'Message composer',
  'ai_assistant.chat.composerPlaceholder': 'Message the AI agent...',
  'ai_assistant.chat.errorTitle': 'Agent dispatch failed',
  'ai_assistant.chat.agentTasksTitle': 'Tool calls',
  'ai_assistant.chat.regionLabel': 'AI chat',
  'ai_assistant.chat.send': 'Send message',
  'ai_assistant.chat.taskPlanTitle': 'Plan',
  'ai_assistant.chat.taskRunning': 'running…',
  'ai_assistant.chat.taskDone': 'done',
  'ai_assistant.chat.taskFailed': 'failed',
  'ai_assistant.chat.taskPending': 'pending',
  'ai_assistant.chat.taskSkipped': 'skipped',
  'ai_assistant.chat.thinking': 'Thinking...',
  'ai_assistant.chat.transcriptLabel': 'Chat transcript',
  'ai_assistant.chat.userRoleLabel': 'You',
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

function createUiMessageSseResponse(chunks: Array<Record<string, unknown>>): ResponseLike {
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

describe('<AiChat> task plan', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.localStorage.clear()
  })

  async function sendAndWait(): Promise<void> {
    const textarea = screen.getByLabelText('Message composer') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Do something' } })
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
    })
    await waitFor(() => {
      expect((apiFetch as unknown as jest.Mock).mock.calls.length).toBeGreaterThan(0)
    })
  }

  it('renders a running task from a snapshot chunk above the tool-call row', async () => {
    const fetchMock = apiFetch as unknown as jest.Mock
    fetchMock.mockResolvedValueOnce(
      createUiMessageSseResponse([
        {
          type: 'data-agent-task-plan',
          planId: 'turn_abc',
          tasks: [
            {
              id: 'call-1',
              label: 'Customers · List people',
              state: 'running',
              source: 'agent',
              toolCallId: 'call-1',
            },
          ],
        },
        { type: 'tool-input-start', toolCallId: 'call-1', toolName: 'customers__list_people' },
        { type: 'text-delta', id: 't', delta: 'Working on it…' },
      ]),
    )

    renderWithProviders(<AiChat agent="customers.account_assistant" />, { dict })
    await sendAndWait()

    await waitFor(() => {
      expect(screen.getByText('Customers · List people')).toBeInTheDocument()
    })
    expect(screen.getByText('Plan')).toBeInTheDocument()
    const taskRow = document.querySelector('[data-ai-chat-task-id="call-1"]') as HTMLElement | null
    expect(taskRow).not.toBeNull()
    expect(taskRow?.getAttribute('data-ai-chat-task-state')).toBe('running')
    expect(taskRow?.textContent).toContain('running…')
    expect(screen.getByText('Working on it…')).toBeInTheDocument()
    // Existing tool-call detail row is still rendered separately with a friendly caption.
    expect(screen.getByText('Customers - List People (customers.list_people)')).toBeInTheDocument()
  })

  it('updates task state from running to done when a task-update arrives', async () => {
    const fetchMock = apiFetch as unknown as jest.Mock
    fetchMock.mockResolvedValueOnce(
      createUiMessageSseResponse([
        {
          type: 'data-agent-task-plan',
          planId: 'turn_def',
          tasks: [
            {
              id: 'call-1',
              label: 'Catalog · Search products',
              state: 'running',
              source: 'agent',
              toolCallId: 'call-1',
            },
          ],
        },
        {
          type: 'data-agent-task-update',
          planId: 'turn_def',
          task: {
            id: 'call-1',
            label: 'Catalog · Search products',
            state: 'done',
            source: 'agent',
            toolCallId: 'call-1',
          },
        },
        { type: 'text-delta', id: 't', delta: 'All set.' },
      ]),
    )

    renderWithProviders(<AiChat agent="customers.account_assistant" />, { dict })
    await sendAndWait()

    await waitFor(() => {
      expect(screen.getByText('done')).toBeInTheDocument()
    })
    expect(screen.getByText('Catalog · Search products')).toBeInTheDocument()
    expect(screen.getByText('All set.')).toBeInTheDocument()
    expect(screen.queryByText('running…')).not.toBeInTheDocument()
  })

  it('renders agent-authored plan snapshots without exposing the internal plan tool row', async () => {
    const fetchMock = apiFetch as unknown as jest.Mock
    fetchMock.mockResolvedValueOnce(
      createUiMessageSseResponse([
        { type: 'tool-input-start', toolCallId: 'plan-call', toolName: 'meta__update_task_plan' },
        {
          type: 'data-agent-task-plan',
          planId: 'turn_plan',
          tasks: [
            {
              id: 'search-step',
              label: 'Search matching products',
              state: 'pending',
              source: 'agent',
            },
          ],
        },
        {
          type: 'tool-input-available',
          toolCallId: 'plan-call',
          toolName: 'meta__update_task_plan',
          input: { tasks: [{ label: 'Search matching products' }] },
        },
        {
          type: 'tool-output-available',
          toolCallId: 'plan-call',
          output: { ok: true },
        },
        { type: 'text-delta', id: 't', delta: 'Starting now.' },
      ]),
    )

    renderWithProviders(<AiChat agent="customers.account_assistant" />, { dict })
    await sendAndWait()

    await waitFor(() => {
      expect(screen.getByText('Search matching products')).toBeInTheDocument()
    })
    expect(screen.getByText('pending')).toBeInTheDocument()
    expect(screen.queryByText('meta.update_task_plan')).not.toBeInTheDocument()
    expect(screen.getByText('Starting now.')).toBeInTheDocument()
  })

  it('renders failed state without hiding text output', async () => {
    const fetchMock = apiFetch as unknown as jest.Mock
    fetchMock.mockResolvedValueOnce(
      createUiMessageSseResponse([
        {
          type: 'data-agent-task-plan',
          planId: 'turn_ghi',
          tasks: [
            {
              id: 'call-1',
              label: 'Catalog · Search products',
              state: 'failed',
              source: 'agent',
              toolCallId: 'call-1',
            },
          ],
        },
        { type: 'text-delta', id: 't', delta: 'I could not search.' },
      ]),
    )

    renderWithProviders(<AiChat agent="customers.account_assistant" />, { dict })
    await sendAndWait()

    await waitFor(() => {
      expect(screen.getByText('failed')).toBeInTheDocument()
    })
    expect(screen.getByText('I could not search.')).toBeInTheDocument()
  })

  it('does not render runtime-derived tool lifecycle tasks as the visible plan', async () => {
    const fetchMock = apiFetch as unknown as jest.Mock
    fetchMock.mockResolvedValueOnce(
      createUiMessageSseResponse([
        {
          type: 'data-agent-task-plan',
          planId: 'turn_runtime',
          tasks: [
            {
              id: 'call-1',
              label: 'Customers · List deals',
              state: 'running',
              source: 'runtime',
              toolCallId: 'call-1',
            },
          ],
        },
        { type: 'tool-input-start', toolCallId: 'call-1', toolName: 'customers__list_deals' },
        { type: 'text-delta', id: 't', delta: 'Checking deals.' },
      ]),
    )

    renderWithProviders(<AiChat agent="customers.account_assistant" />, { dict })
    await sendAndWait()

    await waitFor(() => {
      expect(screen.getByText('Checking deals.')).toBeInTheDocument()
    })
    expect(screen.queryByText('Plan')).not.toBeInTheDocument()
    expect(screen.queryByText('Customers · List deals')).not.toBeInTheDocument()
    expect(screen.getByText('Customers - List Deals (customers.list_deals)')).toBeInTheDocument()
  })

  it('ignores task-update chunks that are missing required fields', async () => {
    const fetchMock = apiFetch as unknown as jest.Mock
    fetchMock.mockResolvedValueOnce(
      createUiMessageSseResponse([
        {
          type: 'data-agent-task-update',
          planId: 'turn_jkl',
          task: { id: '', label: 'Missing id', state: 'running', source: 'runtime' },
        },
        {
          type: 'data-agent-task-update',
          planId: 'turn_jkl',
          task: { id: 'call-1', label: '', state: 'running', source: 'runtime' },
        },
        { type: 'text-delta', id: 't', delta: 'Done with safe parser.' },
      ]),
    )

    renderWithProviders(<AiChat agent="customers.account_assistant" />, { dict })
    await sendAndWait()

    await waitFor(() => {
      expect(screen.getByText('Done with safe parser.')).toBeInTheDocument()
    })
    expect(screen.queryByText('Plan')).not.toBeInTheDocument()
  })
})
