/**
 * @jest-environment jsdom
 *
 * The customers twin of `packages/ui`'s AddressEditor, asserted on the same rules.
 *
 * The two files are still two files (the parent spec's Phase 3 collapses them), so the behavior is
 * pinned on both sides: this editor also serves the sales documents and the staff address forms, and
 * a merchant should not get a state dropdown on the customer record and a free-text field on the
 * quote for the same address.
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

const t = (_key: string, fallback?: string) => fallback ?? ''

const WARNING = 'This state is not in the list for the selected country. The record still saves.'

const draft = (over: Partial<AddressEditorDraft> = {}): AddressEditorDraft => ({
  name: '', purpose: '', companyName: '', addressLine1: 'Main Street 1', addressLine2: '',
  buildingNumber: '', flatNumber: '', city: 'Plano', region: '', postalCode: '75074',
  country: 'US', isPrimary: false, ...over,
})

function render(over: Partial<AddressEditorDraft> = {}, props: Record<string, unknown> = {}) {
  const onChange = jest.fn()
  // `profile: null` stands for an organization that never picked a market - the case the brief is
  // about. Passing it explicitly also keeps the context provider out of the picture.
  const view = renderWithProviders(
    <AddressEditor value={draft(over)} format="line_first" t={t} onChange={onChange} profile={null} {...props} />,
  )
  return { ...view, onChange }
}

/** Radix renders its items only once the trigger has been opened. */
function openRegionSelect() {
  const trigger = screen.getByRole('combobox', { name: 'Region/state' })
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
  fireEvent.click(trigger)
  return trigger
}

function pickOption(name: string) {
  const option = screen.getByRole('option', { name })
  fireEvent.pointerDown(option)
  fireEvent.click(option)
}

describe('customers AddressEditor - the region control follows the address country', () => {
  it('offers the 50 states plus DC for a US address even with no market profile', () => {
    render({ country: 'US' })
    openRegionSelect()
    expect(screen.getAllByRole('option')).toHaveLength(51)
    expect(screen.getByRole('option', { name: 'Texas' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'District of Columbia' })).toBeInTheDocument()
  })

  it('leaves the territories out of the picker', () => {
    render({ country: 'US' })
    openRegionSelect()
    expect(screen.getByRole('option', { name: 'Wyoming' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Puerto Rico' })).toBeNull()
  })

  it('renders a text input for a country with no list', () => {
    render({ country: 'PL', region: 'Mazowieckie' })
    expect(screen.queryByRole('combobox', { name: 'Region/state' })).toBeNull()
    expect(screen.getByPlaceholderText('Region/state')).toHaveValue('Mazowieckie')
  })

  it('gives a US-market merchant a text field for a Canadian address', () => {
    render({ country: 'CA', region: 'Ontario' }, { profile: US_DISPLAY_TEMPLATE })
    expect(screen.queryByRole('combobox', { name: 'Region/state' })).toBeNull()
    expect(screen.getByPlaceholderText('Region/state')).toHaveValue('Ontario')
    expect(screen.queryByText(WARNING)).toBeNull()
  })

  it('preselects the state a legacy full name denotes, without warning and without rewriting it', () => {
    const { onChange } = render({ country: 'US', region: 'Texas' })
    expect(screen.getByRole('combobox', { name: 'Region/state' })).toHaveTextContent('Texas')
    expect(screen.queryByText(WARNING)).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('preselects a lowercase legacy name and a plain code alike', () => {
    const { unmount } = render({ country: 'US', region: 'texas' })
    expect(screen.getByRole('combobox', { name: 'Region/state' })).toHaveTextContent('Texas')
    unmount()

    render({ country: 'US', region: 'TX' })
    expect(screen.getByRole('combobox', { name: 'Region/state' })).toHaveTextContent('Texas')
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
    render({ country: 'PL', region: 'TX' })
    expect(screen.getByPlaceholderText('Region/state')).toHaveValue('TX')
  })
})
