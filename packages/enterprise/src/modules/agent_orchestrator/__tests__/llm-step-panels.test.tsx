/**
 * @jest-environment jsdom
 */

import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LlmStepPanels } from '../components/trace/LlmStepPanels'
import {
  MESSAGE_PAGE_SIZE,
  buildArtifactUrl,
  classifyArtifactResponse,
  listRequestParameters,
  parseLlmRequestPayload,
  parseLlmResponsePayload,
} from '../components/trace/llmStepContent'
import type { LlmStepRow } from '../components/trace/llmStepRows'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

const apiCallMock = apiCall as jest.Mock
const flashMock = flash as jest.Mock

const RUN_ID = '11111111-1111-4111-8111-111111111111'
const REQUEST_KEY = '1761650000000/request-object'
const RESPONSE_KEY = '1761650000000/response-object'
const REQUEST_HASH = `sha256:${'a'.repeat(64)}`

function row(overrides: Partial<LlmStepRow> = {}): LlmStepRow {
  return {
    id: 'span-1',
    step: 1,
    recorded: true,
    provider: 'example-provider',
    requestModel: 'model-large',
    responseModel: null,
    parameters: [],
    usage: {},
    costMicros: 1_500_000,
    currency: 'USD',
    latencyMs: 400,
    finishReasons: ['stop'],
    fidelity: 'exact',
    content: {
      status: 'stored',
      request: { key: REQUEST_KEY, sha256: REQUEST_HASH, bytes: 2048 },
      response: { key: RESPONSE_KEY, sha256: null, bytes: 512 },
    },
    ...overrides,
  }
}

const REQUEST_PAYLOAD = {
  schema: 'om.llm_request.v1',
  provider: 'example-provider',
  modelId: 'model-large',
  system: 'You are a careful assistant.',
  messages: [
    { role: 'user', content: 'Summarize the ticket.' },
    { role: 'assistant', content: [{ type: 'text', text: 'Looking it up.' }, { type: 'tool-call', toolName: 'lookup' }] },
  ],
  tools: [{ name: 'lookup', description: 'Find a ticket', inputSchema: { type: 'object' } }],
  responseFormat: null,
  params: { temperature: 0.2 },
}

const RESPONSE_PAYLOAD = {
  schema: 'om.llm_response.v1',
  finishReason: 'stop',
  content: [{ type: 'text', text: 'The ticket is resolved.' }],
  object: { verdict: 'resolved' },
  usage: { inputTokens: 120, outputTokens: 30 },
}

function respond(status: number, result: unknown) {
  return { ok: status >= 200 && status < 300, status, result, response: {}, cacheStatus: null }
}

beforeEach(() => {
  apiCallMock.mockReset()
  flashMock.mockReset()
})

