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
