/** @jest-environment jsdom */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { LeaseSummaryCard } from '../components/leases/LeaseSummaryCard'
import { LeasesListPage } from '../components/leases/LeasesListPage'
import { PreviewImpactLists } from '../components/availability/PreviewImpactLists'
import { applyPreviewCrmAccess, type UnavailabilityPreview } from '../components/availability/availabilityModel'
import { applyBookingsCrmAccess, type BookingSummary } from '../components/bookings/bookingModel'
import { applyLeaseCrmAccess, applyLeaseDetailCrmAccess, type LeaseDetail, type LeaseSummary } from '../components/leases/leaseModel'
import type { CrmAccess } from '../components/crmAccess'

type Row = Record<string, unknown>
type Column = { accessorKey: string; cell?: (context: { row: { original: Row } }) => React.ReactNode }

const NONE: CrmAccess = { people: false, companies: false }
const FULL: CrmAccess = { people: true, companies: true }
const mockList: { rows: LeaseSummary[]; crmAccess: CrmAccess } = { rows: [], crmAccess: NONE }

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: ['property_management.*', 'customers.*'] }, isReady: true }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ columns, data }: { columns: Column[]; data: Row[] }) => (
    <table>
      <tbody>
        {data.map((row) => (
          <tr key={String(row.id)}>
            {columns.map((column) => (
              <td key={column.accessorKey} data-testid={`cell-${column.accessorKey}`}>
                {column.cell ? column.cell({ row: { original: row } }) : String(row[column.accessorKey] ?? '')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}))
jest.mock('@open-mercato/ui/backend/FilterBar', () => ({ FilterBar: () => null }))
jest.mock('../components/leases/useLeaseSettings', () => ({
  useLeaseSettings: () => ({ settings: null, loadError: null, loading: false, retry: jest.fn() }),
  leaseToday: () => '2026-11-18',
}))
jest.mock('../components/leases/useLeaseBuildingOptions', () => ({
  useLeaseBuildingOptions: () => ({ buildings: [], loadError: null, retry: jest.fn() }),
}))
jest.mock('../components/leases/useLeasesList', () => ({
  ALL_BUILDINGS: 'all',
  LEASES_PAGE_SIZE: 50,
  UNAVAILABLE_CHIP: 'unavailable',
  useLeasesList: () => ({
    rows: mockList.rows,
    crmAccess: mockList.crmAccess,
    total: mockList.rows.length,
    totalPages: 1,
    loading: false,
    loadError: null,
    reload: jest.fn(),
    page: 1,
    setPage: jest.fn(),
    search: '',
    setSearch: jest.fn(),
    chip: 'all',
    setChip: jest.fn(),
    buildingId: 'all',
    setBuildingId: jest.fn(),
  }),
}))

const LEASE: LeaseSummary = {
  id: 'lease-1', reference: 'L-0001', status: 'active', buildingId: 'b', buildingName: 'HQ', unitId: 'u', unitName: 'Office 1', floorName: null,
  customerCompanyId: 'company-1', companyName: 'Acme', primaryContactPersonId: 'person-1', contactName: 'Ada Lovelace', contactEmail: 'ada@example.com',
  startsOn: '2026-01-01', termMonths: 12, endsOn: '2026-12-31', daysLeft: 40, productName: 'Office', monthlyRate: '100', currencyCode: 'EUR',
  salesOrderId: null, salesOrderNumber: null, openProposal: null, pendingChange: null, billingPending: false, billingAttention: false,
  unitUnavailable: false, unitUnavailableFrom: null, unitUnavailableUntil: null, updatedAt: '2026-11-01T00:00:00Z',
}

function detailOf(lease: LeaseSummary, crmAccess?: unknown): LeaseDetail {
  return {
    lease,
    leaseEnding: false,
    leaseEndingThresholdDays: 60,
    pendingChange: null,
    lastBillingRefusal: null,
    versions: [],
    proposals: [],
    operations: [],
    billing: { canCredit: false, defaultSettlement: 'keep', cancelAvailable: true },
    ...(crmAccess === undefined ? {} : { crmAccess: crmAccess as CrmAccess }),
  }
}

const BOOKING = {
  id: 'booking-1', status: 'confirmed', buildingId: 'b', buildingName: 'HQ', unitId: 'u', unitName: 'Desk 1', floorName: null,
  bookedByPersonId: 'person-2', bookedByName: 'Grace Hopper', customerCompanyId: 'company-3', companyName: 'Initech',
  startsAt: '2026-11-20T09:00', endsAt: '2026-11-20T11:00', productName: 'Desk', unitPrice: '10', quantity: 2, billingUnit: 'hour',
  totalAmount: '20', currencyCode: 'EUR', cancelReason: null, salesOrderId: null, salesOrderNumber: null, salesOrderCancelled: false,
  updatedAt: '2026-11-01T00:00:00Z',
} satisfies BookingSummary

const PREVIEW: UnavailabilityPreview = {
  unitCount: 1,
  bookingsToCancel: [{ id: 'booking-1', unit: 'Desk 1', startsAt: '2026-11-20T09:00', endsAt: '2026-11-20T11:00', person: 'Grace Hopper' }],
  bookingCount: 1,
  leasesToFlag: [{ id: 'lease-1', reference: 'L-0001', company: 'Acme', unit: 'Office 1' }],
  leaseCount: 1,
  previewToken: 'token-1',
}

describe('CRM names outside the floor plan', () => {
  it('drops names the payload still carries when crmAccess is missing or partial', () => {
    expect(applyBookingsCrmAccess([BOOKING], NONE)[0]).toMatchObject({ bookedByName: null, companyName: null, bookedByPersonId: 'person-2' })
    expect(applyBookingsCrmAccess([BOOKING], { people: true, companies: false })[0]).toMatchObject({ bookedByName: 'Grace Hopper', companyName: null })
    expect(applyLeaseCrmAccess(LEASE, { people: false, companies: true })).toMatchObject({ companyName: 'Acme', contactName: null, contactEmail: null })
    const detail = applyLeaseDetailCrmAccess(detailOf(LEASE, { people: 'yes', companies: 1 }))
    expect(detail.crmAccess).toEqual(NONE)
    expect(detail.lease).toMatchObject({ companyName: null, contactName: null, customerCompanyId: 'company-1' })
    const preview = applyPreviewCrmAccess(PREVIEW)
    expect(preview.crmAccess).toEqual(NONE)
    expect(preview.bookingsToCancel[0].person).toBeNull()
    expect(preview.leasesToFlag[0].company).toBeNull()
  })

  it('shows notes instead of the tenant and contact on the lease summary, with no company link', () => {
    renderWithProviders(<LeaseSummaryCard detail={applyLeaseDetailCrmAccess(detailOf(LEASE))} />)
    expect(screen.getAllByTestId('pm-lease-crm-hidden')).toHaveLength(2)
    expect(screen.queryByText('Acme')).toBeNull()
    expect(screen.queryByText('Ada Lovelace')).toBeNull()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('never renders an empty company link when access is granted but the name is missing', () => {
    const lease = { ...LEASE, companyName: undefined, contactName: undefined, primaryContactPersonId: null }
    renderWithProviders(<LeaseSummaryCard detail={applyLeaseDetailCrmAccess(detailOf(lease, FULL))} />)
    expect(screen.queryByTestId('pm-lease-crm-hidden')).toBeNull()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('shows the tenant only with company access on the leases list', () => {
    mockList.rows = [applyLeaseCrmAccess(LEASE, NONE)]
    mockList.crmAccess = NONE
    const view = renderWithProviders(<LeasesListPage schedulerAvailable />)
    expect(screen.getByTestId('cell-companyName').textContent).toBe('Needs CRM access')
    view.unmount()
    mockList.rows = [LEASE]
    mockList.crmAccess = FULL
    renderWithProviders(<LeasesListPage schedulerAvailable />)
    expect(screen.getByTestId('cell-companyName').textContent).toBe('Acme')
  })

  it('marks hidden names in the closure preview without dropping the rest of the line', () => {
    renderWithProviders(<PreviewImpactLists preview={applyPreviewCrmAccess(PREVIEW)} />)
    const booking = screen.getByTestId('pm-availability-bookings').textContent ?? ''
    const lease = screen.getByTestId('pm-availability-leases').textContent ?? ''
    expect(booking).toContain('Desk 1')
    expect(booking).toContain('Needs CRM access')
    expect(booking).not.toContain('Grace Hopper')
    expect(lease).toBe('L-0001 · Needs CRM access · Office 1')
  })

  it('names the person and company in the closure preview with CRM access', () => {
    renderWithProviders(<PreviewImpactLists preview={applyPreviewCrmAccess({ ...PREVIEW, crmAccess: FULL })} />)
    expect(screen.getByTestId('pm-availability-bookings').textContent).toContain('Grace Hopper')
    expect(screen.getByTestId('pm-availability-leases').textContent).toBe('L-0001 · Acme · Office 1')
    expect(screen.queryByTestId('pm-availability-crm-hidden')).toBeNull()
  })
})
