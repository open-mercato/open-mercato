/** @jest-environment node */

const getAuthFromCookies = jest.fn()
const createRequestContainer = jest.fn()
const findOrganizationInTenant = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromCookies: (...args: unknown[]) => getAuthFromCookies(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainer(...args),
}))

jest.mock('../organizationLookup', () => ({
  findOrganizationInTenant: (...args: unknown[]) => findOrganizationInTenant(...args),
}))

import { resolveCurrentOrgPortalSlug } from '../portalOrgSlug'

const em = { marker: 'entity-manager' }

function containerResolving(name: string, value: unknown) {
  return { resolve: jest.fn((requested: string) => (requested === name ? value : null)) }
}

describe('resolveCurrentOrgPortalSlug (regression for issue #5668)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    createRequestContainer.mockResolvedValue(containerResolving('em', em))
  })

  it('returns the slug of the organization the session is scoped to', async () => {
    getAuthFromCookies.mockResolvedValue({ orgId: 'org-1', tenantId: 'tenant-1' })
    findOrganizationInTenant.mockResolvedValue({ slug: 'acme' })

    await expect(resolveCurrentOrgPortalSlug()).resolves.toBe('acme')
    // The (id, tenant_id) pair MUST travel together so the lookup cannot cross tenants.
    expect(findOrganizationInTenant).toHaveBeenCalledWith(em, 'org-1', 'tenant-1')
  })

  it('trims surrounding whitespace off the stored slug', async () => {
    getAuthFromCookies.mockResolvedValue({ orgId: 'org-1', tenantId: 'tenant-1' })
    findOrganizationInTenant.mockResolvedValue({ slug: '  acme  ' })

    await expect(resolveCurrentOrgPortalSlug()).resolves.toBe('acme')
  })

  it.each([
    ['there is no session', null],
    ['the session has no active organization', { orgId: null, tenantId: 'tenant-1' }],
    ['the session has no tenant', { orgId: 'org-1', tenantId: null }],
  ])('returns null when %s', async (_case, auth) => {
    getAuthFromCookies.mockResolvedValue(auth)

    await expect(resolveCurrentOrgPortalSlug()).resolves.toBeNull()
    expect(findOrganizationInTenant).not.toHaveBeenCalled()
  })

  it.each([
    ['the organization is missing', null],
    ['the organization has no slug', { slug: null }],
    ['the stored slug is blank', { slug: '   ' }],
  ])('returns null when %s', async (_case, organization) => {
    getAuthFromCookies.mockResolvedValue({ orgId: 'org-1', tenantId: 'tenant-1' })
    findOrganizationInTenant.mockResolvedValue(organization)

    await expect(resolveCurrentOrgPortalSlug()).resolves.toBeNull()
  })

  it('degrades to null instead of throwing when the lookup fails', async () => {
    getAuthFromCookies.mockResolvedValue({ orgId: 'org-1', tenantId: 'tenant-1' })
    findOrganizationInTenant.mockRejectedValue(new Error('[internal] database unavailable'))

    await expect(resolveCurrentOrgPortalSlug()).resolves.toBeNull()
  })
})
