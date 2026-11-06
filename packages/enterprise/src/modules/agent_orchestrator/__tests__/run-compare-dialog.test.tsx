/**
 * @jest-environment jsdom
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { RunCompareDialog } from '../components/trace/RunCompareDialog'
import { RunCopyMenu } from '../components/trace/RunCopyMenu'
import {
  RUN_COPY_SCHEMA,
  buildCompareCandidatesUrl,
  collectRunContent,
  mapWithConcurrency,
  pickDefaultCompareTarget,
  previousRunCandidates,
} from '../components/trace/runCompareView'
import { runListQuerySchema } from '../data/validators'
import type { RunView, SpanView } from '../components/types'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

const apiCallMock = apiCall as jest.Mock
const flashMock = flash as jest.Mock

const RUN_ID = '11111111-1111-4111-8111-111111111111'
const SOURCE_ID = '22222222-2222-4222-8222-222222222222'
const PREVIOUS_ID = '33333333-3333-4333-8333-333333333333'
const OLDER_ID = '44444444-4444-4444-8444-444444444444'

function runView(overrides: Partial<RunView> = {}): RunView {
  return {
    id: RUN_ID,
    agentId: 'agent.support',
    status: 'ok',
    resultKind: 'research',
    errorMessage: null,
    input: { ticket: 1 },
    output: null,
    outputArtifactKey: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: null,
    runtime: 'native',
    externalRunId: null,
    model: 'model-large',
    confidence: null,
    evalScore: null,
    evalPassed: null,
    goldenCaseId: null,
    goldenPassed: null,
    latencyMs: null,
    costMinor: null,
    inputTokens: null,
    outputTokens: null,
    currency: null,
    agentVersion: null,
    humanConfirmedAt: null,
    completedAt: null,
    flaggedAt: null,
    contextRouting: null,
    workflowInstanceId: null,
    rerunOfRunId: null,
    ...overrides,
  }
}

function llmSpan(id: string, sequence: number, attributes: Record<string, unknown>): SpanView {
  return {
    id,
    externalSpanId: null,
    parentSpanId: null,
    sequence,
    name: 'llm.call',
    kind: 'llm',
    startedAt: null,
    endedAt: null,
    durationMs: null,
    status: 'ok',
    attributes,
  }
}

const MANIFEST_SPAN: SpanView = {
  id: 'span-manifest',
  externalSpanId: null,
  parentSpanId: null,
  sequence: 0,
  name: 'run.manifest',
  kind: 'system',
  startedAt: null,
  endedAt: null,
  durationMs: null,
  status: 'ok',
  attributes: { 'om.agent.definition_hash': 'def-hash' },
}

const SPANS: SpanView[] = [
  MANIFEST_SPAN,
  llmSpan('span-1', 1, {
    'gen_ai.request.model': 'model-large',
    'om.content.request.key': '1761650000000/req-1',
    'om.content.response.key': '1761650000000/res-1',
  }),
  llmSpan('span-2', 2, { 'gen_ai.request.model': 'model-large', 'om.content.request.key': '1761650000000/req-2' }),
]

function side(runId: string, contentStatus: string) {
  return {
    runId,
    agentId: 'agent.support',
    status: 'ok',
    model: 'model-large',
    runtime: 'native',
    step: 0,
    llmStepCount: 2,
    spanId: 'span-1',
    spanName: 'llm.call',
    metadata: null,
    contentStatus,
  }
}

const COMPARE_INCLUDED = {
  step: 0,
  content: 'included',
  left: side(RUN_ID, 'ok'),
  right: side(SOURCE_ID, 'ok'),
  diff: {
    manifest: [{ key: 'om.agent.prompt_override_version', left: 'v2', right: 'v1' }],
    params: [{ key: 'gen_ai.request.temperature', left: 0.2, right: 0.7 }],
    systemPrompt: {
      changed: true,
      truncated: false,
      lines: [
        { op: 'equal', text: 'You are a support agent.' },
        { op: 'removed', text: 'Be brief.' },
        { op: 'added', text: 'Be thorough.' },
      ],
    },
    messages: { changed: true, truncated: false, entries: [{ path: '$[0].content', op: 'changed', left: 'a', right: 'b' }] },
    tools: { changed: false, truncated: false, entries: [] },
  },
}

const COMPARE_FORBIDDEN = {
  step: 0,
  content: 'forbidden',
  left: side(RUN_ID, 'forbidden'),
  right: side(PREVIOUS_ID, 'forbidden'),
  diff: { manifest: [], params: [] },
}

function respond(status: number, result: unknown) {
  return { ok: status >= 200 && status < 300, status, result, response: {}, cacheStatus: null }
}

function routeApi(compareResult: unknown, listItems: unknown[] = []) {
  apiCallMock.mockImplementation((url: string) => {
    if (url.includes('/compare?')) return Promise.resolve(respond(200, compareResult))
    if (url.startsWith('/api/agent_orchestrator/runs?')) return Promise.resolve(respond(200, { items: listItems }))
    return Promise.resolve(respond(404, null))
  })
}

function compareCalls(): string[] {
  return apiCallMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes('/compare?'))
}

const LIST_ITEMS = [
  { id: OLDER_ID, agent_id: 'agent.support', status: 'ok', created_at: '2026-10-18T10:00:00.000Z' },
  { id: PREVIOUS_ID, agent_id: 'agent.support', status: 'error', created_at: '2026-10-19T10:00:00.000Z' },
]

beforeEach(() => {
  apiCallMock.mockReset()
  flashMock.mockReset()
})

describe('run compare helpers', () => {
  it('defaults to the re-run source, else the latest earlier run of the agent', () => {
    const subject = { id: RUN_ID, agentId: 'agent.support', createdAt: '2026-10-20T10:00:00.000Z', rerunOfRunId: null }
    const candidates = previousRunCandidates(subject, [
      runView({ id: OLDER_ID, createdAt: '2026-10-18T10:00:00.000Z' }),
      runView({ id: PREVIOUS_ID, createdAt: '2026-10-19T10:00:00.000Z' }),
      runView({ id: 'later', createdAt: '2026-10-21T10:00:00.000Z' }),
      runView({ id: 'other-agent', agentId: 'agent.other', createdAt: '2026-10-19T12:00:00.000Z' }),
      runView(),
    ])
    expect(candidates.map((candidate) => candidate.id)).toEqual([PREVIOUS_ID, OLDER_ID])
    expect(pickDefaultCompareTarget(subject, candidates)).toBe(PREVIOUS_ID)
    expect(pickDefaultCompareTarget({ ...subject, rerunOfRunId: SOURCE_ID }, candidates)).toBe(SOURCE_ID)
    expect(pickDefaultCompareTarget(subject, [])).toBeNull()
  })

  it('looks up earlier runs of the same agent within the page size cap', () => {
    const url = new URL(
      buildCompareCandidatesUrl({ id: RUN_ID, agentId: 'agent.support', createdAt: '2026-10-20T10:00:00.000Z' }),
      'http://localhost',
    )
    expect(url.pathname).toBe('/api/agent_orchestrator/runs')
    expect(url.searchParams.get('agentId')).toBe('agent.support')
    expect(url.searchParams.get('createdBefore')).toBe('2026-10-20T10:00:00.000Z')
    expect(Number(url.searchParams.get('pageSize'))).toBeLessThanOrEqual(100)
  })

  it('bounds concurrent work', async () => {
    let active = 0
    let peak = 0
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active -= 1
      return value * 2
    })
    expect(results).toEqual([2, 4, 6, 8, 10, 12])
    expect(peak).toBe(2)
  })

  it('collects request and response content per model call with per-side status', async () => {
    const fetcher = jest.fn(async (kind: string, key: string) =>
      key.endsWith('req-2') ? { status: 'expired' as const } : { status: 'ok' as const, payload: { kind, key } },
    )
    const content = await collectRunContent(SPANS, fetcher)
    expect(content).toEqual([
      {
        spanId: 'span-1',
        step: 1,
        request: { status: 'ok', payload: { kind: 'llm_request', key: '1761650000000/req-1' } },
        response: { status: 'ok', payload: { kind: 'llm_response', key: '1761650000000/res-1' } },
      },
      { spanId: 'span-2', step: 2, request: { status: 'expired' }, response: { status: 'not_captured' } },
    ])
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('accepts createdBefore on the runs list and applies it as an upper created_at bound', () => {
    expect(runListQuerySchema.safeParse({ createdBefore: '2026-10-20T10:00:00.000Z' }).success).toBe(true)
    expect(runListQuerySchema.safeParse({ createdBefore: 'yesterday' }).success).toBe(false)
    const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'runs', 'route.ts'), 'utf8')
    expect(source).toContain('if (query.createdBefore) createdAtRange.$lt')
  })
})

describe('RunCompareDialog', () => {
  it('compares against the re-run source by default and renders the diffs', async () => {
    routeApi(COMPARE_INCLUDED, LIST_ITEMS)
    renderWithProviders(
      <RunCompareDialog open onOpenChange={jest.fn()} run={runView({ rerunOfRunId: SOURCE_ID })} spans={SPANS} />,
    )
    await screen.findByTestId('run-compare-result')
    expect(compareCalls()[0]).toBe(`/api/agent_orchestrator/runs/${RUN_ID}/compare?with=${SOURCE_ID}&step=0`)
    expect(screen.getByText('om.agent.prompt_override_version')).toBeTruthy()
    expect(screen.getByText('gen_ai.request.temperature')).toBeTruthy()
    const prompt = screen.getByTestId('compare-system-prompt')
    expect(prompt.querySelector('[data-op="removed"]')?.textContent).toContain('Be brief.')
    expect(prompt.querySelector('[data-op="added"]')?.textContent).toContain('Be thorough.')
    expect(screen.getByText('$[0].content')).toBeTruthy()
    expect(screen.queryByTestId('compare-content-forbidden')).toBeNull()
  })

  it('falls back to the previous run of the same agent', async () => {
    routeApi(COMPARE_FORBIDDEN, LIST_ITEMS)
    renderWithProviders(<RunCompareDialog open onOpenChange={jest.fn()} run={runView()} spans={SPANS} />)
    await screen.findByTestId('run-compare-result')
    const listCall = apiCallMock.mock.calls.map((call) => String(call[0])).find((url) => url.includes('runs?'))
    expect(listCall).toContain('agentId=agent.support')
    expect(compareCalls()[0]).toContain(`with=${PREVIOUS_ID}`)
  })

  it('explains the view_content permission when content is forbidden', async () => {
    routeApi(COMPARE_FORBIDDEN, LIST_ITEMS)
    renderWithProviders(<RunCompareDialog open onOpenChange={jest.fn()} run={runView()} spans={SPANS} />)
    const alert = await screen.findByTestId('compare-content-forbidden')
    expect(alert.textContent).toContain('agent_orchestrator.trace.compare.contentForbidden')
    expect(screen.queryByTestId('compare-system-prompt')).toBeNull()
  })

  it('shows an empty state when no other run exists', async () => {
    routeApi(COMPARE_FORBIDDEN, [])
    renderWithProviders(<RunCompareDialog open onOpenChange={jest.fn()} run={runView()} spans={SPANS} />)
    await screen.findByTestId('compare-no-target')
    expect(compareCalls()).toHaveLength(0)
  })

  it('recomputes on Cmd/Ctrl+Enter and closes on Escape', async () => {
    routeApi(COMPARE_INCLUDED, LIST_ITEMS)
    const onOpenChange = jest.fn()
    renderWithProviders(
      <RunCompareDialog open onOpenChange={onOpenChange} run={runView({ rerunOfRunId: SOURCE_ID })} spans={SPANS} />,
    )
    await screen.findByTestId('run-compare-result')
    expect(compareCalls()).toHaveLength(1)
    const dialog = screen.getByTestId('run-compare-dialog')
    fireEvent.keyDown(dialog, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(compareCalls()).toHaveLength(2))
    fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(compareCalls()).toHaveLength(3))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('RunCopyMenu', () => {
  let writeText: jest.Mock

  beforeEach(() => {
    writeText = jest.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })

  it('copies run metadata only', async () => {
    renderWithProviders(<RunCopyMenu run={runView()} spans={SPANS} canViewContent={false} />)
    fireEvent.click(screen.getByTestId('run-copy-menu'))
    expect(screen.queryByTestId('run-copy-content')).toBeNull()
    fireEvent.click(await screen.findByTestId('run-copy-metadata'))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const payload = JSON.parse(writeText.mock.calls[0][0])
    expect(payload.schema).toBe(RUN_COPY_SCHEMA)
    expect(payload.run.id).toBe(RUN_ID)
    expect(payload.spans).toHaveLength(3)
    expect(payload).toHaveProperty('manifest')
    expect(payload).not.toHaveProperty('content')
    expect(apiCallMock).not.toHaveBeenCalled()
    expect(flashMock).toHaveBeenCalledWith('agent_orchestrator.trace.copied', 'success')
  })

  it('copies run metadata with lazily fetched content when permitted', async () => {
    apiCallMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('req-2') ? respond(410, null) : respond(200, { payload: { from: new URL(url, 'http://x').searchParams.get('key') } }),
      ),
    )
    renderWithProviders(<RunCopyMenu run={runView()} spans={SPANS} canViewContent />)
    fireEvent.click(screen.getByTestId('run-copy-menu'))
    fireEvent.click(await screen.findByTestId('run-copy-content'))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const payload = JSON.parse(writeText.mock.calls[0][0])
    expect(payload.schema).toBe(RUN_COPY_SCHEMA)
    expect(payload.content).toEqual([
      {
        spanId: 'span-1',
        step: 1,
        request: { status: 'ok', payload: { from: '1761650000000/req-1' } },
        response: { status: 'ok', payload: { from: '1761650000000/res-1' } },
      },
      { spanId: 'span-2', step: 2, request: { status: 'expired' }, response: { status: 'not_captured' } },
    ])
    expect(apiCallMock).toHaveBeenCalledTimes(3)
  })

  it('flashes an error when the clipboard rejects', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    renderWithProviders(<RunCopyMenu run={runView()} spans={SPANS} canViewContent={false} />)
    fireEvent.click(screen.getByTestId('run-copy-menu'))
    fireEvent.click(await screen.findByTestId('run-copy-metadata'))
    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('agent_orchestrator.trace.copyFailed', 'error'))
  })
})
