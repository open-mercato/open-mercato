/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { TenantSelect } from '../TenantSelect'
import { renderWithProviders } from '../../../../../../../tests/helpers/renderWithProviders'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
}))

const dict = {
  'tenantSelect.empty': 'Select tenant',
  'tenantSelect.loading': 'Loading tenants…',
  'tenantSelect.error': 'Failed to load tenants',
  'tenantSelect.inactive': 'inactive',
}

describe('TenantSelect', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('renders provided tenants when fetch is disabled', () => {
    const tenants = [{ id: 't-1', name: 'Tenant One', isActive: true }]
    renderWithProviders(
      <TenantSelect fetchOnMount={false} includeEmptyOption tenants={tenants} />,
      { dict },
    )
    expect(screen.getByRole('option', { name: 'Select tenant' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Tenant One' })).toBeInTheDocument()
  })

  it('loads tenants from the API', async () => {
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({
      items: [{ id: 't-2', name: 'Tenant Two', isActive: true }],
    })

    renderWithProviders(<TenantSelect />, { dict })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Tenant Two' })).toBeInTheDocument()
    })
  })

  it('falls back to organization switcher tenants on primary failure', async () => {
    ;(readApiResultOrThrow as jest.Mock)
      .mockRejectedValueOnce(new Error('directory down'))
      .mockResolvedValueOnce({
        tenants: [{ id: 't-3', name: 'Tenant Three', isActive: false }],
      })

    renderWithProviders(<TenantSelect />, { dict })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Tenant Three \(inactive\)/ })).toBeInTheDocument()
    })
  })

  it('shows an error option when both fetch attempts fail', async () => {
    ;(readApiResultOrThrow as jest.Mock)
      .mockRejectedValueOnce(new Error('directory down'))
      .mockRejectedValueOnce(new Error('switcher down'))

    renderWithProviders(<TenantSelect />, { dict })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Failed to load tenants' })).toBeDisabled()
    })
  })
})
