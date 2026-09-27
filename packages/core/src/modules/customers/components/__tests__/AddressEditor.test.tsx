/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AddressEditor, type AddressEditorDraft } from '../AddressEditor'

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/customers/people/person-1',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('../detail/hooks/useAddressTypes', () => ({
  useAddressTypes: () => ({
    options: [],
    loading: false,
    error: null,
    createType: jest.fn(),
  }),
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
  test('names the icon-only control that creates an address type', () => {
    renderWithProviders(
      <AddressEditor
        value={draft}
        onChange={jest.fn()}
        format="street_first"
        t={t}
      />,
    )

    expect(screen.getByRole('button', { name: 'Add address type' })).toHaveAttribute(
      'title',
      'Add address type',
    )
  })
})
