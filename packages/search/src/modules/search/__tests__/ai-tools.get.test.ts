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
  overrides: { userFeatures?: string[]; isSuperAdmin?: boolean } = {},
) {
  const items = record ? [record] : []
  const mockQuery = jest.fn().mockResolvedValue({ items, total: items.length })
  const searchIndexer = {
    getEntityConfig: (entityId: string) =>
      entityId === 'customers:customer_person_profile' ? PERSON_CONFIG : undefined,
  }
  const ctx = {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: null,
    userFeatures: overrides.userFeatures ?? ['customers.people.view'],
    isSuperAdmin: overrides.isSuperAdmin ?? false,
    container: {
      resolve: (name: string) => (name === 'searchIndexer' ? searchIndexer : { query: mockQuery }),
    },
  }
  return { ctx, mockQuery }
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
})
