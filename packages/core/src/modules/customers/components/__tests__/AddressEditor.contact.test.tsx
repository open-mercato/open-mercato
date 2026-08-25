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
  it('renders neither field by default', () => {
    // The address book is the caller this protects: `CustomerAddress` has no column for either, so
    // an input there takes a value and drops it on save with nothing to show the user.
    render()
    expect(screen.queryByPlaceholderText('Tax number')).toBeNull()
    expect(screen.queryByPlaceholderText('Phone')).toBeNull()
  })

  it('renders both when the caller opts in, empty and enabled like their neighbours', () => {
    render({ showContactFields: true })
    expect(screen.getByPlaceholderText('Tax number')).toHaveValue('')
    expect(screen.getByPlaceholderText('Phone')).toHaveValue('')
    expect(screen.getByPlaceholderText('Tax number')).not.toBeDisabled()
  })

  it('disables them with the rest of the form, never on their own', () => {
    // The rule review settled on: whether an address can be edited is a property of the address.
    render({ showContactFields: true, disabled: true })
    expect(screen.getByPlaceholderText('Tax number')).toBeDisabled()
    expect(screen.getByPlaceholderText('Phone')).toBeDisabled()
  })

  it('offers the scheme as a choice, showing the one the address already carries', () => {
    // Picked rather than inferred: `PL1234567890` and `1234567890` are the same business written two
    // ways, so reading the scheme off the form of the value is guessing — and it guesses more often
    // as the vocabulary grows.
    render({ value: { taxId: 'PL1234567890', taxIdType: 'eu_vat' }, showContactFields: true })
    expect(screen.getByText('EU VAT')).toBeInTheDocument()
  })

  it('leaves the scheme unset when the address has none, rather than picking one', () => {
    render({ value: { taxId: '1234567890' }, showContactFields: true })
    expect(screen.queryByText('EU VAT')).toBeNull()
    expect(screen.queryByText('Tax ID')).toBeNull()
  })

  it('names a filled phone by itself', () => {
    // A placeholder is this form's only label and it vanishes on typing; the marker keeps a filled
    // phone readable where the postcode directly above looks just like it.
    render({ value: { phone: '+48 600 100 200' }, showContactFields: true })
    expect(screen.getByText('Phone')).toBeInTheDocument()
  })
})
