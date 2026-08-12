/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, act } from '@testing-library/react'
import { SalesDocumentsTable } from '../SalesDocumentsTable'

// Capture the props handed to DataTable so we can assert the channel column and filter wiring.
const mockDataTable = jest.fn()
const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  withDataTableNamespaces: (mappedRow: Record<string, unknown>) => mappedRow,
  DataTable: (props: any) => {
    mockDataTable(props)
    return null
  },
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: any) => <div>{children}</div>,
  PageBody: ({ children }: any) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ children }: any) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: any[]) => mockApiCall(...args),
  withScopedApiRequestHeaders: (_header: unknown, callback: any) => callback?.(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  buildCrudExportUrl: () => '/export.csv',
  deleteCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  // Stable reference: the real useT() is memoized. Returning a fresh function
  // each render would re-create the data-load callback and loop the effect.
  const translate = (key: string, fallback?: string) => fallback ?? key
  return { useT: () => translate }
})

jest.mock('@open-mercato/core/modules/dictionaries/components/dictionaryAppearance', () => ({
  DictionaryValue: ({ value }: any) => <span>{value}</span>,
  createDictionaryMap: () => ({}),
  normalizeDictionaryEntries: () => [],
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('../../useSalesChannelsEnabled', () => ({
  useSalesChannelsEnabled: () => ({ enabled: true, isLoading: false }),
}))

const CHANNEL_A = '11111111-1111-4111-8111-111111111111'
const CHANNEL_B = '22222222-2222-4222-9222-222222222222'

function lastProps() {
  return mockDataTable.mock.calls.at(-1)?.[0]
}

function channelColumn() {
  return lastProps()?.columns?.find((col: any) => col.accessorKey === 'channelId')
}

function renderCell(column: any, row: Record<string, unknown>) {
  const rendered = column.cell({ row: { original: row } })
  return rendered?.props?.children
}

async function applyChannelFilter(value: unknown) {
  await act(async () => {
    lastProps().onFiltersApply({ channelId: value })
  })
}

describe('SalesDocumentsTable channel column and filter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockApiCall.mockResolvedValue({ ok: true, result: { items: [] } })
  })

  it('renders the server-resolved channel name without a channels request per row', async () => {
    await act(async () => {
      render(<SalesDocumentsTable kind="order" />)
    })

    const column = channelColumn()
    expect(renderCell(column, { channelId: CHANNEL_A, channelName: 'Web shop' })).toBe('Web shop')
  })

  it('falls back to the id only when the response could not resolve a name', async () => {
    await act(async () => {
      render(<SalesDocumentsTable kind="order" />)
    })

    const column = channelColumn()
    expect(renderCell(column, { channelId: CHANNEL_A, channelName: null })).toBe(CHANNEL_A)
  })

  it('offers a multi-select channel filter including an unassigned entry', async () => {
    await act(async () => {
      render(<SalesDocumentsTable kind="order" />)
    })

    const filter = lastProps()?.filters?.find((def: any) => def.id === 'channelId')
    expect(filter.type).toBe('tags')
    expect(filter.options?.[0]?.value).toBe('__unassigned__')
  })

  it('sends channelIds for several selected channels', async () => {
    await act(async () => {
      render(<SalesDocumentsTable kind="order" />)
    })
    mockApiCall.mockClear()

    await applyChannelFilter([CHANNEL_A, CHANNEL_B])

    const url = mockApiCall.mock.calls.map((call) => String(call[0])).find((u) => u.includes('/api/sales/orders'))
    expect(url).toContain(`channelIds=${encodeURIComponent(`${CHANNEL_A},${CHANNEL_B}`)}`)
    expect(url).not.toContain('channelIdsEmpty')
  })

  // The API $ORs the two params, so picking channels plus "(No channel)" must send both rather
  // than one silently dropping the other.
  it('sends both params when unassigned is picked alongside real channels', async () => {
    await act(async () => {
      render(<SalesDocumentsTable kind="order" />)
    })
    mockApiCall.mockClear()

    await applyChannelFilter([CHANNEL_A, '__unassigned__'])

    const url = mockApiCall.mock.calls.map((call) => String(call[0])).find((u) => u.includes('/api/sales/orders'))
    expect(url).toContain(`channelIds=${CHANNEL_A}`)
    expect(url).toContain('channelIdsEmpty=true')
  })

  it('sends only channelIdsEmpty when unassigned is the sole selection', async () => {
    await act(async () => {
      render(<SalesDocumentsTable kind="order" />)
    })
    mockApiCall.mockClear()

    await applyChannelFilter(['__unassigned__'])

    const url = mockApiCall.mock.calls.map((call) => String(call[0])).find((u) => u.includes('/api/sales/orders'))
    expect(url).toContain('channelIdsEmpty=true')
    expect(url).not.toContain('channelIds=')
  })

  // Perspectives saved while this filter was a single-value select persist a bare string.
  it('restores a legacy single-value perspective snapshot instead of clearing it', async () => {
    await act(async () => {
      render(<SalesDocumentsTable kind="order" />)
    })
    mockApiCall.mockClear()

    await applyChannelFilter(CHANNEL_A)

    const url = mockApiCall.mock.calls.map((call) => String(call[0])).find((u) => u.includes('/api/sales/orders'))
    expect(url).toContain(`channelIds=${CHANNEL_A}`)
  })
})
