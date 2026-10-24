import { aiTools } from '../ai-tools'

const getTool = aiTools.find((t) => t.name === 'search_get')
if (!getTool) throw new Error('search_get tool not found in aiTools — was it renamed?')

const PERSON_CONFIG = {
  aclFeatures: ['customers.people.view'],
  fieldPolicy: {
    searchable: ['first_name', 'last_name'],
    hashOnly: ['primary_email', 'primary_phone'],
    excluded: ['ssn', 'date_of_birth'],
  },
}

function makeCtx(
  record: Record<string, unknown> | undefined,
  overrides: {
    userFeatures?: string[]
    isSuperAdmin?: boolean
    userId?: string | null
    organizationId?: string | null
    orgScope?: { em: unknown; rbacService: unknown }
  } = {},
) {
  const items = record ? [record] : []
  const mockQuery = jest.fn().mockResolvedValue({ items, total: items.length })
  const searchIndexer = {
    getEntityConfig: (entityId: string) =>
      entityId === 'customers:customer_person_profile' ? PERSON_CONFIG : undefined,
    getAllEntityConfigs: () => [{ entityId: 'customers:customer_person_profile', ...PERSON_CONFIG }],
  }
  const ctx = {
    tenantId: 'tenant-1',
    organizationId: overrides.organizationId !== undefined ? overrides.organizationId : 'org-1',
    userId: overrides.userId !== undefined ? overrides.userId : 'user-1',
    userFeatures: overrides.userFeatures ?? ['customers.people.view'],
    isSuperAdmin: overrides.isSuperAdmin ?? false,
    container: {
      resolve: (name: string) => {
        if (name === 'searchIndexer') return searchIndexer
        if (name === 'em') {
          if (overrides.orgScope) return overrides.orgScope.em
          throw new Error('em not mocked')
        }
        if (name === 'rbacService') {
          if (overrides.orgScope) return overrides.orgScope.rbacService
          throw new Error('rbacService not mocked')
        }
        return { query: mockQuery }
      },
    },
  }
  return { ctx, mockQuery }
}

/**
 * Builds a real `em`/`rbacService` pair so `resolveActorOrganizationScope`
 * (issue #7808) runs the full `resolveOrganizationScopeForRequest` resolution
 * instead of its no-DI fallback — needed to assert the organization
 * allowlist is actually enforced (not just the caller's single current org).
 */
function makeOrgScopeResolver(options: { aclOrganizations: string[] | null; isSuperAdmin?: boolean; knownOrgIds?: string[] }) {
  const em = {
    find: jest.fn(async (_entity: unknown, filter: { id?: { $in: string[] } }) => {
      const ids = filter?.id?.$in ?? []
      const known = new Set(options.knownOrgIds ?? ['org-1', 'org-2', 'org-3'])
      return ids.filter((id) => known.has(id)).map((id) => ({ id, descendantIds: [] }))
    }),
  }
  const rbacService = {
    loadAcl: jest.fn(async () => ({
      isSuperAdmin: options.isSuperAdmin ?? false,
      features: [],
      organizations: options.aclOrganizations,
    })),
  }
  return { em, rbacService }
}

