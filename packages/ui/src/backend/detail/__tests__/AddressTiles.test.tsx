/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AddressTiles } from '../AddressTiles'

jest.mock('@open-mercato/ui/backend/detail', () => ({
  TabEmptyState: () => null,
}))

describe('AddressTiles', () => {
  const t = (_key: string, fallback?: string) => fallback ?? _key

  it('identifies each icon-only address action', async () => {
    renderWithProviders(
      <AddressTiles
        addresses={[
          {
            id: 'address-1',
            name: 'Warehouse',
            addressLine1: '1 Market Street',
          },
        ]}
        onCreate={jest.fn()}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
        t={t}
        emptyLabel="No addresses"
      />,
    )

    const editButton = await screen.findByRole('button', { name: 'Edit address — Warehouse' })
    expect(editButton).toHaveAttribute('title', 'Edit address — Warehouse')

    const deleteButton = screen.getByRole('button', { name: 'Delete address — Warehouse' })
    expect(deleteButton).toHaveAttribute('title', 'Delete address — Warehouse')

    fireEvent.click(editButton)

    const closeButton = await screen.findByRole('button', { name: 'Close address form' })
    expect(closeButton).toHaveAttribute('title', 'Close address form')
  })
})