describe('llmStepContent helpers', () => {
  it('maps artifact statuses onto fetch states', () => {
    expect(classifyArtifactResponse(true, 200, { a: 1 })).toEqual({ status: 'ok', payload: { a: 1 } })
    expect(classifyArtifactResponse(false, 403, null)).toEqual({ status: 'forbidden' })
    expect(classifyArtifactResponse(false, 410, null)).toEqual({ status: 'expired' })
    expect(classifyArtifactResponse(false, 502, null)).toEqual({ status: 'unavailable' })
    expect(classifyArtifactResponse(false, 500, null)).toEqual({ status: 'error' })
  })

  it('builds the artifact url with encoded key', () => {
    expect(buildArtifactUrl(RUN_ID, 'llm_request', 'a/b c')).toBe(
      `/api/agent_orchestrator/runs/${RUN_ID}/artifact?kind=llm_request&key=a%2Fb%20c`,
    )
  })

  it('parses request payloads into role-labelled messages and parts', () => {
    const view = parseLlmRequestPayload(REQUEST_PAYLOAD)
    expect(view.system).toBe('You are a careful assistant.')
    expect(view.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(view.messages[1].parts).toEqual([
      { kind: 'text', text: 'Looking it up.' },
      { kind: 'data', value: { type: 'tool-call', toolName: 'lookup' } },
    ])
    expect(view.tools).toEqual([{ name: 'lookup', description: 'Find a ticket', inputSchema: { type: 'object' } }])
    expect(parseLlmRequestPayload({ schema: 'om.llm_request.v1', _truncated: true, originalBytes: 9 }).truncated).toBe(
      true,
    )
  })

  it('lists every call setting with absent values as provider default', () => {
    const rows = listRequestParameters({ temperature: 0.2, stopSequences: ['END'] })
    expect(rows.find((entry) => entry.name === 'temperature')?.value).toBe('0.2')
    expect(rows.find((entry) => entry.name === 'stopSequences')?.value).toBe('["END"]')
    expect(rows.find((entry) => entry.name === 'seed')?.value).toBeNull()
  })

  it('parses response payloads', () => {
    const view = parseLlmResponsePayload(RESPONSE_PAYLOAD)
    expect(view.finishReason).toBe('stop')
    expect(view.hasObject).toBe(true)
    expect(view.usage).toEqual([
      { name: 'inputTokens', value: '120' },
      { name: 'outputTokens', value: '30' },
    ])
  })
})

describe('LlmStepPanels', () => {
  it('loads and renders the request with view_content', async () => {
    apiCallMock.mockResolvedValue(respond(200, { payload: REQUEST_PAYLOAD }))
    renderWithProviders(<LlmStepPanels runId={RUN_ID} row={row()} canViewContent />)
    await screen.findByTestId('llm-request-view')
    expect(apiCallMock).toHaveBeenCalledTimes(1)
    expect(apiCallMock.mock.calls[0][0]).toBe(buildArtifactUrl(RUN_ID, 'llm_request', REQUEST_KEY))
    expect(screen.getByText('You are a careful assistant.')).not.toBeNull()
    expect(screen.getAllByTestId('llm-request-message')).toHaveLength(2)
    expect(screen.getByText('user')).not.toBeNull()
    expect(screen.getAllByText('agent_orchestrator.trace.providerDefault').length).toBeGreaterThan(0)
  })

  it('fetches the response only when its tab is opened and keeps the request cached', async () => {
    apiCallMock.mockImplementation(async (url: string) =>
      url.includes('kind=llm_response')
        ? respond(200, { payload: RESPONSE_PAYLOAD })
        : respond(200, { payload: REQUEST_PAYLOAD }),
    )
    renderWithProviders(<LlmStepPanels runId={RUN_ID} row={row()} canViewContent />)
    await screen.findByTestId('llm-request-view')
    fireEvent.click(screen.getByRole('tab', { name: 'agent_orchestrator.trace.response' }))
    await screen.findByTestId('llm-response-view')
    expect(screen.getByText('The ticket is resolved.')).not.toBeNull()
    expect(screen.getByText(/1\.50 USD/)).not.toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'agent_orchestrator.trace.request' }))
    await screen.findByTestId('llm-request-view')
    expect(apiCallMock).toHaveBeenCalledTimes(2)
  })

  it('shows the permission alert with hashes and skips the call without view_content', () => {
    renderWithProviders(<LlmStepPanels runId={RUN_ID} row={row()} canViewContent={false} />)
    expect(screen.getByTestId('llm-content-forbidden')).not.toBeNull()
    expect(screen.getByText(REQUEST_HASH)).not.toBeNull()
    expect(screen.getByText('2048')).not.toBeNull()
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('falls back to the permission alert on a 403', async () => {
    apiCallMock.mockResolvedValue(respond(403, { error: 'Forbidden' }))
    renderWithProviders(<LlmStepPanels runId={RUN_ID} row={row()} canViewContent={null} />)
    expect(await screen.findByTestId('llm-content-forbidden')).not.toBeNull()
    expect(apiCallMock).toHaveBeenCalledTimes(1)
  })

  it('shows the expired badge on a 410', async () => {
    apiCallMock.mockResolvedValue(respond(410, { error: 'expired' }))
    renderWithProviders(<LlmStepPanels runId={RUN_ID} row={row()} canViewContent />)
    expect(await screen.findByText('agent_orchestrator.trace.contentExpired')).not.toBeNull()
  })

  it('shows the storage unavailable badge on a 502', async () => {
    apiCallMock.mockResolvedValue(respond(502, { error: 'unavailable' }))
    renderWithProviders(<LlmStepPanels runId={RUN_ID} row={row()} canViewContent />)
    expect(await screen.findByText('agent_orchestrator.trace.contentStorageUnavailable')).not.toBeNull()
  })

  it('shows an error message on other failures', async () => {
    apiCallMock.mockResolvedValue(respond(500, null))
    renderWithProviders(<LlmStepPanels runId={RUN_ID} row={row()} canViewContent />)
    expect(await screen.findByText('agent_orchestrator.trace.contentError')).not.toBeNull()
  })

  it('shows not captured with the status reason when no key was recorded', () => {
    renderWithProviders(
      <LlmStepPanels
        runId={RUN_ID}
        row={row({
          content: {
            status: 'disabled',
            request: { key: null, sha256: REQUEST_HASH, bytes: 10 },
            response: { key: null, sha256: null, bytes: null },
          },
        })}
        canViewContent
      />,
    )
    expect(screen.getByTestId('llm-content-not-captured')).not.toBeNull()
    expect(screen.getByText('agent_orchestrator.trace.contentStatus.disabled')).not.toBeNull()
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('copies the loaded payload as JSON', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    apiCallMock.mockResolvedValue(respond(200, { payload: REQUEST_PAYLOAD }))
    renderWithProviders(<LlmStepPanels runId={RUN_ID} row={row()} canViewContent />)
    await screen.findByTestId('llm-request-view')
    fireEvent.click(screen.getByRole('button', { name: 'agent_orchestrator.trace.copyAsJson' }))
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(REQUEST_PAYLOAD, null, 2))
    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('agent_orchestrator.trace.copied', 'success'))
  })

  it('renders the first page of a long message list with a show more control', async () => {
    const messages = Array.from({ length: MESSAGE_PAGE_SIZE + 5 }, (_entry, index) => ({
      role: 'user',
      content: `message ${index}`,
    }))
    apiCallMock.mockResolvedValue(respond(200, { payload: { ...REQUEST_PAYLOAD, messages } }))
    renderWithProviders(<LlmStepPanels runId={RUN_ID} row={row()} canViewContent />)
    await screen.findByTestId('llm-request-view')
    expect(screen.getAllByTestId('llm-request-message')).toHaveLength(MESSAGE_PAGE_SIZE)
    fireEvent.click(screen.getByRole('button', { name: 'agent_orchestrator.trace.showMoreMessages' }))
    expect(screen.getAllByTestId('llm-request-message')).toHaveLength(MESSAGE_PAGE_SIZE + 5)
  })
})
