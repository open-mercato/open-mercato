/** @jest-environment node */

import {
  ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE,
  organizationScopeRequiredResponse,
  resolveActiveOrganizationId,
} from '../organizationScope'

const accountOrgId = '22222222-2222-4222-8222-222222222222'
const selectedOrgId = '33333333-3333-4333-8333-333333333333'
const actorTenantId = '44444444-4444-4444-8444-444444444444'
const foreignTenantId = '55555555-5555-4555-8555-555555555555'

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

  // `actorTenantId` is only present when the super-admin cookie override switched tenants.
  // Selecting the actor's own tenant explicitly keeps the fallback valid.
  it('keeps the fallback when the tenant override selects the actor tenant', () => {
    expect(
      resolveActiveOrganizationId({
        orgId: null,
        actorOrgId: accountOrgId,
        tenantId: actorTenantId,
        actorTenantId,
      }),
    ).toBe(accountOrgId)
  })

  // The reviewed blocker: tenant B + "all organizations" must not pair the actor's
  // tenant-A organization with tenant B. No fallback — the route answers 400 instead.
  it('refuses the fallback when the effective tenant is not the actor tenant', () => {
    expect(
      resolveActiveOrganizationId({
        orgId: null,
        actorOrgId: accountOrgId,
        tenantId: foreignTenantId,
        actorTenantId,
      }),
    ).toBeNull()
  })

  it('refuses the fallback when the tenant override cleared the tenant entirely', () => {
    expect(
      resolveActiveOrganizationId({
        orgId: null,
        actorOrgId: accountOrgId,
        tenantId: null,
        actorTenantId,
      }),
    ).toBeNull()
    expect(
      resolveActiveOrganizationId({
        orgId: null,
        actorOrgId: accountOrgId,
        tenantId: foreignTenantId,
        actorTenantId: null,
      }),
    ).toBeNull()
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

  it('still honours an explicit organization selection across tenants', () => {
    expect(
      resolveActiveOrganizationId({
        orgId: selectedOrgId,
        actorOrgId: accountOrgId,
        tenantId: foreignTenantId,
        actorTenantId,
      }),
    ).toBe(selectedOrgId)
  })
})

describe('organizationScopeRequiredResponse', () => {
  // 401 would send `apiFetch` back into the session-refresh loop; the scope error must not.
  it('answers 400 with a machine-readable code', async () => {
    const response = organizationScopeRequiredResponse()
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe(ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE)
    expect(typeof body.error).toBe('string')
  })
})
