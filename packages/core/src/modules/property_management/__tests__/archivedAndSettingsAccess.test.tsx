/** @jest-environment jsdom */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { FloorLayoutData } from '../components/floor/types'

const mockGrantedFeatures: { current: string[] } = { current: [] }
const mockLayout: { current: FloorLayoutData | null } = { current: null }
const mockApiCall = jest.fn()

type MockTableProps<T> = { data?: T[]; rowActions?: (row: T) => React.ReactNode }
type MockCrudFormProps = { readOnly?: boolean; readOnlyOverlay?: React.ReactNode }

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: mockGrantedFeatures.current } }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/apiCall'),
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: <T,>(props: MockTableProps<T>) => (
    <section data-testid="data-table">
      {(props.data ?? []).map((row, index) => <div key={index}>{props.rowActions ? props.rowActions(row) : null}</div>)}
    </section>
  ),
}))
jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: Array<{ id?: string }> }) => (
    <span data-testid="row-actions" data-items={items.map((item) => item.id).join(',')} />
  ),
}))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: MockCrudFormProps) => (
    <form data-testid="crud-form" data-read-only={String(Boolean(props.readOnly))}>
      {props.readOnly ? props.readOnlyOverlay : null}
    </form>
  ),
}))
jest.mock('../components/availability/AvailabilityCell', () => ({
  AvailabilityCell: () => null,
  AvailabilityStateProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
jest.mock('../components/placement/useGuardedDelete', () => ({
  useGuardedDelete: () => ({ remove: jest.fn(), ConfirmDialogElement: null }),
}))
jest.mock('../components/floor/useFloorLayout', () => ({
  useFloorLayout: () => ({ data: mockLayout.current, loading: false, notFound: false, error: false, reload: jest.fn() }),
}))
jest.mock('../components/availability/useUnavailabilities', () => ({
  useUnavailabilities: () => ({ rows: [], loading: false, refreshing: false, error: false, reload: jest.fn() }),
}))
jest.mock('../components/availability/AvailabilityCard', () => ({ AvailabilityCard: () => null }))
jest.mock('../components/floor/FloorLayoutCanvas', () => ({ FloorLayoutCanvas: () => null }))

import { FloorSetupPage } from '../components/floor/FloorSetupPage'
import { FloorTables } from '../components/floor/FloorTables'
import { SettingsPage } from '../components/settings/SettingsPage'

const UPDATED_AT = '2026-11-01T00:00:00.000Z'
const RECT = { x: 0, y: 0, width: 4, depth: 3 }

function layout(status: string, unitCount = 0): FloorLayoutData {
  return {
    building: { id: 'building-1', name: 'Cedar Hall', address: 'Main 1', status, updatedAt: UPDATED_AT },
    floor: { id: 'floor-1', number: 1, name: 'First', sizeX: 20, sizeY: 10, updatedAt: UPDATED_AT },
    floors: [],
    spaces: [{ id: 'space-1', name: 'Atrium', purpose: null, isDefault: false, unitCount, updatedAt: UPDATED_AT, ...RECT }],
    units: [],
    commonAreas: [],
  } as FloorLayoutData
}

const AVAILABILITY = { rows: [], loading: false, refreshing: false, error: false, reload: jest.fn() }

describe('floor page of an archived building', () => {
  beforeEach(() => {
    mockGrantedFeatures.current = ['property_management.*']
  })

  it('is read-only with the archived notice, even for a manager', () => {
    mockLayout.current = layout('archived')
    renderWithProviders(<FloorSetupPage buildingId="building-1" floorId="floor-1" />)

    expect(screen.queryByText('Add unit')).toBeNull()
    expect(screen.queryByText('Add space')).toBeNull()
    expect(screen.getByTestId('crud-form')).toHaveAttribute('data-read-only', 'true')
    expect(screen.getByTestId('pm-archived-read-only')).toBeTruthy()
    expect(screen.queryAllByTestId('row-actions')).toHaveLength(0)
  })

  it('stays editable for a manager while the building is active', () => {
    mockLayout.current = layout('active')
    renderWithProviders(<FloorSetupPage buildingId="building-1" floorId="floor-1" />)

    expect(screen.getByText('Add unit')).toBeTruthy()
    expect(screen.getByTestId('crud-form')).toHaveAttribute('data-read-only', 'false')
    expect(screen.queryByTestId('pm-archived-read-only')).toBeNull()
  })
})

describe('floor tables space actions', () => {
  it('offers no delete for a space that still has units', () => {
    renderWithProviders(<FloorTables layout={layout('active', 2)} onChanged={jest.fn()} availability={AVAILABILITY} />)
    expect(screen.getByTestId('row-actions')).toHaveAttribute('data-items', 'edit')
  })

  it('offers delete for an empty space', () => {
    renderWithProviders(<FloorTables layout={layout('active', 0)} onChanged={jest.fn()} availability={AVAILABILITY} />)
    expect(screen.getByTestId('row-actions')).toHaveAttribute('data-items', 'edit,delete')
  })
})

describe('settings page access', () => {
  function respondWith(canEdit: boolean | undefined) {
    mockApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      result: { billingChannelId: null, cancelledOrderStatusEntryId: null, leaseEndingThresholdDays: 60, bookingReminderMinutes: 60, proposalExpiryDays: 14, updatedAt: UPDATED_AT, canEdit },
    })
  }

  beforeEach(() => {
    mockApiCall.mockReset()
    mockGrantedFeatures.current = ['property_management.*']
  })

  it('is read-only with a notice when the settings response says the caller cannot edit', async () => {
    respondWith(false)
    renderWithProviders(<SettingsPage />)
    await waitFor(() => expect(screen.getByTestId('crud-form')).toHaveAttribute('data-read-only', 'true'))
    expect(screen.getByTestId('pm-settings-read-only')).toBeTruthy()
  })

  it('is read-only when the settings response does not say the caller can edit', async () => {
    respondWith(undefined)
    renderWithProviders(<SettingsPage />)
    await waitFor(() => expect(screen.getByTestId('crud-form')).toHaveAttribute('data-read-only', 'true'))
    expect(screen.getByTestId('pm-settings-read-only')).toBeTruthy()
  })

  it('is editable when the settings response says the caller can edit, whatever the client-side grants', async () => {
    mockGrantedFeatures.current = ['property_management.view', 'property_management.manage']
    respondWith(true)
    renderWithProviders(<SettingsPage />)
    await waitFor(() => expect(screen.getByTestId('crud-form')).toHaveAttribute('data-read-only', 'false'))
    expect(screen.queryByTestId('pm-settings-read-only')).toBeNull()
  })
})
