/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AddressEditor, type AddressEditorDraft } from '../AddressEditor'

// The two contact inputs, which no other suite reaches: every section that renders this editor mocks
// it, so without this file the tax id and the phone have no coverage at any level.

const t = (_key: string, fallback?: string) => fallback ?? ''

const draft = (over: Partial<AddressEditorDraft> = {}): AddressEditorDraft =>
  ({
    name: '', purpose: '', companyName: '', addressLine1: 'Baker Street 10', addressLine2: '',
    buildingNumber: '', flatNumber: '', city: 'London', region: '', postalCode: 'NW1',
    country: 'GB', taxId: '', phone: '', isPrimary: false, ...over,
  }) as AddressEditorDraft

function render(props: Record<string, unknown> = {}) {
  return renderWithProviders(
    <AddressEditor value={draft(props.value as Partial<AddressEditorDraft>)} format="street_first" t={t} onChange={() => {}} {...props} />,
  )
}

describe('AddressEditor — the contact fields are the caller\'s to offer', () => {
  it('offers the phone without the tax id, and the other way round', () => {
    // Not symmetry for its own sake: a phone is a contact detail and a tax identifier is not, and the
    // two part company at Phase 3 — `CustomerAddress` gains a `phone` column and no tax id, so the
    // address book will offer one without the other.
    const { unmount } = render({ showPhoneField: true })
    expect(screen.getByPlaceholderText('Phone')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Tax number')).toBeNull()
    unmount()

    render({ showTaxIdField: true })
    expect(screen.getByPlaceholderText('Tax number')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Phone')).toBeNull()
  })

  it('renders neither field by default', () => {
    // The address book is the caller this protects: `CustomerAddress` has no column for either, so
    // an input there takes a value and drops it on save with nothing to show the user.
    render()
    expect(screen.queryByPlaceholderText('Tax number')).toBeNull()
    expect(screen.queryByPlaceholderText('Phone')).toBeNull()
  })

  it('renders both when the caller opts in, empty and enabled like their neighbours', () => {
    render({ showPhoneField: true, showTaxIdField: true })
    expect(screen.getByPlaceholderText('Tax number')).toHaveValue('')
    expect(screen.getByPlaceholderText('Phone')).toHaveValue('')
    expect(screen.getByPlaceholderText('Tax number')).not.toBeDisabled()
  })

  it('disables them with the rest of the form, never on their own', () => {
    // The rule review settled on: whether an address can be edited is a property of the address.
    render({ showPhoneField: true, showTaxIdField: true, disabled: true })
    expect(screen.getByPlaceholderText('Tax number')).toBeDisabled()
    expect(screen.getByPlaceholderText('Phone')).toBeDisabled()
  })

  it('offers the scheme as a choice, and names the filled value by it', () => {
    // Picked rather than inferred: `PL1234567890` and `1234567890` are the same business written two
    // ways, so reading the scheme off the form of the value is guessing — and it guesses more often
    // as the vocabulary grows.
    //
    // The COUNT is the assertion. The name appears twice — once as the picker's selected option, once
    // as the marker at the filled field's right edge — and asserting mere presence passes on the
    // picker alone, which is how a missing marker survived a green suite before.
    render({ value: { taxId: 'PL1234567890', taxIdType: 'eu_vat' }, showPhoneField: true, showTaxIdField: true })
    expect(screen.getAllByText('EU VAT')).toHaveLength(2)
  })

  it('names a filled value neutrally when no scheme is picked, rather than guessing one', () => {
    // Only the marker here: the picker shows its placeholder, not an option, so the neutral name
    // appears exactly once.
    render({ value: { taxId: '1234567890' }, showPhoneField: true, showTaxIdField: true })
    expect(screen.getAllByText('Tax number')).toHaveLength(1)
    expect(screen.queryByText('EU VAT')).toBeNull()
  })

  it('shows no marker at all while the field is empty', () => {
    render({ value: { taxIdType: 'eu_vat' }, showPhoneField: true, showTaxIdField: true })
    expect(screen.getAllByText('EU VAT')).toHaveLength(1)
  })

  it('names a filled phone by itself', () => {
    // A placeholder is this form's only label and it vanishes on typing; the marker keeps a filled
    // phone readable where the postcode directly above looks just like it.
    render({ value: { phone: '+48 600 100 200' }, showPhoneField: true, showTaxIdField: true })
    expect(screen.getByText('Phone')).toBeInTheDocument()
  })
})
