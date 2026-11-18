/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { BookingsListPage } from '../components/bookings/BookingsListPage'

const mockReplace = jest.fn()
const mockListParams: URLSearchParams[] = []
const mockSearch: { current: string } = { current: '' }
const UNIT_ID = '3f2a9c1b-5d4e-4a6b-9c8d-7e6f5a4b3c2d'
const mockRows: { current: Array<{ id: string; unitId: string; unitName: string | null }> } = { current: [] }

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, prefetch: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/backend/property_management/bookings',
  useSearchParams: () => new URLSearchParams(mockSearch.current),
}))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: [] }, isReady: true }),
}))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: { toolbar?: React.ReactNode }) => <section data-testid="data-table">{props.toolbar}</section>,
}))
jest.mock('@open-mercato/ui/backend/FilterBar', () => ({
  FilterBar: (props: { trailingItems?: React.ReactNode }) => <div>{props.trailingItems}</div>,
}))
jest.mock('@open-mercato/ui/primitives/date-picker', () => ({ DatePicker: () => null }))
jest.mock('../components/bookings/useBookingBuildingOptions', () => ({
  useBookingBuildingOptions: () => ({ buildings: [], failed: false, retry: jest.fn() }),
}))
jest.mock('../components/bookings/useBookingsList', () => ({
  useBookingsList: (params: URLSearchParams) => {
    mockListParams.push(params)
    return { rows: mockRows.current, total: mockRows.current.length, totalPages: 1, loading: false, loadError: null, crmAccess: { people: false, companies: false } }
  },
}))

describe('BookingsListPage unit filter', () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockListParams.length = 0
    mockRows.current = [{ id: 'booking-1', unitId: UNIT_ID, unitName: 'Office 1' }]
  })

  it('filters by the unit from the URL and lets the user clear it', () => {
    mockSearch.current = `unitId=${UNIT_ID}&date=2026-11-16`
    renderWithProviders(<BookingsListPage />)
    const params = mockListParams.at(-1)
    expect(params?.get('unitId')).toBe(UNIT_ID)
    expect(params?.get('date')).toBe('2026-11-16')
    expect(screen.getByTestId('pm-bookings-unit-filter').textContent).toContain('Only unit Office 1')
    fireEvent.click(screen.getByLabelText('Show bookings of all units'))
    expect(mockReplace).toHaveBeenCalledWith('/backend/property_management/bookings?date=2026-11-16')
  })

  it('names the unit from the link when the filtered unit has no bookings, and clears that name too', () => {
    mockRows.current = []
    mockSearch.current = `unitId=${UNIT_ID}&unitName=Office+7&date=2026-11-16`
    renderWithProviders(<BookingsListPage />)
    const chip = screen.getByTestId('pm-bookings-unit-filter').textContent ?? ''
    expect(chip).toContain('Only unit Office 7')
    expect(chip).not.toContain(UNIT_ID.slice(0, 8))
    fireEvent.click(screen.getByLabelText('Show bookings of all units'))
    expect(mockReplace).toHaveBeenCalledWith('/backend/property_management/bookings?date=2026-11-16')
  })

  it('falls back to a generic label, never an id fragment, when no name is known', () => {
    mockRows.current = []
    mockSearch.current = `unitId=${UNIT_ID}`
    renderWithProviders(<BookingsListPage />)
    const chip = screen.getByTestId('pm-bookings-unit-filter').textContent ?? ''
    expect(chip).toContain('Only the selected unit')
    expect(chip).not.toContain(UNIT_ID.slice(0, 8))
  })

  it('ignores a unitId that is not a UUID', () => {
    mockSearch.current = 'unitId=not-a-unit&date=2026-11-16'
    renderWithProviders(<BookingsListPage />)
    expect(mockListParams.at(-1)?.has('unitId')).toBe(false)
    expect(screen.queryByTestId('pm-bookings-unit-filter')).toBeNull()
  })

  it('shows no unit filter without a unitId in the URL', () => {
    mockSearch.current = ''
    renderWithProviders(<BookingsListPage />)
    expect(mockListParams.at(-1)?.has('unitId')).toBe(false)
    expect(screen.queryByTestId('pm-bookings-unit-filter')).toBeNull()
  })
})
