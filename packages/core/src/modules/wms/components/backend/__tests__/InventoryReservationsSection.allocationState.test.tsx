/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { WmsInventoryMutationAccess } from '../useWmsInventoryMutationAccess'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
  useLocale: () => 'en',
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  raiseCrudError: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('../ReleaseReservationDialog', () => ({
  ReleaseReservationDialog: () => null,
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: Array<{ id: string; label: string; onSelect?: () => void }> }) => (
    <div>
      {items.map((item) => (
        <button key={item.id} type="button" onClick={() => item.onSelect?.()}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}))

type MockColumn = {
  accessorKey?: string
  cell?: (ctx: { row: { original: Record<string, unknown> } }) => React.ReactNode
}

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({
    data,
    columns,
    rowActions,
  }: {
    data: Array<Record<string, unknown> & { id: string }>
    columns: MockColumn[]
    rowActions?: (row: Record<string, unknown>) => React.ReactNode
  }) => {
    const statusColumn = columns.find((column) => column.accessorKey === 'status')
    return (
      <div>
        {data.map((row) => (
          <div key={row.id} data-testid={`reservation-row-${row.id}`}>
            <span>{statusColumn?.cell?.({ row: { original: row } })}</span>
            {rowActions?.(row)}
          </div>
        ))}
      </div>
    )
  },
}))

import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { InventoryReservationsSection } from '../WmsInventoryConsolePage'

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>

const access: WmsInventoryMutationAccess = {
  loading: false,
  organizationId: 'org-uuid-1',
  tenantId: 'tenant-uuid-1',
  userId: 'user-uuid-1',
  scopeReady: true,
  canAdjust: true,
  canManage: true,
  canReceive: true,
  canCycleCount: true,
  canImport: true,
  canMove: true,
  canRelease: true,
  canReserve: true,
  canAllocate: true,
  canManageLocations: true,
  canManageWarehouses: true,
  canManageZones: true,
  canManageLots: true,
}

function okResult(result: unknown) {
  return { ok: true, status: 200, result, response: new Response() } as Awaited<ReturnType<typeof apiCall>>
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <InventoryReservationsSection access={access} />
    </QueryClientProvider>,
  )
}

describe('InventoryReservationsSection allocation state', () => {
  let allocated = false

  beforeEach(() => {
    allocated = false
    mockApiCall.mockReset()
    mockApiCall.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/wms/inventory/allocate' && init?.method === 'POST') {
        allocated = true
        return okResult({ ok: true, allocationState: 'allocated' })
      }
      if (url.startsWith('/api/wms/inventory/reservations')) {
        return okResult({
          items: [
            { id: 'res-plain', status: 'active', allocation_state: allocated ? 'allocated' : 'reserved' },
            { id: 'res-allocated', status: 'active', allocation_state: 'allocated' },
          ],
          total: 2,
          totalPages: 1,
        })
      }
      return okResult({})
    })
  })

  it('shows allocated reservations as Allocated and hides the Allocate action for them', async () => {
    renderSection()

    const allocatedRow = await screen.findByTestId('reservation-row-res-allocated')
    expect(within(allocatedRow).getByText('Allocated')).toBeInTheDocument()
    expect(within(allocatedRow).queryByRole('button', { name: 'Allocate' })).not.toBeInTheDocument()
    expect(within(allocatedRow).getByRole('button', { name: 'Release' })).toBeInTheDocument()

    const plainRow = screen.getByTestId('reservation-row-res-plain')
    expect(within(plainRow).getByText('Active')).toBeInTheDocument()
    expect(within(plainRow).getByRole('button', { name: 'Allocate' })).toBeInTheDocument()
  })

  it('refreshes the list after allocating so the row switches to Allocated', async () => {
    renderSection()

    const plainRow = await screen.findByTestId('reservation-row-res-plain')
    fireEvent.click(within(plainRow).getByRole('button', { name: 'Allocate' }))

    await waitFor(() => {
      const refreshedRow = screen.getByTestId('reservation-row-res-plain')
      expect(within(refreshedRow).getByText('Allocated')).toBeInTheDocument()
      expect(within(refreshedRow).queryByRole('button', { name: 'Allocate' })).not.toBeInTheDocument()
    })
    expect(mockApiCall).toHaveBeenCalledWith(
      '/api/wms/inventory/allocate',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