describe('search_get tool', () => {
  it('denies callers holding only search.view without the per-entity view feature', async () => {
    const { ctx, mockQuery } = makeCtx(
      { id: 'rec-1', first_name: 'Jane', ssn: '123-45-6789' },
      { userFeatures: ['search.view'] },
    )

    await expect(
      getTool.handler({ entityType: 'customers:customer_person_profile', recordId: 'rec-1' }, ctx),
    ).rejects.toThrow(/Insufficient permissions/)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('returns the record for callers holding the per-entity view feature', async () => {
    const { ctx, mockQuery } = makeCtx({ id: 'rec-1', first_name: 'Jane', last_name: 'Doe' })

    const result = await getTool.handler(
      { entityType: 'customers:customer_person_profile', recordId: 'rec-1' },
      ctx,
    ) as { found: boolean; record: Record<string, unknown> }
    expect(result.found).toBe(true)
    expect(result.record.first_name).toBe('Jane')
    expect(mockQuery).toHaveBeenCalled()
  })

  it('strips hashOnly and excluded (PII) fields from the returned record', async () => {
    const { ctx } = makeCtx({
      id: 'rec-1',
      first_name: 'Jane',
      primary_email: 'jane@example.com',
      primary_phone: '+1555',
      ssn: '123-45-6789',
      date_of_birth: '1990-01-01',
    })

    const result = await getTool.handler(
      { entityType: 'customers:customer_person_profile', recordId: 'rec-1' },
      ctx,
    ) as { record: Record<string, unknown> }
    expect(result.record.first_name).toBe('Jane')
    expect(result.record.id).toBe('rec-1')
    expect(result.record.primary_email).toBeUndefined()
    expect(result.record.primary_phone).toBeUndefined()
    expect(result.record.ssn).toBeUndefined()
    expect(result.record.date_of_birth).toBeUndefined()
  })

  it('honors wildcard grants and super admins', async () => {
    const wildcard = makeCtx({ id: 'rec-1', first_name: 'Jane' }, { userFeatures: ['*'] })
    const wildcardResult = await getTool.handler(
      { entityType: 'customers:customer_person_profile', recordId: 'rec-1' },
      wildcard.ctx,
    ) as { found: boolean }
    expect(wildcardResult.found).toBe(true)

    const superAdmin = makeCtx({ id: 'rec-1', first_name: 'Jane' }, { userFeatures: [], isSuperAdmin: true })
    const superResult = await getTool.handler(
      { entityType: 'customers:customer_person_profile', recordId: 'rec-1' },
      superAdmin.ctx,
    ) as { found: boolean }
    expect(superResult.found).toBe(true)
  })

  it('fails closed for entity types not configured for search', async () => {
    const { ctx, mockQuery } = makeCtx({ id: 'rec-1' })

    await expect(
      getTool.handler({ entityType: 'secret:unconfigured', recordId: 'rec-1' }, ctx),
    ).rejects.toThrow(/not configured for search/)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('throws when tenantId is missing', async () => {
    const { ctx } = makeCtx({ id: 'rec-1' })
    const noTenantCtx = { ...ctx, tenantId: null }

    await expect(
      getTool.handler({ entityType: 'customers:customer_person_profile', recordId: 'rec-1' }, noTenantCtx),
    ).rejects.toThrow('Tenant context is required')
  })

  describe('org-allowlist enforcement (issue #7808)', () => {
    it('scopes a restricted user with no current org to their organization allowlist', async () => {
      const orgScope = makeOrgScopeResolver({ aclOrganizations: ['org-2', 'org-3'] })
      const { ctx, mockQuery } = makeCtx(
        { id: 'rec-1', first_name: 'Jane' },
        { organizationId: null, orgScope },
      )

      const result = await getTool.handler(
        { entityType: 'customers:customer_person_profile', recordId: 'rec-1' },
        ctx,
      ) as { found: boolean }

      expect(result.found).toBe(true)
      expect(mockQuery).toHaveBeenCalledWith(
        'customers:customer_person_profile',
        expect.objectContaining({ organizationIds: ['org-2', 'org-3'] }),
      )
    })

    it('denies a restricted user whose allowlist is explicitly empty, without querying', async () => {
      const orgScope = makeOrgScopeResolver({ aclOrganizations: [] })
      const { ctx, mockQuery } = makeCtx(
        { id: 'rec-1', first_name: 'Jane' },
        { organizationId: null, orgScope },
      )

      const result = await getTool.handler(
        { entityType: 'customers:customer_person_profile', recordId: 'rec-1' },
        ctx,
      ) as { found: boolean; error?: string }

      expect(result.found).toBe(false)
      expect(mockQuery).not.toHaveBeenCalled()
    })

    it('leaves a superadmin unfiltered regardless of the ACL allowlist', async () => {
      const orgScope = makeOrgScopeResolver({ aclOrganizations: [], isSuperAdmin: true })
      const { ctx, mockQuery } = makeCtx(
        { id: 'rec-1', first_name: 'Jane' },
        { organizationId: null, isSuperAdmin: true, userFeatures: [], orgScope },
      )

      const result = await getTool.handler(
        { entityType: 'customers:customer_person_profile', recordId: 'rec-1' },
        ctx,
      ) as { found: boolean }

      expect(result.found).toBe(true)
      expect(mockQuery).toHaveBeenCalledWith(
        'customers:customer_person_profile',
        expect.objectContaining({ organizationIds: undefined }),
      )
    })
  })
})
