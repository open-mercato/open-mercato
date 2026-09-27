/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CustomerAddressTiles } from '../AddressTiles'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, result: { addressFormat: 'line_first' } })),
}))

jest.mock('../detail/hooks/useAddressTypes', () => ({
  useAddressTypes: () => ({ map: new Map() }),
}))

jest.mock('../AddressEditor', () => ({
  __esModule: true,
  default: () => <div>address-editor</div>,
}))

const translations: Record<string, string> = {
  'customers.people.detail.addresses.add': 'Add address',
  'customers.people.detail.addresses.addTitle': 'Add address',
  'customers.people.detail.addresses.cancel': 'Cancel',
  'customers.people.detail.addresses.save': 'Save',
  'customers.people.detail.addresses.editAction': 'Edit address',
  'customers.people.detail.addresses.deleteAction': 'Delete address',
  'customers.people.detail.address': 'Address',
}

const t = (key: string, fallback?: string) => translations[key] ?? fallback ?? key

describe('CustomerAddressTiles', () => {
  test('names the icon-only control that closes the address editor', async () => {
    renderWithProviders(
      <CustomerAddressTiles
        addresses={[{ id: 'address-1', addressLine1: '1 Main Street' }]}
        onCreate={jest.fn()}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
        t={t}
        emptyLabel="No addresses"
      />,
    )

    await waitFor(() => {
      expect(screen.queryByText('Loading address preferences…')).not.toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add address' }))

    const cancelButtons = screen.getAllByRole('button', { name: 'Cancel' })
    expect(cancelButtons).toHaveLength(2)
    expect(cancelButtons[0]).toHaveAttribute('title', 'Cancel')
  })
})
