/** @jest-environment jsdom */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const mockGrantedFeatures: { current: string[] } = { current: [] }
const mockFloorTables = jest.fn((props: { readOnly?: boolean }) => <div data-testid="floor-tables" data-read-only={String(props.readOnly)} />)
const mockFloorDetails = jest.fn((props: { readOnly?: boolean }) => <div data-testid="floor-details" data-read-only={String(props.readOnly)} />)

const mockApiCall = jest.fn()

type MockTableProps = {
  title?: React.ReactNode
  actions?: React.ReactNode
  emptyState?: React.ReactNode
  data?: unknown[]
  onRowClick?: (row: unknown) => void
  rowActions?: (row: unknown) => React.ReactNode
}

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
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: MockTableProps) => (
    <section
      data-testid="data-table"
      data-rows={String(props.data?.length ?? 0)}
      data-row-click={String(typeof props.onRowClick === 'function')}
      data-row-actions={String(typeof props.rowActions === 'function')}
    >
      <h2>{props.title}</h2>
      {props.actions}
      {props.data?.length ? null : props.emptyState}
    </section>
  ),
}))
jest.mock('../components/availability/AvailabilityCell', () => ({
  AvailabilityCell: () => null,
  AvailabilityStateProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
jest.mock('../components/placement/useGuardedDelete', () => ({
  useGuardedDelete: () => ({ remove: jest.fn(), ConfirmDialogElement: null }),
}))
jest.mock('../components/buildings/BuildingDeleteDialog', () => ({ BuildingDeleteDialog: () => null }))
jest.mock('../components/buildings/BuildingArchiveDialog', () => ({ BuildingArchiveDialog: () => null }))
jest.mock('../components/floor/useFloorLayout', () => ({
  useFloorLayout: () => ({
    data: {
      building: { id: 'building-1', name: 'Cedar Hall', address: 'Main 1', status: 'active', updatedAt: '2026-11-01T00:00:00.000Z' },
      floor: { id: 'floor-1', number: 1, name: 'First', sizeX: 20, sizeY: 10, updatedAt: '2026-11-01T00:00:00.000Z' },
      floors: [],
      spaces: [],
      units: [],
      commonAreas: [],
    },
    loading: false,
    notFound: false,
    error: false,
    reload: jest.fn(),
  }),
}))
jest.mock('../components/availability/useUnavailabilities', () => ({
  useUnavailabilities: () => ({ rows: [], loading: false, refreshing: false, error: false, reload: jest.fn() }),
}))
jest.mock('../components/availability/AvailabilityCard', () => ({ AvailabilityCard: () => null }))
jest.mock('../components/floor/FloorLayoutCanvas', () => ({ FloorLayoutCanvas: () => null }))
jest.mock('../components/floor/FloorTables', () => ({ FloorTables: (props: { readOnly?: boolean }) => mockFloorTables(props) }))
jest.mock('../components/floor/FloorDetailsForm', () => ({ FloorDetailsForm: (props: { readOnly?: boolean }) => mockFloorDetails(props) }))

import { FloorSetupPage } from '../components/floor/FloorSetupPage'
import { BuildingsListPage } from '../components/buildings/BuildingsListPage'
import { UnitDetailDrawer } from '../components/floorPlan/UnitDetailDrawer'
import type { FloorTablesProps } from '../components/floor/FloorTables'
import type { FloorLayoutData } from '../components/floor/types'
import type { FloorPlanUnit } from '../components/floorPlan/floorPlanModel'

const { FloorTables: RealFloorTables } = jest.requireActual<{ FloorTables: (props: FloorTablesProps) => React.ReactElement }>('../components/floor/FloorTables')

const RECT = { x: 0, y: 0, width: 4, depth: 3 }
const UPDATED_AT = '2026-11-01T00:00:00.000Z'

const UNIT: FloorPlanUnit = {
  id: 'unit-1',
  name: 'Desk 1',
  spaceId: 'space-1',
  catalogCategoryId: 'category-1',
  catalogProductId: 'product-1',
  categoryName: 'Desk',
  productName: 'Hot desk',
  use: 'bookable',
  hasBlockers: false,
  updatedAt: UPDATED_AT,
  status: 'free',
  bookings: [],
  ...RECT,
}

const LAYOUT: FloorLayoutData = {
  building: { id: 'building-1', name: 'Cedar Hall', address: 'Main 1', status: 'active', updatedAt: UPDATED_AT },
  floor: { id: 'floor-1', number: 1, name: 'First', sizeX: 20, sizeY: 10, updatedAt: UPDATED_AT },
  floors: [],
  spaces: [{ id: 'space-1', name: 'Atrium', purpose: null, isDefault: false, unitCount: 1, updatedAt: UPDATED_AT, ...RECT }],
  units: [UNIT],
  commonAreas: [{ id: 'area-1', name: 'Kitchen', kind: 'kitchen', updatedAt: UPDATED_AT, ...RECT }],
}

const AVAILABILITY = { rows: [], loading: false, refreshing: false, error: false, reload: jest.fn() }

function buildingsResponse(items: unknown[]) {
  return { ok: true, status: 200, result: { items, total: items.length, totalPages: 1, archivedCount: 0, canManageAll: true } }
}

const BUILDING_ROW = {
  id: 'building-1',
  name: 'Cedar Hall',
  address: 'Main 1',
  status: 'active',
  floorCount: 1,
  spaceCount: 1,
  unitCount: 1,
  updatedAt: UPDATED_AT,
}

function tables() {
  return screen.getAllByTestId('data-table')
}

describe('floor page for a view-only user', () => {
  it('hides the add actions and renders the details and tables read-only', () => {
    mockGrantedFeatures.current = ['property_management.view']
    renderWithProviders(<FloorSetupPage buildingId="building-1" floorId="floor-1" />)

    expect(screen.queryByText('Add unit')).toBeNull()
    expect(screen.queryByText('Add space')).toBeNull()
    expect(screen.queryByText('Add common area')).toBeNull()
    expect(screen.getByTestId('floor-details')).toHaveAttribute('data-read-only', 'true')
    expect(screen.getByTestId('floor-tables')).toHaveAttribute('data-read-only', 'true')
  })

  it('keeps every write control for a manager, including a wildcard grant', () => {
    mockGrantedFeatures.current = ['property_management.*']
    renderWithProviders(<FloorSetupPage buildingId="building-1" floorId="floor-1" />)

    expect(screen.getByText('Add unit')).toBeTruthy()
    expect(screen.getByText('Add space')).toBeTruthy()
    expect(screen.getByTestId('floor-details')).toHaveAttribute('data-read-only', 'false')
    expect(screen.getByTestId('floor-tables')).toHaveAttribute('data-read-only', 'false')
  })
})

describe('floor tables for a view-only user', () => {
  it('drops the row click and the row actions of every table when read-only', () => {
    mockGrantedFeatures.current = ['property_management.view']
    renderWithProviders(<RealFloorTables layout={LAYOUT} onChanged={jest.fn()} availability={AVAILABILITY} readOnly />)

    expect(tables()).toHaveLength(3)
    for (const table of tables()) {
      expect(table).toHaveAttribute('data-row-click', 'false')
      expect(table).toHaveAttribute('data-row-actions', 'false')
    }
  })

  it('keeps the row click and the row actions for a manager', () => {
    mockGrantedFeatures.current = ['property_management.*']
    renderWithProviders(<RealFloorTables layout={LAYOUT} onChanged={jest.fn()} availability={AVAILABILITY} />)

    for (const table of tables()) {
      expect(table).toHaveAttribute('data-row-click', 'true')
      expect(table).toHaveAttribute('data-row-actions', 'true')
    }
  })
})

describe('buildings list for a view-only user', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
  })

  it('hides the new-building button and the row actions', async () => {
    mockGrantedFeatures.current = ['property_management.view']
    mockApiCall.mockResolvedValue(buildingsResponse([BUILDING_ROW]))
    renderWithProviders(<BuildingsListPage />)

    await waitFor(() => expect(screen.getByTestId('data-table')).toHaveAttribute('data-rows', '1'))
    expect(screen.queryByText('New building')).toBeNull()
    expect(screen.getByTestId('data-table')).toHaveAttribute('data-row-actions', 'false')
    expect(screen.getByTestId('data-table')).toHaveAttribute('data-row-click', 'true')
  })

  it('offers no create link in the empty state', async () => {
    mockGrantedFeatures.current = ['property_management.view']
    mockApiCall.mockResolvedValue(buildingsResponse([]))
    renderWithProviders(<BuildingsListPage />)

    await waitFor(() => expect(mockApiCall).toHaveBeenCalled())
    expect(await screen.findByText('No buildings yet')).toBeTruthy()
    expect(screen.queryByText('New building')).toBeNull()
  })

  it('keeps the write actions for a manager with a wildcard grant', async () => {
    mockGrantedFeatures.current = ['property_management.*']
    mockApiCall.mockResolvedValue(buildingsResponse([BUILDING_ROW]))
    renderWithProviders(<BuildingsListPage />)

    await waitFor(() => expect(screen.getByTestId('data-table')).toHaveAttribute('data-rows', '1'))
    expect(screen.getByText('New building')).toBeTruthy()
    expect(screen.getByTestId('data-table')).toHaveAttribute('data-row-actions', 'true')
  })
})

describe('floor-plan unit drawer for a view-only user', () => {
  it('hides the edit-unit button', () => {
    mockGrantedFeatures.current = ['property_management.view']
    renderWithProviders(<UnitDetailDrawer unit={UNIT} date="2026-11-16" crmAccess={{ people: true, companies: true }} onClose={jest.fn()} />)

    expect(screen.getByText('Desk 1')).toBeTruthy()
    expect(screen.queryByText('Edit unit')).toBeNull()
  })

  it('shows the edit-unit button for a manager with a wildcard grant', () => {
    mockGrantedFeatures.current = ['property_management.*']
    renderWithProviders(<UnitDetailDrawer unit={UNIT} date="2026-11-16" crmAccess={{ people: true, companies: true }} onClose={jest.fn()} />)

    expect(screen.getByText('Edit unit')).toBeTruthy()
  })
})
