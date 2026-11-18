/** @jest-environment jsdom */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { BookingsList, LeaseFields, ProposalFields } from '../components/floorPlan/UnitDetailSections'
import { UnitTile } from '../components/floorPlan/UnitTile'
import { applyCrmAccess, readCrmAccess } from '../components/floorPlan/floorPlanCrm'
import type { CrmAccess, FloorPlanLayout, FloorPlanUnit } from '../components/floorPlan/floorPlanModel'

const mockGrantedFeatures: { current: string[] } = { current: [] }

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: mockGrantedFeatures.current }, isReady: true }),
}))

const STAMP = '2026-11-01T00:00:00.000Z'
const NONE: CrmAccess = { people: false, companies: false }
const FULL: CrmAccess = { people: true, companies: true }

function baseUnit(patch: Partial<FloorPlanUnit>): FloorPlanUnit {
  return {
    id: 'unit-1',
    name: 'Desk 1',
    spaceId: 'space-1',
    catalogCategoryId: 'category-1',
    catalogProductId: 'product-1',
    categoryName: 'Private office',
    productName: null,
    use: 'leasable',
    hasBlockers: false,
    updatedAt: STAMP,
    x: 0,
    y: 0,
    width: 2,
    depth: 2,
    ...patch,
  }
}

const LEASED = baseUnit({
  status: 'occupied',
  lease: {
    id: 'lease-1', reference: 'L-0001', status: 'active', startsOn: '2026-01-01', endsOn: '2026-12-31', daysLeft: 40,
    customerCompanyId: 'company-1', companyName: 'Acme', contactPersonId: 'person-1', contactName: 'Ada Lovelace',
    contactEmail: 'ada@example.com', extensionRespondBy: null,
  },
})

const PROPOSED = baseUnit({
  proposed: true,
  proposal: { id: 'proposal-1', leaseId: 'lease-2', reference: 'L-0002', respondBy: null, startsOn: '2026-12-01', endsOn: '2027-11-30', customerCompanyId: 'company-2', companyName: 'Globex' },
})

const BOOKED = baseUnit({
  use: 'bookable',
  status: 'booked',
  bookings: [{
    id: 'booking-1', status: 'confirmed', startsAt: '2026-11-16T09:00:00.000Z', endsAt: '2026-11-16T11:00:00.000Z', billingUnit: 'hour',
    productName: 'Desk', personId: 'person-2', personName: 'Grace Hopper', companyId: 'company-3', companyName: 'Initech',
  }],
})

function layoutOf(units: FloorPlanUnit[], crmAccess?: unknown): FloorPlanLayout {
  const floor = { id: 'floor-1', number: 1, name: 'First', sizeX: 20, sizeY: 10, updatedAt: STAMP }
  return {
    building: { id: 'building-1', name: 'Cedar Hall', address: 'Main 1', status: 'active', updatedAt: STAMP },
    floor,
    floors: [floor],
    spaces: [],
    units,
    commonAreas: [],
    ...(crmAccess === undefined ? {} : { crmAccess: crmAccess as CrmAccess }),
  }
}

