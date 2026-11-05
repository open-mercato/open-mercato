/** @jest-environment node */

// Direct unit coverage for the shared existence-oracle guard (#5504): pins both
// branches in one place — allow → null (the caller may read), deny → a 404
// not-found response carrying the caller-supplied message so the denial is
// byte-identical to the route's own record-not-found.

const mockIsOrganizationReadAccessAllowed = jest.fn()

jest.mock('@open-mercato/core/modules/directory/utils/organizationScopeGuard', () => ({
  isOrganizationReadAccessAllowed: jest.fn((...args: unknown[]) => mockIsOrganizationReadAccessAllowed(...args)),
}))

import { denyCustomerDetailReadAsNotFound } from '../detailReadAccess'
import type { OrganizationReadAccessInput } from '@open-mercato/core/modules/directory/utils/organizationScopeGuard'

const input = {
  scope: null,
  auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' },
  organizationId: 'org-foreign',
} as unknown as OrganizationReadAccessInput

describe('denyCustomerDetailReadAsNotFound (#5504)', () => {
  beforeEach(() => {
    mockIsOrganizationReadAccessAllowed.mockReset()
  })

  it('returns null (allows the read) when organization read access is allowed', () => {
    mockIsOrganizationReadAccessAllowed.mockReturnValue(true)
    expect(denyCustomerDetailReadAsNotFound(input, 'Person not found')).toBeNull()
  })

  it('returns a 404 not-found response when organization read access is denied', async () => {
    mockIsOrganizationReadAccessAllowed.mockReturnValue(false)
    const response = denyCustomerDetailReadAsNotFound(input, 'Person not found')
    expect(response).not.toBeNull()
    expect(response!.status).toBe(404)
    expect(await response!.json()).toEqual({ error: 'Person not found' })
  })

  it('carries the caller-supplied message so it matches the route’s own not-found body', async () => {
    mockIsOrganizationReadAccessAllowed.mockReturnValue(false)
    const response = denyCustomerDetailReadAsNotFound(input, 'Deal not found')
    expect(await response!.json()).toEqual({ error: 'Deal not found' })
  })
})
