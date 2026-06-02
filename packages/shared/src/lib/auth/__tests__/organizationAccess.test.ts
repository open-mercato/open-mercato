import { isOrganizationAccessAllowed } from '@open-mercato/shared/lib/auth/organizationAccess'

describe('isOrganizationAccessAllowed', () => {
  it('allows super admins regardless of scope', () => {
    expect(
      isOrganizationAccessAllowed({
        isSuperAdmin: true,
        allowedOrganizationIds: [],
        targetOrganizationId: 'org-b',
      }),
    ).toBe(true)
  })

  it('allows truly unrestricted access (allowedOrganizationIds === null)', () => {
    expect(
      isOrganizationAccessAllowed({
        isSuperAdmin: false,
        allowedOrganizationIds: null,
        targetOrganizationId: 'org-b',
      }),
    ).toBe(true)
  })

  it('denies a restricted principal with an empty allowed set (fail closed)', () => {
    expect(
      isOrganizationAccessAllowed({
        isSuperAdmin: false,
        allowedOrganizationIds: [],
        targetOrganizationId: 'org-b',
      }),
    ).toBe(false)
  })

  it('denies a restricted principal acting on an org outside the allowed set', () => {
    expect(
      isOrganizationAccessAllowed({
        isSuperAdmin: false,
        allowedOrganizationIds: ['org-a'],
        targetOrganizationId: 'org-b',
      }),
    ).toBe(false)
  })

  it('allows a restricted principal acting on an org inside the allowed set', () => {
    expect(
      isOrganizationAccessAllowed({
        isSuperAdmin: false,
        allowedOrganizationIds: ['org-a'],
        targetOrganizationId: 'org-a',
      }),
    ).toBe(true)
  })

  it('denies a restricted principal when the target org is missing', () => {
    expect(
      isOrganizationAccessAllowed({
        isSuperAdmin: false,
        allowedOrganizationIds: ['org-a'],
        targetOrganizationId: null,
      }),
    ).toBe(false)
  })
})
