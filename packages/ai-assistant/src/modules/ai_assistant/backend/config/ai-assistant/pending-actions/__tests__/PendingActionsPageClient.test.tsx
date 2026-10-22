/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import en from '../../../../../i18n/en.json'
import {
  PendingActionsPageClient,
  buildPendingActionsQuery,
  normalizePendingActionsFilters,
} from '../PendingActionsPageClient'

const pushMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const apiCallMock = jest.fn()

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
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
}))

type StubProps = {
  columns: Array<{ id?: string; accessorKey?: string; cell?: (ctx: { row: { original: unknown } }) => React.ReactNode }>
  data: Array<{ id: string }>
  emptyState?: React.ReactNode
  onFiltersApply?: (values: Record<string, unknown>) => void
  onFiltersClear?: () => void
  onRowClick?: (row: { id: string }) => void
}

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ columns, data, emptyState, onFiltersApply, onFiltersClear, onRowClick }: StubProps) => (
    <div>
      <button type="button" onClick={() => onFiltersApply?.({ channel: 'mcp', mine: true })}>
        apply-mcp-mine
      </button>
      <button type="button" onClick={() => onFiltersClear?.()}>
        clear-filters
      </button>
      {data.length === 0 ? <div data-testid="empty">{emptyState}</div> : null}
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
  agentId: 'ai_assistant.raw_tool',
  toolName: 'catalog.update_product',
  status: 'pending',
  fieldDiff: [],
  records: null,
  failedRecords: null,
  sideEffectsSummary: null,
  attachmentIds: [],
  targetEntityType: 'catalog.product',
  targetRecordId: 'prod-1',
  recordVersion: null,
  queueMode: 'inline',
  executionResult: null,
  createdAt: '2026-10-22T10:00:00.000Z',
  expiresAt: '2026-10-22T10:15:00.000Z',
  resolvedAt: null,
  resolvedByUserId: null,
  channel: 'mcp',
  requester: { userId: '22222222-2222-4222-8222-222222222222', apiKeyId: null },
}

function listUrls(): string[] {
  return apiCallOrThrowMock.mock.calls.map((call) => String(call[0]))
}

describe('PendingActionsPageClient', () => {
  beforeEach(() => {
    pushMock.mockReset()
    apiCallOrThrowMock.mockReset()
    apiCallMock.mockReset()
    apiCallOrThrowMock.mockResolvedValue({
      ok: true,
      status: 200,
      result: { items: [ROW], total: 1, page: 1, pageSize: 50 },
    })
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 200,
      result: { items: [{ id: ROW.requester.userId, name: 'Ada Lovelace', email: 'ada@example.com' }] },
    })
  })

  it('renders rows with tool, channel, status and the resolved requester name', async () => {
    renderWithProviders(<PendingActionsPageClient />, { dict })

    expect(await screen.findByText('catalog.update_product')).toBeTruthy()
    expect(screen.getByText(dict['ai_assistant.pendingActions.channel.mcp'])).toBeTruthy()
    expect(screen.getByText(dict['ai_assistant.pendingActions.status.pending'])).toBeTruthy()
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy()
    expect(String(apiCallMock.mock.calls[0][0])).toContain(`/api/auth/users?ids=${ROW.requester.userId}`)
  })

  it('loads pending rows first and passes applied filters to the list API', async () => {
    renderWithProviders(<PendingActionsPageClient />, { dict })
    await screen.findByText('catalog.update_product')

    expect(listUrls()[0]).toBe('/api/ai_assistant/ai/actions?page=1&pageSize=50&status=pending')

    await act(async () => {
      fireEvent.click(screen.getByText('apply-mcp-mine'))
    })
    await waitFor(() => {
      expect(listUrls()).toContain('/api/ai_assistant/ai/actions?page=1&pageSize=50&channel=mcp&mine=true')
    })

    await act(async () => {
      fireEvent.click(screen.getByText('clear-filters'))
    })
    await waitFor(() => {
      expect(listUrls()).toContain('/api/ai_assistant/ai/actions?page=1&pageSize=50')
    })
  })

  it('opens the detail page on row click', async () => {
    renderWithProviders(<PendingActionsPageClient />, { dict })
    fireEvent.click(await screen.findByTestId(`row-${ROW.id}`))
    expect(pushMock).toHaveBeenCalledWith(`/backend/config/ai-assistant/pending-actions/${ROW.id}`)
  })

  it('falls back to the short requester id when the users lookup is forbidden', async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 403, result: null })
    renderWithProviders(<PendingActionsPageClient />, { dict })
    expect(await screen.findByText(ROW.requester.userId.slice(0, 8))).toBeTruthy()
  })

  it('renders the empty state when there are no rows', async () => {
    apiCallOrThrowMock.mockResolvedValue({
      ok: true,
      status: 200,
      result: { items: [], total: 0, page: 1, pageSize: 50 },
    })
    renderWithProviders(<PendingActionsPageClient />, { dict })
    expect(await screen.findByText(dict['ai_assistant.pendingActions.empty.title'])).toBeTruthy()
  })
})

describe('pending actions list query helpers', () => {
  it('builds the query string with a capped page size', () => {
    expect(buildPendingActionsQuery(2, { status: 'expired', channel: 'tools-api' })).toBe(
      'page=2&pageSize=50&status=expired&channel=tools-api',
    )
  })

  it('normalizes filter bar values', () => {
    expect(normalizePendingActionsFilters({ status: '', channel: 'agent', mine: 'true' })).toEqual({
      channel: 'agent',
      mine: true,
    })
    expect(normalizePendingActionsFilters({ mine: false })).toEqual({})
  })
})
