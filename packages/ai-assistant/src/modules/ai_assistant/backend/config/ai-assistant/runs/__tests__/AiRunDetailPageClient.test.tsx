/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import en from '../../../../../i18n/en.json'
import { AiRunDetailPageClient, groupRunSteps } from '../[id]/AiRunDetailPageClient'
import type { AgentRunDetailResponse } from '../../../../../components/agent-runs/agentRunsShared'

const apiCallMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: jest.fn(),
}))

const dict = en as Record<string, string>

const RUN_ID = '11111111-1111-4111-8111-111111111111'

function buildDetail(overrides: Partial<AgentRunDetailResponse['run']> = {}): AgentRunDetailResponse {
  return {
    run: {
      id: RUN_ID,
      agentId: 'catalog.merchandiser',
      agentVersion: '3',
      executionMode: 'chat',
      channel: 'chat',
      status: 'completed',
      modelId: 'gpt-test',
      providerId: 'openai',
      inputTokens: 120,
      outputTokens: 30,
      stepCount: 1,
      toolCallCount: 1,
      durationMs: 900,
      conversationId: 'conv-1',
      userId: '22222222-2222-4222-8222-222222222222',
      captureLevel: 'full',
      startedAt: '2026-10-22T10:00:00.000Z',
      completedAt: '2026-10-22T10:00:00.900Z',
      updatedAt: '2026-10-22T10:00:00.900Z',
      moduleId: 'catalog',
      agentDefinitionHash: 'abcdef0123456789abcdef',
      promptOverrideId: null,
      promptOverrideVersion: null,
      turnId: 'turn-1',
      correlationId: null,
      apiKeyId: null,
      baseUrlHost: null,
      modelParams: { temperature: 0.2 },
      effectiveMutationPolicy: 'confirm-required',
      toolNames: ['catalog.list_products'],
      stopReason: null,
      finishReason: 'stop',
      cachedInputTokens: null,
      reasoningTokens: null,
      inputText: 'Find red shoes',
      outputText: 'Here are the red shoes',
      contentTruncated: false,
      systemPromptHash: 'hash',
      systemPrompt: null,
      citations: null,
      error: null,
      createdAt: '2026-10-22T10:00:00.900Z',
      ...overrides,
    } as AgentRunDetailResponse['run'],
    steps: [
      {
        id: 'step-1',
        stepIndex: 0,
        modelId: 'gpt-test',
        finishReason: 'tool-calls',
        inputTokens: 100,
        outputTokens: 20,
        text: null,
        textTruncated: false,
        endedAt: '2026-10-22T10:00:00.500Z',
        durationMs: 500,
        updatedAt: '2026-10-22T10:00:00.500Z',
      },
    ],
    toolCalls: [
      {
        id: 'call-1',
        stepIndex: 0,
        callIndex: 0,
        toolCallId: 'tc-1',
        toolName: 'catalog.list_products',
        isMutation: false,
        pendingActionId: null,
        argKeys: ['query'],
        args: { query: 'red shoes' },
        result: { items: 2 },
        argsTruncated: false,
        resultTruncated: true,
        resultBytes: 512,
        error: { code: 'tool_failed', message: 'Upstream timeout' },
        durationMs: 120,
        updatedAt: '2026-10-22T10:00:00.400Z',
      },
    ],
    links: { conversationId: 'conv-1', pendingActionIds: [] },
  }
}

