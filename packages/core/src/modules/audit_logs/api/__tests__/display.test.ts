/** @jest-environment node */
import { loadAuditLogDisplayMaps } from '@open-mercato/core/modules/audit_logs/api/audit-logs/display'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant, Organization } from '@open-mercato/core/modules/directory/data/entities'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'

function makeEm(overrides: { users?: any[]; apiKeys?: any[]; tenants?: any[]; organizations?: any[] } = {}) {
  const users = overrides.users ?? []
  const apiKeys = overrides.apiKeys ?? []
  const tenants = overrides.tenants ?? []
  const organizations = overrides.organizations ?? []
  return {
    find: jest.fn(async (entity: unknown) => {
      if (entity === User) return users
      if (entity === ApiKey) return apiKeys
      if (entity === Tenant) return tenants
      if (entity === Organization) return organizations
      return []
    }),
  } as any
}

describe('loadAuditLogDisplayMaps', () => {
  it('resolves a user actor id without querying api_keys', async () => {
    const em = makeEm({ users: [{ id: 'user-1', name: 'Alice', email: 'alice@example.com' }] })

    const maps = await loadAuditLogDisplayMaps(em, { userIds: ['user-1'], tenantIds: [], organizationIds: [] })

    expect(maps.users).toEqual({ 'user-1': 'Alice' })
    expect(em.find).toHaveBeenCalledTimes(1)
  })

  it('labels an actor id that only matches an active api key', async () => {
    const em = makeEm({
      users: [],
      apiKeys: [{ id: 'key-1', name: 'import', deletedAt: null }],
    })

    const maps = await loadAuditLogDisplayMaps(em, { userIds: ['key-1'], tenantIds: [], organizationIds: [] })

    expect(maps.users['key-1']).toBe('API key: import')
  })

  it('labels an actor id that matches a revoked (soft-deleted) api key', async () => {
    const em = makeEm({
      users: [],
      apiKeys: [{ id: 'key-2', name: 'legacy-import', deletedAt: new Date('2024-01-01T00:00:00.000Z') }],
    })

    const maps = await loadAuditLogDisplayMaps(em, { userIds: ['key-2'], tenantIds: [], organizationIds: [] })

    expect(maps.users['key-2']).toBe('API key: legacy-import (revoked)')
  })

  it('never returns the raw id when neither a user nor an api key matches', async () => {
    const em = makeEm({ users: [], apiKeys: [] })

    const maps = await loadAuditLogDisplayMaps(em, { userIds: ['ghost-id'], tenantIds: [], organizationIds: [] })

    expect(maps.users['ghost-id']).toBeUndefined()
  })
})
