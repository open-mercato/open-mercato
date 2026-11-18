import type { AwilixContainer } from 'awilix'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { buildTrustedSalesContext } from '../lib/salesCommandContext'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const container = { resolve: jest.fn() } as unknown as AwilixContainer

describe('buildTrustedSalesContext', () => {
  const originalStrict = process.env.OM_ENFORCE_ORG_SCOPE_STRICT

  afterEach(() => {
    if (originalStrict === undefined) delete process.env.OM_ENFORCE_ORG_SCOPE_STRICT
    else process.env.OM_ENFORCE_ORG_SCOPE_STRICT = originalStrict
  })

  it('carries no request and no user, and a single-organization scope', () => {
    const ctx = buildTrustedSalesContext(container, scope)
    expect(ctx.request).toBeUndefined()
    expect(ctx.auth).toBeNull()
    expect(ctx.systemActor).toBe(true)
    expect(ctx.selectedOrganizationId).toBe(scope.organizationId)
    expect(ctx.organizationScope).toEqual({
      tenantId: scope.tenantId,
      selectedId: scope.organizationId,
      filterIds: [scope.organizationId],
      allowedIds: [scope.organizationId],
    })
    expect(ctx.transactionalEm).toBeUndefined()
  })

  it('passes the strict organization-scope guard and the tenant guard', () => {
    process.env.OM_ENFORCE_ORG_SCOPE_STRICT = 'true'
    const ctx = buildTrustedSalesContext(container, scope)
    expect(() => ensureOrganizationScope(ctx, scope.organizationId)).not.toThrow()
    expect(() => ensureTenantScope(ctx, scope.tenantId)).not.toThrow()
  })

  it('refuses any other organization', () => {
    const ctx = buildTrustedSalesContext(container, scope)
    expect(() => ensureOrganizationScope(ctx, '33333333-3333-4333-8333-333333333333')).toThrow()
  })

  it('joins a caller transaction when one is given', () => {
    const transactionalEm = { id: 'tx' } as never
    expect(buildTrustedSalesContext(container, scope, { transactionalEm }).transactionalEm).toBe(transactionalEm)
  })
})
