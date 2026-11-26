/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import WmsSkuDetailPage from '../WmsSkuDetailPage'

const apiCallMock = jest.fn()

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageHeader: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div>,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: { data: Array<{ id: string }>; perspective?: { tableId?: string } }) => (
    <ul data-testid={props.perspective?.tableId === 'wms.sku.distribution' ? 'distribution-table' : 'other-table'}>
      {props.data.map((row) => (
        <li key={row.id}>{row.id}</li>
      ))}
    </ul>
  ),
}))

jest.mock('@open-mercato/ui/primitives/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (value: string) => void
    children: React.ReactNode
  }) => (
    <select data-testid="warehouse-select" value={value} onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('../useWmsInventoryMutationAccess', () => ({
  useWmsInventoryMutationAccess: () => ({}),
}))

jest.mock('../AdjustInventoryDialog', () => ({ AdjustInventoryDialog: () => null }))
jest.mock('../CycleCountWizardDialog', () => ({ CycleCountWizardDialog: () => null }))
jest.mock('../ReceiveInventoryDialog', () => ({ ReceiveInventoryDialog: () => null }))

const variantId = '6f1c2a52-4c8b-4c55-9b1e-3d2f0a9b7c11'

type BalanceRow = {
  id: string
  warehouse_id: string
  quantity_on_hand: number
  quantity_reserved: number
  quantity_allocated: number
  quantity_available: number
}

function balance(id: string, onHand: number, reserved: number, warehouseId = 'wh-1'): BalanceRow {
  return {
    id,
    warehouse_id: warehouseId,
    quantity_on_hand: onHand,
    quantity_reserved: reserved,
    quantity_allocated: 0,
    quantity_available: onHand - reserved,
  }
}

function page<T>(items: T[], total = items.length) {
  return { ok: true, result: { items, total, totalPages: 1 } }
}

type BalanceResolver = (params: URLSearchParams) => unknown

function mockApi(resolveBalances: BalanceResolver) {
  apiCallMock.mockImplementation(async (url: string) => {
    const [path, query = ''] = url.split('?')
    const params = new URLSearchParams(query)
    if (path === '/api/catalog/variants') return page([{ id: variantId, sku: 'SKU-1', name: 'Widget' }])
    if (path === '/api/wms/warehouses') {
      return page([
        { id: 'wh-1', name: 'Main' },
        { id: 'wh-2', name: 'Overflow' },
      ])
    }
    if (path === '/api/wms/inventory/balances') return resolveBalances(params)
    return page([])
  })
}

function kpiValue(title: string): string | null | undefined {
  const card = screen.getByText(title).closest('section')
  return card?.querySelector('.text-3xl')?.textContent
}

function tableRowIds(): string[] {
  return within(screen.getByTestId('distribution-table'))
    .queryAllByRole('listitem')
    .map((item) => item.textContent ?? '')
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('WmsSkuDetailPage empty balances', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
  })

  it('keeps the KPIs on stocked buckets when empty buckets fill the 100-row page', async () => {
    const stocked = [balance('stocked-a', 10, 2), balance('stocked-b', 5, 0)]
    const empties = Array.from({ length: 99 }, (_, index) => balance(`empty-${index}`, 0, 0))
    mockApi((params) =>
      params.get('hideEmpty') === 'true' ? page(stocked) : page([...empties, stocked[0]], 101),
    )

    renderWithProviders(<WmsSkuDetailPage variantId={variantId} />, { queryClient: createQueryClient() })

    await waitFor(() => expect(tableRowIds()).toEqual(['stocked-a', 'stocked-b']))
    expect(kpiValue('On hand')).toBe('15')
    expect(kpiValue('Reserved')).toBe('2')
    expect(kpiValue('Available')).toBe('13')

    fireEvent.click(screen.getByRole('button', { name: 'Show empty' }))

    await waitFor(() => expect(tableRowIds()).toContain('empty-0'))
    expect(tableRowIds()).not.toContain('stocked-b')
    expect(kpiValue('On hand')).toBe('15')
    expect(kpiValue('Reserved')).toBe('2')
    expect(kpiValue('Available')).toBe('13')
  })

  it('does not keep the previous warehouse rows on screen while the new warehouse loads', async () => {
    let releaseOverflow: (value: unknown) => void = () => undefined
    const overflowResponse = new Promise((resolve) => {
      releaseOverflow = resolve
    })
    mockApi((params) =>
      params.get('warehouseId') === 'wh-2'
        ? overflowResponse
        : page([balance('main-row', 4, 0, 'wh-1')]),
    )

    renderWithProviders(<WmsSkuDetailPage variantId={variantId} />, { queryClient: createQueryClient() })

    await waitFor(() => expect(tableRowIds()).toEqual(['main-row']))
    await waitFor(() => expect(screen.getByRole('option', { name: 'Overflow' })).toBeInTheDocument())

    fireEvent.change(screen.getByTestId('warehouse-select'), { target: { value: 'wh-2' } })

    await waitFor(() =>
      expect(apiCallMock).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/wms\/inventory\/movements\?.*warehouseId=wh-2/)),
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.queryByText('main-row')).not.toBeInTheDocument()

    await act(async () => {
      releaseOverflow(page([balance('overflow-row', 3, 0, 'wh-2')]))
      await overflowResponse
    })

    await waitFor(() => expect(tableRowIds()).toEqual(['overflow-row']))
  })

  it('keeps the same warehouse rows on screen while the empty toggle reloads', async () => {
    let releaseWithEmpties: (value: unknown) => void = () => undefined
    const withEmptiesResponse = new Promise((resolve) => {
      releaseWithEmpties = resolve
    })
    mockApi((params) =>
      params.get('hideEmpty') === 'true' ? page([balance('stocked-a', 4, 0)]) : withEmptiesResponse,
    )

    renderWithProviders(<WmsSkuDetailPage variantId={variantId} />, { queryClient: createQueryClient() })

    await waitFor(() => expect(tableRowIds()).toEqual(['stocked-a']))

    fireEvent.click(screen.getByRole('button', { name: 'Show empty' }))

    await screen.findByRole('button', { name: 'Hide empty' })
    expect(tableRowIds()).toEqual(['stocked-a'])

    await act(async () => {
      releaseWithEmpties(page([balance('empty-1', 0, 0), balance('stocked-a', 4, 0)]))
      await withEmptiesResponse
    })

    await waitFor(() => expect(tableRowIds()).toEqual(['empty-1', 'stocked-a']))
  })
})
