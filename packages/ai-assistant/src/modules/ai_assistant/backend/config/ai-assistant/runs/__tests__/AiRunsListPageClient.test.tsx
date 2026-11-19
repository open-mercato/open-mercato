/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import en from '../../../../../i18n/en.json'
import {
  AiRunsListPageClient,
  buildAgentRunsQuery,
  normalizeAgentRunsFilters,
} from '../AiRunsListPageClient'

const pushMock = jest.fn()
const apiCallOrThrowMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, back: jest.fn() }),
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
  apiCall: jest.fn(),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
}))

type StubProps = {
  columns: Array<{ id?: string; accessorKey?: string; cell?: (ctx: { row: { original: unknown } }) => React.ReactNode }>
  data: Array<{ id: string }>
  isLoading?: boolean
  error?: string
  emptyState?: React.ReactNode
  onFiltersApply?: (values: Record<string, unknown>) => void
  onFiltersClear?: () => void
  onRowClick?: (row: { id: string }) => void
}

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ columns, data, isLoading, error, emptyState, onFiltersApply, onFiltersClear, onRowClick }: StubProps) => (
    <div>
      {isLoading ? <div data-testid="loading" /> : null}
      {error ? <div data-testid="error">{error}</div> : null}
      <button
        type="button"
        onClick={() => onFiltersApply?.({ agentId: ' catalog.merchandiser ', status: 'failed', channel: 'chat' })}
      >
        apply-filters
      </button>
      <button type="button" onClick={() => onFiltersClear?.()}>
        clear-filters
      </button>
      {!isLoading && !error && data.length === 0 ? <div data-testid="empty">{emptyState}</div> : null}
      {data.map((row) => (
        <div key={row.id} data-testid={`row-${row.id}`} onClick={() => onRowClick?.(row)}>
          {columns.map((column, index) => (
            <span key={column.id ?? column.accessorKey ?? index}>
              {column.cell ? column.cell({ row: { original: row } }) : null}
            </span>
          ))}
        </div>
      ))}
    </div>
  ),
}))

const dict = en as Record<string, string>

const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  agentId: 'catalog.merchandiser',
  agentVersion: '1',
  executionMode: 'chat',
  channel: 'playground',
  status: 'completed',
  modelId: 'gpt-test',
  providerId: 'openai',
  inputTokens: 120,
  outputTokens: 30,
  stepCount: 2,
  toolCallCount: 1,
  durationMs: 1500,
  conversationId: 'conv-1',
  userId: '22222222-2222-4222-8222-222222222222',
  captureLevel: 'full',
  startedAt: '2026-10-22T10:00:00.000Z',
  completedAt: '2026-10-22T10:00:01.500Z',
  updatedAt: '2026-10-22T10:00:01.500Z',
}

function listUrls(): string[] {
  return apiCallOrThrowMock.mock.calls.map((call) => String(call[0]))
}

describe('AiRunsListPageClient', () => {
  beforeEach(() => {
    pushMock.mockReset()
    apiCallOrThrowMock.mockReset()
    apiCallOrThrowMock.mockResolvedValue({
      ok: true,
      status: 200,
      result: { items: [ROW], total: 1, page: 1, pageSize: 50, totalPages: 1 },
    })
  })

  it('renders rows with agent, status and channel', async () => {
    renderWithProviders(<AiRunsListPageClient />, { dict })
    expect(await screen.findByText('catalog.merchandiser')).toBeTruthy()
    expect(screen.getByText(dict['ai_assistant.runs.status.completed'])).toBeTruthy()
    expect(screen.getByText(dict['ai_assistant.runs.channel.playground'])).toBeTruthy()
    expect(screen.getByText('gpt-test')).toBeTruthy()
  })

  it('shows the loading state while the list is pending', () => {
    apiCallOrThrowMock.mockReturnValue(new Promise(() => undefined))
    renderWithProviders(<AiRunsListPageClient />, { dict })
    expect(screen.getByTestId('loading')).toBeTruthy()
  })

  it('shows the error message when the list fails', async () => {
    apiCallOrThrowMock.mockRejectedValue(new Error('boom'))
    renderWithProviders(<AiRunsListPageClient />, { dict })
    expect(await screen.findByText(dict['ai_assistant.runs.list.loadError'])).toBeTruthy()
  })

  it('renders the empty state when there are no runs', async () => {
    apiCallOrThrowMock.mockResolvedValue({
      ok: true,
      status: 200,
      result: { items: [], total: 0, page: 1, pageSize: 50, totalPages: 0 },
    })
    renderWithProviders(<AiRunsListPageClient />, { dict })
    expect(await screen.findByText(dict['ai_assistant.runs.list.empty'])).toBeTruthy()
  })

  it('passes applied filters to the list API and resets them on clear', async () => {
    renderWithProviders(<AiRunsListPageClient />, { dict })
    await screen.findByText('catalog.merchandiser')
    expect(listUrls()[0]).toBe('/api/ai_assistant/ai/runs?page=1&pageSize=50')

    await act(async () => {
      fireEvent.click(screen.getByText('apply-filters'))
    })
    await waitFor(() => {
      expect(listUrls()).toContain(
        '/api/ai_assistant/ai/runs?page=1&pageSize=50&agentId=catalog.merchandiser&channel=chat&status=failed',
      )
    })

    const callsBeforeClear = listUrls().length
    await act(async () => {
      fireEvent.click(screen.getByText('clear-filters'))
    })
    await waitFor(() => {
      expect(listUrls().length).toBeGreaterThanOrEqual(callsBeforeClear)
      expect(listUrls()[listUrls().length - 1]).toBe('/api/ai_assistant/ai/runs?page=1&pageSize=50')
    })
  })

  it('opens the detail page on row click', async () => {
    renderWithProviders(<AiRunsListPageClient />, { dict })
    fireEvent.click(await screen.findByTestId(`row-${ROW.id}`))
    expect(pushMock).toHaveBeenCalledWith(`/backend/config/ai-assistant/runs/${ROW.id}`)
  })
})

describe('agent runs list query helpers', () => {
  it('builds the query with a capped page size and local-day date bounds', () => {
    const query = new URLSearchParams(
      buildAgentRunsQuery(2, { status: 'aborted', startedFrom: '2026-10-01', startedTo: '2026-10-02' }),
    )
    expect(query.get('page')).toBe('2')
    expect(query.get('pageSize')).toBe('50')
    expect(query.get('status')).toBe('aborted')
    expect(query.get('from')).toBe(new Date('2026-10-01T00:00:00.000').toISOString())
    expect(query.get('to')).toBe(new Date('2026-10-02T23:59:59.999').toISOString())
  })

  it('normalizes filter bar values and drops invalid date bounds', () => {
    expect(
      normalizeAgentRunsFilters({
        agentId: '  ',
        channel: 'mcp',
        startedAt: { from: '2026-10-01', to: 'not-a-date' },
      }),
    ).toEqual({ channel: 'mcp', startedFrom: '2026-10-01' })
    expect(normalizeAgentRunsFilters({})).toEqual({})
  })
})
