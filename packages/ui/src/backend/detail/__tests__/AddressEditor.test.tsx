/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AddressEditor, type AddressEditorDraft } from '../AddressEditor'

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/staff/team-members/member-1',
  useSearchParams: () => new URLSearchParams(),
}))

const draft: AddressEditorDraft = {
  name: '',
  purpose: '',
  companyName: '',
  addressLine1: '',
  addressLine2: '',
  buildingNumber: '',
  flatNumber: '',
  city: '',
  region: '',
  postalCode: '',
  country: '',
  latitude: '',
  longitude: '',
  isPrimary: false,
}

const t = (_key: string, fallback?: string) => fallback ?? _key

describe('AddressEditor', () => {
  it('names the icon-only control that creates an address type', async () => {
    renderWithProviders(
      <AddressEditor
        value={draft}
        onChange={jest.fn()}
        format="street_first"
        t={t}
        addressTypesAdapter={{ list: async () => [], create: async () => null }}
      />,
    )

    expect(await screen.findByRole('button', { name: 'Add address type' })).toHaveAttribute(
      'title',
      'Add address type',
    )
  })
})
