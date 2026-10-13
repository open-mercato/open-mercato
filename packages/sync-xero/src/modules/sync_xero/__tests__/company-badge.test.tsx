/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import enDict from '../i18n/en.json'

const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

import XeroCompanyBadgeWidget from '../widgets/injection/company-badge/widget.client'
import widget from '../widgets/injection/company-badge/widget'
import { injectionTable } from '../widgets/injection-table'

const COMPANY_ID = '44444444-4444-4444-8444-444444444444'
const URL = 'https://go.xero.com/Contacts/View/c0000000-0000-4000-8000-000000000001'

function render(companyId: string | null = COMPANY_ID) {
  return renderWithProviders(<XeroCompanyBadgeWidget context={{ companyId }} />, { dict: enDict })
}

beforeEach(() => {
  mockApiCall.mockReset()
})

describe('Xero Company badge', () => {
  it('is injected into the Company status badges for customers.companies.view', () => {
    expect(injectionTable['detail:customers.company:status-badges']).toEqual([{ widgetId: 'sync_xero.injection.company-badge', priority: 100 }])
    expect(widget.metadata).toMatchObject({ id: 'sync_xero.injection.company-badge', features: ['customers.companies.view'] })
  })

  it('shows the link date and opens the Contact in Xero in a new tab', async () => {
    mockApiCall.mockResolvedValue({ ok: true, status: 200, result: { link: { externalUrl: URL, linkedSince: '2026-10-13T09:30:00.000Z' } } })
    render()

    const link = await screen.findByRole('link', { name: 'Open the contact in Xero' })
    expect(link.getAttribute('href')).toBe(URL)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByText(/^Xero · linked since /)).toBeTruthy()
    expect(mockApiCall).toHaveBeenCalledWith(`/api/sync_xero/companies/${COMPANY_ID}`, undefined, { fallback: null })
  })

  it('says only "linked" when the link has no date', async () => {
    mockApiCall.mockResolvedValue({ ok: true, status: 200, result: { link: { externalUrl: URL, linkedSince: null } } })
    render()
    expect(await screen.findByText('Xero · linked')).toBeTruthy()
  })

  it('renders nothing without a link, on an error, or without a Company id', async () => {
    mockApiCall.mockResolvedValue({ ok: true, status: 200, result: { link: null } })
    const { container, unmount } = render()
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1))
    expect(container.innerHTML).toBe('')
    unmount()

    mockApiCall.mockResolvedValue({ ok: false, status: 404, result: null })
    const failed = render()
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(2))
    expect(failed.container.innerHTML).toBe('')
    failed.unmount()

    mockApiCall.mockRejectedValue(new Error('network'))
    const rejected = render()
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(3))
    expect(rejected.container.innerHTML).toBe('')
    rejected.unmount()

    const noCompany = render(null)
    expect(noCompany.container.innerHTML).toBe('')
    expect(mockApiCall).toHaveBeenCalledTimes(3)
  })
})
