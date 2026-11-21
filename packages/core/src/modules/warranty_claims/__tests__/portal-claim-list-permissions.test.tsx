/** @jest-environment jsdom */
import * as React from 'react'
import { waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const mockApiCall = jest.fn()
const mockPortalAuth = {
  auth: { user: { id: 'customer-user' }, loading: false, resolvedFeatures: [] as string[] },
}

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))
jest.mock('@open-mercato/ui/portal/PortalContext', () => ({
  usePortalContext: () => mockPortalAuth,
}))
jest.mock('@open-mercato/ui', () => ({
  DataTable: ({ data, isLoading, emptyState }: { data: unknown[]; isLoading: boolean; emptyState: React.ReactNode }) => (
    <div>{isLoading ? 'Loading claims' : data.length ? 'Existing claim' : emptyState}</div>
  ),
}), { virtual: true })

import enDict from '../i18n/en.json'
import WarrantyClaimsPortalListPage from '../frontend/[orgSlug]/portal/claims/page'

describe('portal claim list create controls', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it.each([
    { grants: ['portal.warranty_claims.view'], canCreate: false },
    { grants: ['portal.warranty_claims.view', 'portal.warranty_claims.manage'], canCreate: true },
    { grants: ['portal.warranty_claims.*'], canCreate: true },
    { grants: ['portal.*'], canCreate: true },
    { grants: ['*'], canCreate: true },
  ])('matches create controls to $grants for empty and populated lists', async ({ grants, canCreate }) => {
    mockPortalAuth.auth.resolvedFeatures = grants
    const items: Array<{ id: string }> = []
    mockApiCall.mockImplementation(async () => ({
      ok: true,
      result: { items, total: items.length, totalPages: 1, page: 1, pageSize: 20 },
    }))
    const view = renderWithProviders(
      <WarrantyClaimsPortalListPage params={{ orgSlug: 'acme' }} />,
      { dict: enDict },
    )
    await waitFor(() => expect(view.queryByText('Loading claims')).toBeNull())
    expect(view.queryAllByRole('link', { name: enDict['warranty_claims.portal.newClaim'] })).toHaveLength(canCreate ? 2 : 0)
    for (const link of view.queryAllByRole('link', { name: enDict['warranty_claims.portal.newClaim'] })) {
      expect(link.getAttribute('href')).toBe('/acme/portal/claims/new')
    }
    items.push({ id: 'claim' })
    view.unmount()
    const populatedView = renderWithProviders(
      <WarrantyClaimsPortalListPage params={{ orgSlug: 'acme' }} />,
      { dict: enDict },
    )
    await waitFor(() => expect(populatedView.queryByText('Existing claim')).not.toBeNull())
    expect(populatedView.queryAllByRole('link', { name: enDict['warranty_claims.portal.newClaim'] })).toHaveLength(canCreate ? 1 : 0)
  })
})
