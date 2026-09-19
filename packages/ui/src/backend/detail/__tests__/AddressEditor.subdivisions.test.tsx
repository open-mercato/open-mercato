/**
 * @jest-environment jsdom
 *
 * The region control follows the address's country, not the organization's market.
 *
 * The case that drove the change: a merchant with no market profile at all entering a US address
 * used to get a free-text field, because the list was keyed off `profile.defaultCountryCode`. The
 * inverse defect mattered just as much - a US-market merchant entering a Canadian address was shown
 * Alabama to Wyoming and warned about every valid Ontario value.
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { US_DISPLAY_TEMPLATE } from '@open-mercato/shared/lib/display/templates'
import { AddressEditor, type AddressEditorDraft } from '../AddressEditor'

if (typeof window !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
}

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/customers/people/1',
  useSearchParams: () => new URLSearchParams(),
}))

const t = (_key: string, fallback?: string) => fallback ?? ''

const WARNING = 'This state is not in the list for the selected country. The record still saves.'

const draft = (over: Partial<AddressEditorDraft> = {}): AddressEditorDraft => ({
  name: '', purpose: '', companyName: '', addressLine1: 'Main Street 1', addressLine2: '',
  buildingNumber: '', flatNumber: '', city: 'Plano', region: '', postalCode: '75074',
  country: 'US', isPrimary: false, ...over,
})

function render(over: Partial<AddressEditorDraft> = {}, props: Record<string, unknown> = {}) {
  const onChange = jest.fn()
  const view = renderWithProviders(
    <AddressEditor value={draft(over)} format="line_first" t={t} onChange={onChange} {...props} />,
  )
  return { ...view, onChange }
}

/** Radix renders its items only once the trigger has been opened. */
function openRegionSelect() {
  const trigger = screen.getByRole('combobox', { name: 'Region' })
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
  fireEvent.click(trigger)
  return trigger
}

function pickOption(name: string) {
  const option = screen.getByRole('option', { name })
  fireEvent.pointerDown(option)
  fireEvent.click(option)
}

describe('AddressEditor - the region control follows the address country', () => {
  it('offers the 50 states plus DC for a US address even with no market profile', () => {
    render({ country: 'US' })
    openRegionSelect()
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(51)
    expect(screen.getByRole('option', { name: 'Texas' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'District of Columbia' })).toBeInTheDocument()
  })

  it('leaves the territories out of the picker', () => {
    render({ country: 'US' })
    openRegionSelect()
    // Asserted against an open list, so a picker that failed to open cannot pass this vacuously.
    expect(screen.getByRole('option', { name: 'Wyoming' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Puerto Rico' })).toBeNull()
    expect(screen.queryByRole('option', { name: 'Guam' })).toBeNull()
  })

  it('renders a text input for a country with no list, whatever the market is', () => {
    render({ country: 'PL', region: 'Mazowieckie' })
    expect(screen.queryByRole('combobox', { name: 'Region' })).toBeNull()
    expect(screen.getByPlaceholderText('Region')).toHaveValue('Mazowieckie')
  })

  it('gives a US-market merchant a text field for a Canadian address', () => {
    // The inverse defect: the list used to follow the organization, so Canada showed US states.
    render({ country: 'CA', region: 'Ontario' }, { profile: US_DISPLAY_TEMPLATE })
    expect(screen.queryByRole('combobox', { name: 'Region' })).toBeNull()
    expect(screen.getByPlaceholderText('Region')).toHaveValue('Ontario')
    expect(screen.queryByText(WARNING)).toBeNull()
  })

  it('preselects the state a legacy full name denotes, without warning and without rewriting it', () => {
    const { onChange } = render({ country: 'US', region: 'Texas' })
    expect(screen.getByRole('combobox', { name: 'Region' })).toHaveTextContent('Texas')
    expect(screen.queryByText(WARNING)).toBeNull()
    // Invariant 3: opening a record never writes to it.
    expect(onChange).not.toHaveBeenCalled()
  })

  it('preselects a lowercase legacy name and a plain code alike', () => {
    const { unmount } = render({ country: 'US', region: 'texas' })
    expect(screen.getByRole('combobox', { name: 'Region' })).toHaveTextContent('Texas')
    unmount()

    render({ country: 'US', region: 'TX' })
    expect(screen.getByRole('combobox', { name: 'Region' })).toHaveTextContent('Texas')
  })

  it('warns about a value that denotes no state, and keeps it saveable', () => {
    const { onChange } = render({ country: 'US', region: 'Mazowieckie' })
    expect(screen.getByText(WARNING)).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('writes the two-letter code when a state is picked', () => {
    const { onChange } = render({ country: 'US', region: '' })
    openRegionSelect()
    pickOption('Texas')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ region: 'TX' }))
  })

  it('keeps the typed value when the country switches away from the United States', () => {
    // Invariant 5: changing the country never clears the region.
    render({ country: 'PL', region: 'TX' })
    expect(screen.getByPlaceholderText('Region')).toHaveValue('TX')
  })
})
