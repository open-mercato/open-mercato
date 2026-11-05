/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { TenantSelect } from '../TenantSelect'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
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

  it('requests only one page when the first page is not full', async () => {
    const capturedUrls: string[] = []
    ;(readApiResultOrThrow as jest.Mock).mockImplementation(async (url: string) => {
      capturedUrls.push(url)
      return { items: [{ id: 't-100', name: 'Tenant A', isActive: true }], totalPages: 1 }
    })

    renderWithProviders(<TenantSelect />, { dict })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Tenant A' })).toBeInTheDocument()
    })

    expect(capturedUrls).toHaveLength(1)
    expect(capturedUrls[0]).toContain('page=1')
    expect(capturedUrls[0]).toContain('pageSize=100')
  })

  it('pages through every tenant when more than one page exists', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `t-${String(index).padStart(3, '0')}`,
      name: `Tenant ${String(index).padStart(3, '0')}`,
      isActive: true,
    }))
    const secondPage = [{ id: 't-extra', name: 'Tenant Beyond First Page', isActive: true }]
    const capturedUrls: string[] = []
    ;(readApiResultOrThrow as jest.Mock).mockImplementation(async (url: string) => {
      capturedUrls.push(url)
      if (url.includes('page=2')) {
        return { items: secondPage, totalPages: 2 }
      }
      return { items: firstPage, totalPages: 2 }
    })

    renderWithProviders(<TenantSelect includeEmptyOption />, { dict })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Tenant Beyond First Page' })).toBeInTheDocument()
    })

    expect(capturedUrls.some((url) => url.includes('page=1'))).toBe(true)
    expect(capturedUrls.some((url) => url.includes('page=2'))).toBe(true)
    expect(screen.getByRole('option', { name: 'Tenant 000' })).toBeInTheDocument()
  })

  it('auto-selects first tenant when value is null and includeEmptyOption is false', async () => {
    const onChange = jest.fn()
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({
      items: [
        { id: 't-first', name: 'First Tenant', isActive: true },
        { id: 't-second', name: 'Second Tenant', isActive: true },
      ],
    })

    renderWithProviders(<TenantSelect value={null} onChange={onChange} />, { dict })

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('t-first')
    })
  })

  it('does not auto-select when value is already set', async () => {
    const onChange = jest.fn()
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({
      items: [
        { id: 't-first', name: 'First Tenant', isActive: true },
        { id: 't-second', name: 'Second Tenant', isActive: true },
      ],
    })

    renderWithProviders(<TenantSelect value="t-second" onChange={onChange} />, { dict })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'First Tenant' })).toBeInTheDocument()
    })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('auto-selects first tenant from fallback endpoint', async () => {
    const onChange = jest.fn()
    ;(readApiResultOrThrow as jest.Mock)
      .mockRejectedValueOnce(new Error('directory down'))
      .mockResolvedValueOnce({
        tenants: [{ id: 't-fallback', name: 'Fallback Tenant', isActive: true }],
      })

    renderWithProviders(<TenantSelect value={null} onChange={onChange} />, { dict })

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('t-fallback')
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
