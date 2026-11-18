/** @jest-environment jsdom */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { UnitDetailDrawer } from '../components/floorPlan/UnitDetailDrawer'
import type { FloorPlanUnit } from '../components/floorPlan/floorPlanModel'

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: ['property_management.*'] }, isReady: true }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/backend/property_management/floor-plan',
  useSearchParams: () => new URLSearchParams(),
}))

const UNIT: FloorPlanUnit = {
  id: 'unit-1',
  name: 'Office 1',
  spaceId: 'space-1',
  catalogCategoryId: 'category-1',
  catalogProductId: 'product-1',
  categoryName: 'Private office',
  productName: 'Office',
  use: 'leasable',
  hasBlockers: false,
  updatedAt: '2026-11-01T00:00:00.000Z',
  status: 'free',
  x: 0,
  y: 0,
  width: 2,
  depth: 2,
}

function renderDrawer(unit: FloorPlanUnit) {
  return renderWithProviders(<UnitDetailDrawer unit={unit} date="2026-11-16" crmAccess={{ people: true, companies: true }} onClose={jest.fn()} />)
}

describe('UnitDetailDrawer markup', () => {
  it('renders the vacant note as a dt/dd group so the description list stays valid', () => {
    renderDrawer(UNIT)
    const vacant = screen.getByTestId('pm-floor-plan-vacant')
    expect(vacant.parentElement?.tagName).toBe('DL')
    expect(vacant.querySelector('dt')?.textContent).toBe('Tenant')
    expect(vacant.querySelector('dd')?.textContent).toBe('Vacant and ready to lease.')
    for (const list of Array.from(document.querySelectorAll('dl'))) {
      for (const child of Array.from(list.children)) expect(['DT', 'DD', 'DIV']).toContain(child.tagName)
    }
  })

  it('opens the bookings list filtered to this unit and day', () => {
    renderDrawer({ ...UNIT, use: 'bookable', bookings: [] })
    const href = screen.getByTestId('pm-floor-plan-open-bookings').getAttribute('href') ?? ''
    const params = new URLSearchParams(href.split('?')[1] ?? '')
    expect(params.get('unitId')).toBe('unit-1')
    expect(params.get('unitName')).toBe('Office 1')
    expect(params.get('date')).toBe('2026-11-16')
  })
})
