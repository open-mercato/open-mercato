/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
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
  'customers.people.detail.addresses.editAction': 'Edit address',
  'customers.people.detail.addresses.deleteAction': 'Delete address',
  'customers.people.detail.address': 'Address',
}

const t = (key: string, fallback?: string) => translations[key] ?? fallback ?? key

describe('CustomerAddressTiles action accessibility', () => {
  test('identifies address actions by their formatted address', async () => {
    renderWithProviders(
      <CustomerAddressTiles
        addresses={[
          { id: 'address-1', addressLine1: '1 Main Street' },
          { id: 'address-2', addressLine1: '2 Market Street' },
        ]}
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

    expect(screen.getByRole('button', { name: 'Edit address — 1 Main Street' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete address — 2 Market Street' })).toBeInTheDocument()
  })
})
