/** @jest-environment jsdom */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { GatedLink, LINK_TARGET_FEATURES } from '../components/featureLinks'
import { LeaseFields } from '../components/floorPlan/UnitDetailSections'
import type { FloorPlanUnit } from '../components/floorPlan/floorPlanModel'

const mockGrantedFeatures: { current: string[] } = { current: [] }

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: mockGrantedFeatures.current } }),
}))

describe('GatedLink', () => {
  it('names the feature each target page requires', () => {
    expect(LINK_TARGET_FEATURES).toEqual({
      person: 'customers.people.view',
      company: 'customers.companies.view',
      product: 'catalog.products.view',
      salesOrder: 'sales.orders.view',
      salesChannels: 'sales.channels.manage',
      salesSettings: 'sales.settings.manage',
      settings: 'property_management.manage',
    })
  })

  it('links when the viewer has the target page feature, wildcards included', () => {
    mockGrantedFeatures.current = ['catalog.*']
    renderWithProviders(<GatedLink target="product" href="/backend/catalog/products/p1">Desk</GatedLink>)
    expect(screen.getByRole('link', { name: 'Desk' })).toHaveAttribute('href', '/backend/catalog/products/p1')
  })

  it('renders plain text without the target page feature', () => {
    mockGrantedFeatures.current = ['property_management.*', 'customers.companies.view']
    renderWithProviders(<GatedLink target="person" href="/backend/customers/people/x">Ada</GatedLink>)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Ada')).toBeTruthy()
  })
})

describe('floor plan lease fields', () => {
  const unit = {
    id: 'unit-1',
    use: 'leasable',
    lease: {
      id: 'lease-1', reference: 'L-0001', customerCompanyId: 'company-1', companyName: 'Acme', startsOn: '2026-01-01', endsOn: '2026-12-31',
      contactPersonId: 'person-1', contactName: 'Ada Lovelace', contactEmail: null, daysLeft: 40,
    },
  } as unknown as FloorPlanUnit

  it('links the tenant and contact only for viewers who can open them', () => {
    mockGrantedFeatures.current = ['property_management.view', 'customers.companies.view']
    renderWithProviders(<dl><LeaseFields unit={unit} crmAccess={{ people: true, companies: true }} /></dl>)
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    expect(hrefs).toEqual(['/backend/customers/companies/company-1', '/backend/property_management/leases/lease-1'])
    expect(screen.getByText('Ada Lovelace').closest('a')).toBeNull()
  })
})