describe('floor plan CRM access', () => {
  beforeEach(() => {
    mockGrantedFeatures.current = ['property_management.view', 'customers.*']
  })

  it('treats a missing or malformed crmAccess as hidden', () => {
    expect(readCrmAccess(undefined)).toEqual(NONE)
    expect(readCrmAccess({ people: 'yes', companies: 1 })).toEqual(NONE)
    expect(readCrmAccess({ people: true })).toEqual({ people: true, companies: false })
  })

  it('drops CRM names the layout carries when the access flag is missing', () => {
    const layout = applyCrmAccess(layoutOf([LEASED, PROPOSED, BOOKED]))
    expect(layout.crmAccess).toEqual(NONE)
    const [leased, proposed, booked] = layout.units
    expect(leased.lease).toMatchObject({ companyName: null, contactName: null, contactEmail: null, contactPersonId: 'person-1' })
    expect(proposed.proposal?.companyName).toBeNull()
    expect(booked.bookings?.[0]).toMatchObject({ personName: null, companyName: null, personId: 'person-2' })
  })

  it('keeps only the names the caller may see', () => {
    const layout = applyCrmAccess(layoutOf([LEASED, BOOKED], { people: true, companies: false }))
    expect(layout.units[0].lease).toMatchObject({ companyName: null, contactName: 'Ada Lovelace', contactEmail: 'ada@example.com' })
    expect(layout.units[1].bookings?.[0]).toMatchObject({ personName: 'Grace Hopper', companyName: null })
  })

  it('shows a muted note instead of the tenant and contact, with no customer links', () => {
    const [unit] = applyCrmAccess(layoutOf([LEASED])).units
    renderWithProviders(<dl><LeaseFields unit={unit} crmAccess={NONE} /></dl>)
    expect(screen.getAllByTestId('pm-floor-plan-crm-hidden')).toHaveLength(2)
    expect(screen.getAllByText('Needs CRM access')).toHaveLength(2)
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    expect(hrefs).toEqual(['/backend/property_management/leases/lease-1'])
    expect(screen.queryByText('ada@example.com')).toBeNull()
  })

  it('never renders an empty customer link when access is granted but a name is missing', () => {
    const unit = baseUnit({ ...LEASED, lease: { ...LEASED.lease!, companyName: undefined, contactName: undefined, contactEmail: undefined } })
    renderWithProviders(<dl><LeaseFields unit={unit} crmAccess={FULL} /></dl>)
    for (const link of screen.getAllByRole('link')) expect(link.textContent?.trim()).not.toBe('')
    expect(screen.queryByTestId('pm-floor-plan-crm-hidden')).toBeNull()
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('still says there is no contact person when the lease has none', () => {
    const unit = baseUnit({ ...LEASED, lease: { ...LEASED.lease!, contactPersonId: null, contactName: null } })
    renderWithProviders(<dl><LeaseFields unit={unit} crmAccess={NONE} /></dl>)
    expect(screen.getByText('No contact person')).toBeTruthy()
    expect(screen.getAllByTestId('pm-floor-plan-crm-hidden')).toHaveLength(1)
  })

  it('describes a proposal without the company when companies are hidden', () => {
    const [unit] = applyCrmAccess(layoutOf([PROPOSED])).units
    renderWithProviders(<ProposalFields unit={unit} crmAccess={NONE} />)
    expect(screen.getByTestId('pm-floor-plan-proposal').textContent).toContain('Offered from')
    expect(screen.queryByText(/Offered to/)).toBeNull()
  })

  it('hides booking person and company names without CRM access', () => {
    const [unit] = applyCrmAccess(layoutOf([BOOKED])).units
    renderWithProviders(<dl><BookingsList unit={unit} date="2026-11-16" crmAccess={NONE} /></dl>)
    const row = screen.getByTestId('pm-floor-plan-booking-booking-1')
    expect(row.textContent).toContain('Needs CRM access')
    expect(row.querySelector('a')).toBeNull()
    expect(screen.queryByText('Grace Hopper')).toBeNull()
    expect(screen.queryByText('Initech')).toBeNull()
  })

  it('falls back to the category on a leased tile when the company is hidden', () => {
    const [unit] = applyCrmAccess(layoutOf([LEASED])).units
    renderWithProviders(<div className="relative"><UnitTile unit={unit} sizeX={20} sizeY={10} selected={false} onSelect={jest.fn()} /></div>)
    const tile = screen.getByTestId('pm-floor-plan-unit-unit-1')
    expect(tile.textContent).toContain('Private office')
    expect(tile.textContent).not.toContain('Acme')
  })
})

describe('floor plan unit tile', () => {
  it('renders through the shared Button and keeps the toggle, popup and roving tab stop', () => {
    const onSelect = jest.fn()
    const view = renderWithProviders(<UnitTile unit={LEASED} sizeX={20} sizeY={10} selected tabStop={false} onSelect={onSelect} />)
    const tile = screen.getByTestId('pm-floor-plan-unit-unit-1')
    expect(tile.tagName).toBe('BUTTON')
    expect(tile).toHaveAttribute('data-slot', 'button')
    expect(tile).toHaveAttribute('type', 'button')
    expect(tile).toHaveAttribute('aria-pressed', 'true')
    expect(tile).toHaveAttribute('aria-haspopup', 'dialog')
    expect(tile.tabIndex).toBe(-1)
    tile.click()
    expect(onSelect).toHaveBeenCalledWith('unit-1')
    view.rerender(<UnitTile unit={LEASED} sizeX={20} sizeY={10} selected={false} tabStop onSelect={onSelect} />)
    expect(tile).toHaveAttribute('aria-pressed', 'false')
    expect(tile.tabIndex).toBe(0)
  })
})
