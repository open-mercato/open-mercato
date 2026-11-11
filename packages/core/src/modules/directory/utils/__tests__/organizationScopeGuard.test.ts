import { isOrganizationReadAccessAllowed } from '@open-mercato/core/modules/directory/utils/organizationScopeGuard'
import type { OrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

function buildScope(overrides: Partial<OrganizationScope>): OrganizationScope {
  return {
    selectedId: null,
    filterIds: null,
    allowedIds: null,
    tenantId: 'tenant-1',
    ...overrides,
  }
}

function buildAuth(overrides: Partial<NonNullable<AuthContext>>): AuthContext {
  return {
    sub: 'user-1',
    tenantId: 'tenant-1',
    orgId: null,
    ...overrides,
  }
}

describe('isOrganizationReadAccessAllowed', () => {
  it('allows super admins', () => {
    expect(
      isOrganizationReadAccessAllowed({
        scope: buildScope({ allowedIds: ['org-a'], filterIds: ['org-a'] }),
        auth: buildAuth({ isSuperAdmin: true }),
        organizationId: 'org-b',
      }),
    ).toBe(true)
  })

  it('allows unrestricted scope (allowedIds === null)', () => {
    expect(
      isOrganizationReadAccessAllowed({
        scope: buildScope({ allowedIds: null, filterIds: null }),
        auth: buildAuth({}),
        organizationId: 'org-b',
      }),
    ).toBe(true)
  })

  it('denies an empty restricted scope even when auth has a home organization', () => {
    expect(
      isOrganizationReadAccessAllowed({
        scope: buildScope({ allowedIds: [], filterIds: [] }),
        auth: buildAuth({ orgId: 'org-a' }),
        organizationId: 'org-a',
      }),
    ).toBe(false)
  })

  it('denies a record outside the filtered view', () => {
    expect(
      isOrganizationReadAccessAllowed({
        scope: buildScope({ allowedIds: ['org-a', 'org-b'], filterIds: ['org-a'] }),
        auth: buildAuth({}),
        organizationId: 'org-b',
      }),
    ).toBe(false)
  })

  it('allows a record inside the filtered view (allow-path regression)', () => {
    expect(
      isOrganizationReadAccessAllowed({
        scope: buildScope({ allowedIds: ['org-a'], filterIds: ['org-a'] }),
        auth: buildAuth({}),
        organizationId: 'org-a',
      }),
    ).toBe(true)
  })

  it('uses allowedIds instead of auth.orgId when a resolved restricted scope has no filter ids', () => {
    expect(
      isOrganizationReadAccessAllowed({
        scope: buildScope({ allowedIds: ['org-a'], filterIds: null }),
        auth: buildAuth({ orgId: 'org-b' }),
        organizationId: 'org-a',
      }),
    ).toBe(true)
  })

  it('preserves the auth.orgId fallback only when the resolved scope is absent', () => {
    expect(
      isOrganizationReadAccessAllowed({
        scope: null,
        auth: buildAuth({ orgId: 'org-a' }),
        organizationId: 'org-a',
      }),
    ).toBe(true)
  })
})
