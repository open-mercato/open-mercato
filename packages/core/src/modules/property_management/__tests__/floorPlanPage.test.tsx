/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

type MockLoadState = { data: unknown; loading: boolean; error: boolean; notFound: boolean; reload: jest.Mock }

const mockGrantedFeatures: { current: string[] } = { current: [] }
const mockBuildings: { current: MockLoadState & { resolving: boolean } } = {
  current: { data: null, loading: false, error: false, notFound: false, reload: jest.fn(), resolving: false },
}
const mockLayout: { current: MockLoadState } = {
  current: { data: null, loading: false, error: false, notFound: false, reload: jest.fn() },
}

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: mockGrantedFeatures.current } }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/backend/property_management/floor-plan',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('../components/floorPlan/useFloorPlanData', () => ({
  useFloorPlanBuildings: () => mockBuildings.current,
  useFloorPlanLayout: () => mockLayout.current,
}))
jest.mock('../components/floorPlan/FloorPlanToolbar', () => ({ FloorPlanToolbar: () => null }))
jest.mock('../components/floorPlan/FloorPlanCanvas', () => ({ FloorPlanCanvas: () => null }))
jest.mock('../components/floorPlan/FloorPlanLegend', () => ({ FloorPlanLegend: () => null }))
jest.mock('../components/floorPlan/UnitDetailDrawer', () => ({ UnitDetailDrawer: () => null }))

import { FloorPlanPage } from '../components/floorPlan/FloorPlanPage'

const BUILDING = {
  id: 'building-1',
  name: 'Cedar Hall',
  status: 'active',
  floors: [{ id: 'floor-1', number: 1, name: 'First', sizeX: 20, sizeY: 10 }],
}

function setBuildings(buildings: unknown[], canManageAll = true) {
  mockBuildings.current = { data: { buildings, canManageAll }, loading: false, error: false, notFound: false, reload: jest.fn(), resolving: false }
}

function setLayout(patch: Partial<MockLoadState>) {
  mockLayout.current = { data: null, loading: false, error: false, notFound: false, reload: jest.fn(), ...patch }
}

describe('floor plan page', () => {
  it('shows a not-found state instead of a retryable error when the floor is gone', () => {
    mockGrantedFeatures.current = ['property_management.view']
    setBuildings([BUILDING])
    setLayout({ notFound: true })
    renderWithProviders(<FloorPlanPage today="2026-11-16" />)

    expect(screen.getByText('Floor not found')).toBeTruthy()
    expect(screen.queryByText('Could not load the leases and bookings of this floor.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Reload the floor plan' }))
    expect(mockBuildings.current.reload).toHaveBeenCalledTimes(1)
    expect(mockLayout.current.reload).toHaveBeenCalledTimes(1)
  })

  it('keeps the retryable error for a failed layout load', () => {
    mockGrantedFeatures.current = ['property_management.view']
    setBuildings([BUILDING])
    setLayout({ error: true })
    renderWithProviders(<FloorPlanPage today="2026-11-16" />)

    expect(screen.getByText('Could not load the leases and bookings of this floor.')).toBeTruthy()
    expect(screen.queryByText('Floor not found')).toBeNull()
  })

  it('hides "Add building" from a user who sees every building but cannot manage', () => {
    mockGrantedFeatures.current = ['property_management.view', 'property_management.buildings.manage_all']
    setBuildings([])
    setLayout({})
    renderWithProviders(<FloorPlanPage today="2026-11-16" />)

    expect(screen.getByText('No buildings yet')).toBeTruthy()
    expect(screen.queryByText('Add building')).toBeNull()
  })

  it('offers "Add building" to a manager with a wildcard grant', () => {
    mockGrantedFeatures.current = ['property_management.*']
    setBuildings([])
    setLayout({})
    renderWithProviders(<FloorPlanPage today="2026-11-16" />)

    expect(screen.getByText('Add building')).toBeTruthy()
  })
})
