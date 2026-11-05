/** @jest-environment node */

import { resolveIntegrationsOrganizationId } from '../organization-scope'

const accountOrgId = '22222222-2222-4222-8222-222222222222'
const selectedOrgId = '33333333-3333-4333-8333-333333333333'

describe('integrations organization scope', () => {
  it('uses the selected organization when one is set', () => {
    expect(
      resolveIntegrationsOrganizationId({ orgId: selectedOrgId, actorOrgId: accountOrgId }),
    ).toBe(selectedOrgId)
  })

  // `orgId: null` + `actorOrgId` set is exactly the shape `applySuperAdminScope` produces for an
  // all-organizations selection. Answering 401 for it sent `apiFetch` into a refresh loop.
  it('falls back to the actor organization for an all-organizations selection', () => {
    expect(
      resolveIntegrationsOrganizationId({ orgId: null, actorOrgId: accountOrgId }),
    ).toBe(accountOrgId)
  })

  // The shared resolver behind this deprecated alias is tenant-aware: a super-admin who
  // switched to another tenant with "all organizations" selected must not scope to the
  // actor organization of their own tenant.
  it('refuses the fallback when the effective tenant is not the actor tenant', () => {
    expect(
      resolveIntegrationsOrganizationId({
        orgId: null,
        actorOrgId: accountOrgId,
        tenantId: '55555555-5555-4555-8555-555555555555',
        actorTenantId: '44444444-4444-4444-8444-444444444444',
      }),
    ).toBeNull()
  })

  it('returns null when the caller has no organization at all', () => {
    expect(resolveIntegrationsOrganizationId({ orgId: null })).toBeNull()
    expect(resolveIntegrationsOrganizationId({ orgId: null, actorOrgId: null })).toBeNull()
    expect(resolveIntegrationsOrganizationId(null)).toBeNull()
  })

  it('ignores blank and non-string values rather than scoping to them', () => {
    expect(resolveIntegrationsOrganizationId({ orgId: '   ', actorOrgId: accountOrgId })).toBe(accountOrgId)
    expect(resolveIntegrationsOrganizationId({ orgId: null, actorOrgId: '  ' })).toBeNull()
    expect(resolveIntegrationsOrganizationId({ orgId: null, actorOrgId: 42 })).toBeNull()
  })
})
