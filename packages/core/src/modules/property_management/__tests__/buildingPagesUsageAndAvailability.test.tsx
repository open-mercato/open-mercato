/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const mockGrantedFeatures: { current: string[] } = { current: [] }
const mockApiCall = jest.fn()

type MockTableProps = { actions?: React.ReactNode; data?: unknown[] }
type MockCrudFormProps = { readOnly?: boolean; readOnlyOverlay?: React.ReactNode }
type MockSwitchProps = { subject: { type: string; id: string }; disabled?: boolean }

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: mockGrantedFeatures.current } }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/backend/property_management/buildings',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/apiCall'),
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: MockTableProps) => (
    <section data-testid="data-table" data-rows={String(props.data?.length ?? 0)}>
      {props.actions}
    </section>
  ),
}))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: MockCrudFormProps) => (
    <form data-testid="crud-form" data-read-only={String(Boolean(props.readOnly))}>
      {props.readOnly ? props.readOnlyOverlay : null}
    </form>
  ),
}))
jest.mock('../components/buildings/buildingForm', () => ({
  useBuildingFormConfig: () => ({ fields: [], groups: [] }),
  createInitialValues: () => ({}),
  buildBuildingPayload: () => ({}),
}))
jest.mock('../components/availability/AvailabilityCell', () => ({
  AvailabilityCell: () => null,
  AvailabilityStateProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
jest.mock('../components/availability/useUnavailabilities', () => ({
  useUnavailabilities: () => ({ rows: [], loading: false, refreshing: false, error: false, reload: jest.fn() }),
}))
jest.mock('../components/availability/AvailabilityCard', () => ({ AvailabilityCard: () => null }))
jest.mock('../components/availability/AvailabilitySwitch', () => ({
  AvailabilitySwitch: (props: MockSwitchProps) => (
    <button type="button" data-testid={`switch-${props.subject.type}-${props.subject.id}`} disabled={props.disabled} />
  ),
}))
jest.mock('../components/buildings/BuildingArchiveDialog', () => ({ BuildingArchiveDialog: () => null }))

import { BuildingDeleteDialog } from '../components/buildings/BuildingDeleteDialog'
import { BuildingsListPage } from '../components/buildings/BuildingsListPage'
import { BuildingEditPage } from '../components/buildings/BuildingEditPage'

const UPDATED_AT = '2026-11-01T00:00:00.000Z'
const TARGET = { id: 'building-1', name: 'Cedar Hall', updatedAt: UPDATED_AT }
const USAGE = { floorCount: 2, spaceCount: 3, unitCount: 4, commonAreaCount: 0, everUsed: false, canDelete: true, canArchive: true, blockers: [] }

beforeEach(() => {
  mockApiCall.mockReset()
})

describe('building delete dialog when the usage check fails', () => {
  it('shows the error with a retry and keeps confirm disabled until the counts load', async () => {
    mockGrantedFeatures.current = ['property_management.*']
    mockApiCall.mockResolvedValueOnce({ ok: false, status: 500, result: null })
    renderWithProviders(<BuildingDeleteDialog target={TARGET} onClose={jest.fn()} onDeleted={jest.fn()} />)

    expect(await screen.findByTestId('pm-building-delete-usage-error')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Type the building name to confirm'), { target: { value: 'Cedar Hall' } })
    const confirm = screen.getByRole('button', { name: 'Delete building' })
    expect(confirm).toBeDisabled()

    mockApiCall.mockResolvedValueOnce({ ok: true, status: 200, result: USAGE })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByTestId('pm-building-delete-usage-error')).toBeNull())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete building' })).not.toBeDisabled())
  })
})

describe('buildings list summary', () => {
  const row = { id: 'building-1', name: 'Cedar Hall', address: 'Main 1', status: 'active', floorCount: 2, spaceCount: 3, unitCount: 4, updatedAt: UPDATED_AT }

  function respond(totalPages: number) {
    mockApiCall.mockResolvedValue({ ok: true, status: 200, result: { items: [row], total: totalPages * 50, totalPages, archivedCount: 0, canManageAll: true } })
  }

  it('labels the floor, space and unit totals as page totals when there is more than one page', async () => {
    mockGrantedFeatures.current = ['property_management.view']
    respond(2)
    renderWithProviders(<BuildingsListPage />)
    await waitFor(() => expect(screen.getByTestId('data-table')).toHaveAttribute('data-rows', '1'))
    expect(screen.getByTestId('pm-buildings-summary').textContent).toContain('on this page:')
  })

  it('keeps the plain totals when every building is on the page', async () => {
    mockGrantedFeatures.current = ['property_management.view']
    respond(1)
    renderWithProviders(<BuildingsListPage />)
    await waitFor(() => expect(screen.getByTestId('data-table')).toHaveAttribute('data-rows', '1'))
    expect(screen.getByTestId('pm-buildings-summary').textContent).not.toContain('on this page')
  })
})

describe('building edit page floor availability', () => {
  const building = {
    id: 'building-1',
    name: 'Cedar Hall',
    address: 'Main 1',
    status: 'active',
    updatedAt: UPDATED_AT,
    floors: [
      { id: 'floor-0', number: 0, name: 'Ground', sizeX: 10, sizeY: 10, spaceCount: 1, unitCount: 1 },
      { id: 'floor-1', number: 1, name: 'First', sizeX: 10, sizeY: 10, spaceCount: 1, unitCount: 1 },
    ],
  }

  beforeEach(() => {
    mockApiCall.mockResolvedValue({ ok: true, status: 200, result: { items: [building], canManageAll: false } })
  })

  it('renders usable floor switches outside the read-only form for an availability manager without manage', async () => {
    mockGrantedFeatures.current = ['property_management.view', 'property_management.availability.manage']
    renderWithProviders(<BuildingEditPage buildingId="building-1" />)

    const card = await screen.findByTestId('pm-floor-availability')
    expect(screen.getByTestId('crud-form')).toHaveAttribute('data-read-only', 'true')
    expect(screen.getByTestId('crud-form').contains(card)).toBe(false)
    expect(screen.getByTestId('switch-floor-floor-0')).not.toBeDisabled()
    expect(screen.getByTestId('switch-floor-floor-1')).not.toBeDisabled()
  })

  it('leaves the floor availability card out for a view-only user and for a manager', async () => {
    mockGrantedFeatures.current = ['property_management.view']
    const viewOnly = renderWithProviders(<BuildingEditPage buildingId="building-1" />)
    await screen.findByTestId('crud-form')
    expect(screen.queryByTestId('pm-floor-availability')).toBeNull()
    viewOnly.unmount()

    mockGrantedFeatures.current = ['property_management.*']
    renderWithProviders(<BuildingEditPage buildingId="building-1" />)
    expect(await screen.findByTestId('crud-form')).toHaveAttribute('data-read-only', 'false')
    expect(screen.queryByTestId('pm-floor-availability')).toBeNull()
  })
})
