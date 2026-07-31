/** @jest-environment node */

import { resolveActiveOrganizationId } from '../organizationScope'

const accountOrgId = '22222222-2222-4222-8222-222222222222'
const selectedOrgId = '33333333-3333-4333-8333-333333333333'

describe('resolveActiveOrganizationId', () => {
  it('uses the selected organization when one is set', () => {
    expect(
      resolveActiveOrganizationId({ orgId: selectedOrgId, actorOrgId: accountOrgId }),
    ).toBe(selectedOrgId)
  })

  // `orgId: null` + `actorOrgId` set is exactly the shape `applySuperAdminScope` produces for an
  // all-organizations selection. Answering 401 for it sent `apiFetch` into a refresh loop.
  it('falls back to the actor organization for an all-organizations selection', () => {
    expect(
      resolveActiveOrganizationId({ orgId: null, actorOrgId: accountOrgId }),
    ).toBe(accountOrgId)
  })

  it('returns null when the caller has no organization at all', () => {
    expect(resolveActiveOrganizationId({ orgId: null })).toBeNull()
    expect(resolveActiveOrganizationId({ orgId: null, actorOrgId: null })).toBeNull()
    expect(resolveActiveOrganizationId(null)).toBeNull()
  })

  it('ignores blank and non-string values rather than scoping to them', () => {
    expect(resolveActiveOrganizationId({ orgId: '   ', actorOrgId: accountOrgId })).toBe(accountOrgId)
    expect(resolveActiveOrganizationId({ orgId: null, actorOrgId: '  ' })).toBeNull()
    expect(resolveActiveOrganizationId({ orgId: null, actorOrgId: 42 })).toBeNull()
  })
})
