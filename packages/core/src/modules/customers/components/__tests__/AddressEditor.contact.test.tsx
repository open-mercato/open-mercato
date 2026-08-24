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

describe('AddressEditor — each contact field is the caller\'s to offer, separately', () => {
  it('renders neither field by default', () => {
    // The address book is the caller this protects: `CustomerAddress` has no column for either, so
    // an input there takes a value and drops it on save with nothing to show the user.
    render()
    expect(screen.queryByPlaceholderText('Tax number')).toBeNull()
    expect(screen.queryByPlaceholderText('Phone')).toBeNull()
  })

  it('offers the phone WITHOUT the tax id — the delivery address case', () => {
    // The asymmetry this pair of flags exists for. A phone belongs to any address a parcel goes to;
    // a tax id belongs to the address a document was issued under, and a delivery address is not one.
    // No platform in the spec's market table puts a tax id on a shipping address.
    render({ showPhoneField: true })
    expect(screen.getByPlaceholderText('Phone')).toHaveValue('')
    expect(screen.queryByPlaceholderText('Tax number')).toBeNull()
  })

  it('offers both when the address is the one being invoiced', () => {
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

  it('names a filled tax id by its type, and a filled phone by itself', () => {
    // A placeholder is this form's only label and it vanishes on typing; the marker is what keeps a
    // filled field readable, and for the tax id it has to follow the type — `PL…` is not a NIP.
    render({ value: { taxId: 'PL1234567890', phone: '+48 600 100 200' }, showPhoneField: true, showTaxIdField: true, taxIdType: 'eu_vat' })
    expect(screen.getByText('EU VAT')).toBeInTheDocument()
    expect(screen.getByText('Phone')).toBeInTheDocument()
  })

  it('shows no marker while a field is empty, so nothing labels an absent value', () => {
    render({ showPhoneField: true, showTaxIdField: true, taxIdType: 'eu_vat' })
    expect(screen.queryByText('EU VAT')).toBeNull()
  })
})