describe('AiRunDetailPageClient', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
  })

  it('shows the loading state while the run is pending', () => {
    apiCallMock.mockReturnValue(new Promise(() => undefined))
    renderWithProviders(<AiRunDetailPageClient id={RUN_ID} />, { dict })
    expect(screen.getByText(dict['ai_assistant.runs.detail.loading'])).toBeTruthy()
  })

  it('shows the error state with a retry button when the request fails', async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 500, result: null })
    renderWithProviders(<AiRunDetailPageClient id={RUN_ID} />, { dict })
    expect(await screen.findByText(dict['ai_assistant.runs.detail.loadError'])).toBeTruthy()
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: buildDetail() })
    fireEvent.click(screen.getByText(dict['ai_assistant.runs.detail.retry']))
    expect(await screen.findByText('catalog.merchandiser')).toBeTruthy()
  })

  it('shows the not-found state on 404', async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 404, result: { error: 'Agent run not found.' } })
    renderWithProviders(<AiRunDetailPageClient id={RUN_ID} />, { dict })
    expect(await screen.findByText(dict['ai_assistant.runs.detail.notFound'])).toBeTruthy()
  })

  it('renders run facts, captured content, the conversation link and expandable steps', async () => {
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: buildDetail() })
    const { container } = renderWithProviders(<AiRunDetailPageClient id={RUN_ID} />, { dict })

    expect(await screen.findByText('catalog.merchandiser')).toBeTruthy()
    expect(String(apiCallMock.mock.calls[0][0])).toBe(`/api/ai_assistant/ai/runs/${RUN_ID}`)
    expect(screen.getByText(dict['ai_assistant.runs.status.completed'])).toBeTruthy()
    expect(screen.getByText('openai/gpt-test')).toBeTruthy()
    expect(screen.getByText('Find red shoes')).toBeTruthy()
    expect(container.querySelector('[data-agent-run-content-not-captured]')).toBeNull()
    const conversationLink = container.querySelector('[data-agent-run-open-conversation]')
    expect(conversationLink?.getAttribute('href')).toBe('/backend?openAiConversation=conv-1')

    expect(screen.queryByText('catalog.list_products')).toBeNull()
    fireEvent.click(screen.getByText('Step 1'))
    expect(screen.getByText('catalog.list_products')).toBeTruthy()
    expect(screen.getByText('tool_failed: Upstream timeout')).toBeTruthy()
    expect(screen.getByText(dict['ai_assistant.runs.detail.truncated'])).toBeTruthy()
  })

  it('shows the content-not-captured notice for metadata-only runs', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 200,
      result: buildDetail({ captureLevel: 'metadata', inputText: null, outputText: null }),
    })
    const { container } = renderWithProviders(<AiRunDetailPageClient id={RUN_ID} />, { dict })
    expect(await screen.findByText(dict['ai_assistant.runs.detail.contentNotCaptured'])).toBeTruthy()
    expect(container.querySelector('[data-agent-run-content-not-captured]')).not.toBeNull()
    expect(screen.queryByText(dict['ai_assistant.runs.detail.input'])).toBeNull()
  })

  it('renders the run citations as a numbered Sources section', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 200,
      result: buildDetail({
        citations: [
          { kind: 'record', ref: 'catalog:product:p1', label: 'Red shoe', href: '/backend/catalog/products/p1' },
          { kind: 'kb', ref: 'returns@2', quote: 'Returns within 30 days' },
        ],
      }),
    })
    const { container } = renderWithProviders(<AiRunDetailPageClient id={RUN_ID} />, { dict })
    expect(await screen.findByText(dict['ai_assistant.runs.detail.citations'])).toBeTruthy()
    const sources = container.querySelector('[data-agent-run-sources]')
    expect(sources).not.toBeNull()
    expect(sources?.querySelectorAll('li')).toHaveLength(2)
    expect(screen.getByText('Red shoe').closest('a')?.getAttribute('href')).toBe('/backend/catalog/products/p1')
    expect(screen.getByText('returns@2')).toBeTruthy()
    expect(screen.getByText('Returns within 30 days')).toBeTruthy()
  })

  it('omits the Sources section when the run has no citations or was captured at metadata level', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 200,
      result: buildDetail({ captureLevel: 'metadata', citations: [{ kind: 'kb', ref: 'a' }] }),
    })
    const { container } = renderWithProviders(<AiRunDetailPageClient id={RUN_ID} />, { dict })
    expect(await screen.findByText(dict['ai_assistant.runs.detail.contentNotCaptured'])).toBeTruthy()
    expect(container.querySelector('[data-agent-run-sources]')).toBeNull()
  })

  it('renders the no-steps message when the run recorded no steps', async () => {
    const detail = buildDetail()
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { ...detail, steps: [], toolCalls: [] } })
    renderWithProviders(<AiRunDetailPageClient id={RUN_ID} />, { dict })
    expect(await screen.findByText(dict['ai_assistant.runs.detail.noSteps'])).toBeTruthy()
  })
})

describe('groupRunSteps', () => {
  it('groups tool calls under their step, keeps orphan tool calls and sorts by index', () => {
    const detail = buildDetail()
    const orphan = { ...detail.toolCalls[0], id: 'call-2', stepIndex: 2, callIndex: 0 }
    const second = { ...detail.toolCalls[0], id: 'call-3', stepIndex: 0, callIndex: 1 }
    const groups = groupRunSteps(detail.steps, [orphan, second, detail.toolCalls[0]])
    expect(groups.map((group) => group.stepIndex)).toEqual([0, 2])
    expect(groups[0].toolCalls.map((call) => call.id)).toEqual(['call-1', 'call-3'])
    expect(groups[1].step).toBeNull()
  })
})
