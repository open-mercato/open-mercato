/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { BookingsListPage } from '../components/bookings/BookingsListPage'
import { bookingHasEnded, canCancelBooking, type BookingSummary } from '../components/bookings/bookingModel'
import type { CrmAccess } from '../components/crmAccess'

type Row = Record<string, unknown>
type Column = { accessorKey: string; cell?: (context: { row: { original: Row } }) => React.ReactNode }
type RowActionItem = { id: string; label: string; onSelect: () => void }

const mockFlash = jest.fn()
const mockApiCallOrThrow = jest.fn()
const mockReloadKeys: string[] = []
const mockList: { rows: BookingSummary[]; crmAccess: CrmAccess } = { rows: [], crmAccess: { people: false, companies: false } }

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/backend/property_management/bookings',
  useSearchParams: () => new URLSearchParams(''),
}))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: ['property_management.*', 'customers.*'] }, isReady: true }),
}))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ columns, data, rowActions }: { columns: Column[]; data: Row[]; rowActions?: (row: Row) => React.ReactNode }) => (
    <table>
      <tbody>
        {data.map((row) => (
          <tr key={String(row.id)} data-testid={`row-${String(row.id)}`}>
            {columns.map((column) => (
              <td key={column.accessorKey} data-testid={`cell-${column.accessorKey}`}>
                {column.cell ? column.cell({ row: { original: row } }) : String(row[column.accessorKey] ?? '')}
              </td>
            ))}
            <td>{rowActions ? rowActions(row) : null}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
}))
jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: RowActionItem[] }) => (
    <>{items.map((item) => <button key={item.id} type="button" onClick={item.onSelect}>{item.label}</button>)}</>
  ),
}))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: async () => true, ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => mockApiCallOrThrow(...args),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => mockFlash(...args) }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: () => false }))
jest.mock('../components/bookings/BookingsToolbar', () => ({ ALL_BOOKINGS_FILTER: 'all', BookingsToolbar: () => null }))
jest.mock('../components/bookings/useBookingBuildingOptions', () => ({
  useBookingBuildingOptions: () => ({ buildings: [], failed: false, retry: jest.fn() }),
}))
jest.mock('../components/bookings/useBookingsList', () => ({
  useBookingsList: (_params: URLSearchParams, reloadKey: string) => {
    mockReloadKeys.push(reloadKey)
    return { rows: mockList.rows, total: mockList.rows.length, totalPages: 1, loading: false, loadError: null, crmAccess: mockList.crmAccess }
  },
}))

function booking(id: string, patch: Partial<BookingSummary>): BookingSummary {
  return {
    id, status: 'confirmed', buildingId: 'b', buildingName: 'HQ', unitId: 'u', unitName: 'Desk 1', floorName: null,
    bookedByPersonId: 'person-1', bookedByName: 'Grace Hopper', customerCompanyId: null, companyName: null,
    startsAt: '2099-01-01T09:00', endsAt: '2099-01-01T11:00', productName: 'Desk', unitPrice: '10', quantity: 2, billingUnit: 'hour',
    totalAmount: '20', currencyCode: 'EUR', cancelReason: null, salesOrderId: null, salesOrderNumber: null, salesOrderCancelled: false,
    updatedAt: '2026-11-01T00:00:00Z', ...patch,
  }
}

describe('bookings list: ended bookings and CRM names', () => {
  beforeEach(() => {
    mockFlash.mockReset()
    mockApiCallOrThrow.mockReset()
    mockReloadKeys.length = 0
  })

  it('treats a booking whose end has passed as no longer cancellable', () => {
    const now = '2026-11-18T12:00'
    expect(bookingHasEnded({ endsAt: '2026-11-18T12:00' }, now)).toBe(true)
    expect(bookingHasEnded({ endsAt: '2026-11-18T12:01' }, now)).toBe(false)
    expect(canCancelBooking({ status: 'confirmed', endsAt: '2026-11-18T11:00' }, now)).toBe(false)
    expect(canCancelBooking({ status: 'pending', endsAt: '2026-11-18T13:00' }, now)).toBe(true)
    expect(canCancelBooking({ status: 'completed', endsAt: '2026-11-18T13:00' }, now)).toBe(false)
  })

  it('follows the server cancellable flag over the browser clock', () => {
    const now = '2026-11-18T12:00'
    expect(canCancelBooking({ status: 'confirmed', endsAt: '2026-11-18T11:00', cancellable: true }, now)).toBe(true)
    expect(canCancelBooking({ status: 'confirmed', endsAt: '2026-11-18T13:00', cancellable: false }, now)).toBe(false)
  })

  it('offers Cancel from the server flag even when the browser clock disagrees', () => {
    mockList.rows = [
      booking('server-open', { startsAt: '2020-01-01T09:00', endsAt: '2020-01-01T11:00', cancellable: true }),
      booking('server-ended', { cancellable: false }),
    ]
    renderWithProviders(<BookingsListPage />)
    expect(screen.getByTestId('row-server-open').textContent).toContain('Cancel booking')
    expect(screen.getByTestId('row-server-ended').querySelector('button')).toBeNull()
  })

  it('offers Cancel only for a booking that has not ended', () => {
    mockList.rows = [booking('ended', { startsAt: '2020-01-01T09:00', endsAt: '2020-01-01T11:00' }), booking('upcoming', {})]
    renderWithProviders(<BookingsListPage />)
    expect(screen.getByTestId('row-ended').querySelector('button')).toBeNull()
    expect(screen.getByTestId('row-upcoming').textContent).toContain('Cancel booking')
  })

  it('shows the translated 409 when the booking ended in the meantime, and reloads the list', async () => {
    mockList.rows = [booking('upcoming', {})]
    mockApiCallOrThrow.mockRejectedValue(Object.assign(new Error('The booking has already ended.'), { status: 409, code: 'booking_already_ended' }))
    renderWithProviders(<BookingsListPage />)
    const keysBefore = new Set(mockReloadKeys)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }))
    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith('The booking has already ended.', 'error'))
    await waitFor(() => expect(mockReloadKeys.some((key) => !keysBefore.has(key))).toBe(true))
  })

  it('shows a note instead of the booker without CRM people access, and the name with it', () => {
    mockList.rows = [booking('upcoming', { bookedByName: null })]
    mockList.crmAccess = { people: false, companies: false }
    const view = renderWithProviders(<BookingsListPage />)
    expect(screen.getByTestId('cell-bookedByName').textContent).toBe('Needs CRM access')
    expect(screen.getByTestId('cell-bookedByName').querySelector('a')).toBeNull()
    view.unmount()
    mockList.rows = [booking('upcoming', {})]
    mockList.crmAccess = { people: true, companies: false }
    renderWithProviders(<BookingsListPage />)
    expect(screen.getByTestId('cell-bookedByName').querySelector('a')?.textContent).toBe('Grace Hopper')
  })
})
