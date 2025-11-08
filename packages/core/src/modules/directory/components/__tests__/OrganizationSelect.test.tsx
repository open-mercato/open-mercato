/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { OrganizationSelect } from '../OrganizationSelect'
import { renderWithProviders } from '../../../../../../../tests/helpers/renderWithProviders'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
}))

const dict = {
  'organizationSelect.error': 'Failed to load organizations',
  'organizationSelect.loading': 'Loading…',
  'organizationSelect.all': 'All organizations',
  'organizationSelect.empty': 'No organization',
  'organizationSelect.inactive': 'inactive',
}

const nodes = [
  { id: 'org-1', name: 'Org 1', children: [{ id: 'org-1a', name: 'Org 1 / A' }] },
]

describe('OrganizationSelect', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('renders provided nodes without fetching', () => {
    renderWithProviders(
      <OrganizationSelect value="org-1" fetchOnMount={false} nodes={nodes} includeAllOption />,
      { dict },
    )

    expect(screen.getByRole('option', { name: 'All organizations' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Org 1' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '↳ Org 1 / A' })).toBeInTheDocument()
  })

  it('fetches nodes on mount when not provided', async () => {
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ items: nodes })
    renderWithProviders(<OrganizationSelect value="" />, { dict })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Org 1' })).toBeInTheDocument()
    })
  })

  it('shows an error placeholder when fetch fails', async () => {
    ;(readApiResultOrThrow as jest.Mock).mockRejectedValueOnce(new Error('boom'))
    renderWithProviders(<OrganizationSelect value="" />, { dict })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Failed to load organizations' })).toBeDisabled()
    })
  })

  it('propagates change events with normalized values', () => {
    const handleChange = jest.fn()
    renderWithProviders(
      <OrganizationSelect value="" nodes={nodes} fetchOnMount={false} onChange={handleChange} />,
      { dict },
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'org-1' } })
    expect(handleChange).toHaveBeenCalledWith('org-1')
  })
})
