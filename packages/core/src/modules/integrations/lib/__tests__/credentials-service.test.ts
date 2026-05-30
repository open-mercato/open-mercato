import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { buildCredentialsFilter } from '../credentials-service'

/**
 * The credential where-filter IS the per-user / tenant isolation boundary:
 * `findOneWithDecryption` applies it verbatim as the SQL where-clause, so an
 * explicit `userId: null` means `user_id IS NULL` (tenant-wide rows only) and a
 * concrete `userId` pins the lookup to a single owner. These assertions lock the
 * branch so a regression can never silently widen one scope into another's rows.
 */
describe('buildCredentialsFilter (per-user / tenant isolation)', () => {
  const tenantScope: IntegrationScope = { tenantId: 't1', organizationId: 'o1' }
  const userScope: IntegrationScope = { tenantId: 't1', organizationId: 'o1', userId: 'user-a' }

  it('scopes a tenant-wide lookup to user_id = null', () => {
    expect(buildCredentialsFilter('gmail', tenantScope)).toEqual({
      integrationId: 'gmail',
      organizationId: 'o1',
      tenantId: 't1',
      deletedAt: null,
      userId: null,
    })
  })

  it('pins a per-user lookup to that exact user_id within the tenant/org', () => {
    const filter = buildCredentialsFilter('gmail', userScope)
    expect(filter.userId).toBe('user-a')
    expect(filter.tenantId).toBe('t1')
    expect(filter.organizationId).toBe('o1')
    expect(filter.integrationId).toBe('gmail')
  })

  it('emits an explicit null userId for tenant-wide scope so user-owned rows are excluded', () => {
    const filter = buildCredentialsFilter('gmail', tenantScope)
    expect('userId' in filter).toBe(true)
    expect(filter.userId).toBeNull()
  })

  it('isolates two users on the same tenant into distinct filters', () => {
    const a = buildCredentialsFilter('gmail', { tenantId: 't1', organizationId: 'o1', userId: 'user-a' })
    const b = buildCredentialsFilter('gmail', { tenantId: 't1', organizationId: 'o1', userId: 'user-b' })
    expect(a.userId).toBe('user-a')
    expect(b.userId).toBe('user-b')
    expect(a.userId).not.toBe(b.userId)
  })

  it('treats userId null and userId undefined identically (tenant-wide)', () => {
    const withNull = buildCredentialsFilter('gmail', { tenantId: 't1', organizationId: 'o1', userId: null })
    const withUndefined = buildCredentialsFilter('gmail', { tenantId: 't1', organizationId: 'o1' })
    expect(withNull.userId).toBeNull()
    expect(withUndefined.userId).toBeNull()
  })
})
