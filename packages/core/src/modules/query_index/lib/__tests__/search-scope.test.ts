import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveQueryIndexSearchScope } from '../search-scope'
import { registerTenantGlobalEntityTypes, resetTenantGlobalEntityTypes } from '../tenant-global'

const mockSources: Record<string, { table: string; schema?: string; tableName?: string; tenantColumn: string | null; organizationColumn: string | null } | undefined> = {
  'feature_toggles:feature_toggle': { table: 'feature_toggles', tenantColumn: null, organizationColumn: null },
  'private:record': { table: 'private_records', tenantColumn: null, organizationColumn: null },
  'scoped:record': { table: 'scoped_records', tenantColumn: 'tenant_id', organizationColumn: 'organization_id' },
  'organization:record': { table: 'organization_records', tenantColumn: null, organizationColumn: 'organization_id' },
  'drift:record': { table: 'drift_records', tenantColumn: null, organizationColumn: null },
  'missing:record': { table: 'missing_records', tenantColumn: null, organizationColumn: null },
}

jest.mock('@open-mercato/shared/lib/encryption/entityIds', () => ({
  getEntityIds: () => ({ test: Object.fromEntries(Object.keys(mockSources).map((entityType) => [entityType, entityType])) }),
}))
jest.mock('@open-mercato/shared/lib/db/mikro', () => ({ getOrm: jest.fn().mockRejectedValue(new Error('[internal] no ORM configured')) }))

jest.mock('../subscriber-scope', () => ({
  resolveQueryIndexSourceMetadata: (_manager: unknown, entityType: string) => mockSources[entityType],
}))

function createManager(metadata: Array<{ className: string; tableName: string; schema?: string; properties: Record<string, never> }> = []) {
  const columns = {
    feature_toggles: ['id', 'name'], private_records: ['id', 'secret'],
    scoped_records: ['id', 'tenant_id', 'organization_id'], organization_records: ['id', 'organization_id'],
    drift_records: ['id', 'tenant_id'],
  }
  const execute = jest.fn(async () => Object.entries(columns).flatMap(([table_name, names]) => names.map((column_name) => ({ table_schema: 'public', table_name, column_name, is_current_schema: true }))))
  const builder = { select: () => builder, where: () => builder, execute }
  const driver = {}
  return { manager: { getDriver: () => driver, getMetadata: () => ({ getAll: () => metadata }), getKysely: () => ({ selectFrom: () => builder }) } as unknown as EntityManager, execute }
}

describe('verified query-index search scope', () => {
  beforeEach(resetTenantGlobalEntityTypes)
  afterEach(resetTenantGlobalEntityTypes)

  it('quarantines undeclared tenantless private types while retaining catalogues and scoped types', async () => {
    const { manager } = createManager()
    const policy = await resolveQueryIndexSearchScope(manager)
    expect(policy.tenantGlobalEntityTypes).toEqual(['feature_toggles:feature_toggle'])
    expect(policy.searchableEntityTypes).toEqual(['drift:record', 'feature_toggles:feature_toggle', 'scoped:record'])
    expect(policy.searchableEntityTypes).not.toContain('private:record')
    expect(policy.searchableEntityTypes).not.toContain('organization:record')
  })

  it('does not activate a scoped, physically drifted, absent or unregistered declaration', async () => {
    registerTenantGlobalEntityTypes('scoped:record', 'organization:record', 'drift:record', 'missing:record', 'unknown:record')
    const { manager } = createManager()
    expect((await resolveQueryIndexSearchScope(manager)).tenantGlobalEntityTypes).toEqual(['feature_toggles:feature_toggle'])
  })

  it('invalidates verification when declarations change and shares concurrent probes only on the same driver', async () => {
    const { manager, execute } = createManager()
    await Promise.all([resolveQueryIndexSearchScope(manager), resolveQueryIndexSearchScope(manager)])
    expect(execute).toHaveBeenCalledTimes(1)
    registerTenantGlobalEntityTypes('private:record')
    expect((await resolveQueryIndexSearchScope(manager)).tenantGlobalEntityTypes).toContain('private:record')
    expect(execute).toHaveBeenCalledTimes(2)
    resetTenantGlobalEntityTypes()
    expect((await resolveQueryIndexSearchScope(manager)).tenantGlobalEntityTypes).not.toContain('private:record')
    expect(execute).toHaveBeenCalledTimes(3)
    const other = createManager()
    await resolveQueryIndexSearchScope(other.manager)
    expect(other.execute).toHaveBeenCalledTimes(1)
  })

  it('does not mix a named ORM schema with a same-name table in the current schema', async () => {
    const { manager, execute } = createManager([{ className: 'FeatureToggle', tableName: 'feature_toggles', schema: 'catalogues', properties: {} }])
    const original = mockSources['feature_toggles:feature_toggle']
    mockSources['feature_toggles:feature_toggle'] = { table: 'catalogues.feature_toggles', tableName: 'feature_toggles', schema: 'catalogues', tenantColumn: null, organizationColumn: null }
    execute.mockResolvedValueOnce([
      { table_schema: 'public', table_name: 'feature_toggles', column_name: 'id', is_current_schema: true },
      { table_schema: 'catalogues', table_name: 'feature_toggles', column_name: 'id', is_current_schema: false },
      { table_schema: 'catalogues', table_name: 'feature_toggles', column_name: 'tenant_id', is_current_schema: false },
    ])
    try {
      expect((await resolveQueryIndexSearchScope(manager)).tenantGlobalEntityTypes).toEqual([])
    } finally {
      mockSources['feature_toggles:feature_toggle'] = original
    }
  })

  it('keeps unregistered provider sources scoped while refusing global activation without ORM proof', async () => {
    const policy = await resolveQueryIndexSearchScope()
    expect(policy.tenantGlobalEntityTypes).toEqual([])
    expect(policy.blockedEntityTypes).toContain('private:record')
    expect(policy.blockedEntityTypes).not.toContain('provider:remote_record')
  })

  it('fails closed on a physical probe error and retries rather than caching a failed verification', async () => {
    const { manager, execute } = createManager()
    execute.mockRejectedValueOnce(new Error('[internal] probe unavailable'))
    await expect(resolveQueryIndexSearchScope(manager)).rejects.toThrow('probe unavailable')
    expect((await resolveQueryIndexSearchScope(manager)).tenantGlobalEntityTypes).toEqual(['feature_toggles:feature_toggle'])
    expect(execute).toHaveBeenCalledTimes(2)
  })
})
