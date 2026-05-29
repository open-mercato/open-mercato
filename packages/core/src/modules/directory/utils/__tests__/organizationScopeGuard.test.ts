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

  it('denies a restricted floating user when the derived allowed set is empty (fail closed)', () => {
    expect(
      isOrganizationReadAccessAllowed({
        scope: buildScope({ allowedIds: ['org-a'], filterIds: [] }),
        auth: buildAuth({ orgId: null }),
        organizationId: 'org-b',
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

  it('falls back to the home org when no filter ids are present', () => {
    expect(
      isOrganizationReadAccessAllowed({
        scope: buildScope({ allowedIds: ['org-a'], filterIds: null }),
        auth: buildAuth({ orgId: 'org-a' }),
        organizationId: 'org-a',
      }),
    ).toBe(true)
  })
})
