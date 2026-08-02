import type { EntityManager } from '@mikro-orm/postgresql'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import {
  loadQueryIndexRowScope,
  QueryIndexScopeError,
  resolveQueryIndexRecordScope,
  resolveQueryIndexReindexScope,
  resolveQueryIndexSourceMetadata,
} from '../lib/subscriber-scope'

type MetadataShape = {
  className: string
  tableName: string
  properties: Record<string, { fieldNames: string[] }>
}

function createMetadata(input: Omit<MetadataShape, 'properties'> & { organizationColumn?: string; tenantColumn?: string }): MetadataShape {
  const properties: MetadataShape['properties'] = {}
  if (input.organizationColumn) properties.organizationId = { fieldNames: [input.organizationColumn] }
  if (input.tenantColumn) properties.tenantId = { fieldNames: [input.tenantColumn] }
  return { className: input.className, tableName: input.tableName, properties }
}

function createEm(
  metadata: MetadataShape,
  row?: Record<string, string | null>,
  metadataCollection: MetadataShape[] | Map<string, MetadataShape> = [metadata],
) {
  const executeTakeFirst = jest.fn().mockResolvedValue(row)
  const where = jest.fn(() => ({ executeTakeFirst }))
  const select = jest.fn(() => ({ where }))
  const selectFrom = jest.fn(() => ({ select }))
  const getKysely = jest.fn(() => ({ selectFrom }))
  const em = {
    getKysely,
    getMetadata: () => ({
      find: (className: string) => className === metadata.className ? metadata : undefined,
      getAll: () => metadataCollection,
    }),
  } as unknown as EntityManager
  return { em, getKysely, selectFrom, select, where }
}

beforeEach(() => {
  registerEntityIds({
    feature_toggles: { feature_toggle: 'feature_toggles:feature_toggle' },
    customer_accounts: { customer_user: 'customer_accounts:customer_user' },
    customers: { customer_person: 'customers:customer_person' },
  })
})

afterEach(() => {
  registerEntityIds({})
})

describe('resolveQueryIndexSourceMetadata', () => {
  it('uses registered metadata and mapped scope columns', async () => {
    const metadata = createMetadata({
      className: 'CustomerPerson',
      tableName: 'customer_people',
      organizationColumn: 'org_scope',
      tenantColumn: 'tenant_scope',
    })
    const { em, select } = createEm(metadata, { org_scope: 'org-1', tenant_scope: 'tenant-1' })
    const source = resolveQueryIndexSourceMetadata(em, 'customers:customer_person')

    expect(source).toEqual({
      table: 'customer_people',
      organizationColumn: 'org_scope',
      tenantColumn: 'tenant_scope',
    })
    await expect(loadQueryIndexRowScope(em, source, 'record-1')).resolves.toEqual({
      kind: 'row',
      scope: { organizationId: 'org-1', tenantId: 'tenant-1' },
    })
    expect(select).toHaveBeenCalledWith(['org_scope', 'tenant_scope'])
  })

  it('supports a tenant-only entity without reading an organization column', async () => {
    const metadata = createMetadata({
      className: 'CustomerUser',
      tableName: 'customer_users',
      tenantColumn: 'tenant_id',
    })
    const { em, select } = createEm(metadata, { tenant_id: 'tenant-1' })
    const source = resolveQueryIndexSourceMetadata(em, 'customer_accounts:customer_user')

    await expect(loadQueryIndexRowScope(em, source, 'record-1')).resolves.toEqual({
      kind: 'row',
      scope: { organizationId: null, tenantId: 'tenant-1' },
    })
    expect(select).toHaveBeenCalledWith(['tenant_id'])
  })

  it('returns global scope without creating a Kysely query', async () => {
    const metadata = createMetadata({ className: 'FeatureToggle', tableName: 'feature_toggles' })
    const { em, getKysely } = createEm(metadata)
    const source = resolveQueryIndexSourceMetadata(em, 'feature_toggles:feature_toggle')

    await expect(loadQueryIndexRowScope(em, source, 'record-1')).resolves.toEqual({ kind: 'global' })
    expect(getKysely).not.toHaveBeenCalled()
  })

  it('reads MikroORM v7 Map metadata for a global entity', async () => {
    const metadata = createMetadata({ className: 'FeatureToggle', tableName: 'feature_toggles' })
    const { em } = createEm(metadata, undefined, new Map([[metadata.className, metadata]]))

    expect(resolveQueryIndexSourceMetadata(em, 'feature_toggles:feature_toggle')).toEqual({
      table: 'feature_toggles',
      organizationColumn: null,
      tenantColumn: null,
    })
  })

  it('distinguishes a missing scoped source row from a global entity', async () => {
    const metadata = createMetadata({
      className: 'CustomerPerson',
      tableName: 'customer_people',
      organizationColumn: 'organization_id',
      tenantColumn: 'tenant_id',
    })
    const { em } = createEm(metadata)
    const source = resolveQueryIndexSourceMetadata(em, 'customers:customer_person')

    await expect(loadQueryIndexRowScope(em, source, 'missing-record')).resolves.toEqual({ kind: 'missing' })
  })

  it('rejects an entity ID that only collides with registered class metadata', () => {
    const metadata = createMetadata({ className: 'FeatureToggle', tableName: 'feature_toggles' })
    const { em, getKysely } = createEm(metadata)

    expect(() => resolveQueryIndexSourceMetadata(em, 'other:feature_toggle')).toThrow(QueryIndexScopeError)
    expect(getKysely).not.toHaveBeenCalled()
  })

  it('rejects a registered entity when its resolved table has no metadata entry', () => {
    const resolvedMetadata = createMetadata({ className: 'FeatureToggle', tableName: 'feature_toggles' })
    const em = {
      getMetadata: () => ({
        find: () => resolvedMetadata,
        getAll: () => [],
      }),
    } as unknown as EntityManager

    expect(() => resolveQueryIndexSourceMetadata(em, 'feature_toggles:feature_toggle')).toThrow(QueryIndexScopeError)
  })
})

describe('resolveQueryIndexRecordScope', () => {
  it('fills missing payload scope from the source row', () => {
    expect(
      resolveQueryIndexRecordScope({
        payloadTenantId: undefined,
        payloadOrganizationId: 'org-1',
        hasPayloadTenantId: false,
        hasPayloadOrganizationId: true,
        sourceScope: { kind: 'row', scope: { tenantId: 'tenant-1', organizationId: 'org-1' } },
      })
    ).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('rejects scope mismatches between payload and source row', () => {
    expect(() => resolveQueryIndexRecordScope({
      payloadTenantId: 'tenant-b',
      payloadOrganizationId: 'org-1',
      hasPayloadTenantId: true,
      hasPayloadOrganizationId: true,
      sourceScope: { kind: 'row', scope: { tenantId: 'tenant-a', organizationId: 'org-1' } },
    })).toThrow(QueryIndexScopeError)
  })

  it('rejects organization mismatches between payload and source row', () => {
    expect(() => resolveQueryIndexRecordScope({
      payloadTenantId: 'tenant-1',
      payloadOrganizationId: 'org-b',
      hasPayloadTenantId: true,
      hasPayloadOrganizationId: true,
      sourceScope: { kind: 'row', scope: { tenantId: 'tenant-1', organizationId: 'org-a' } },
    })).toThrow(QueryIndexScopeError)
  })

  it('rejects partial payload scope when the source row is missing', () => {
    expect(() => resolveQueryIndexRecordScope({
      payloadTenantId: undefined,
      payloadOrganizationId: 'org-1',
      hasPayloadTenantId: false,
      hasPayloadOrganizationId: true,
      sourceScope: { kind: 'missing' },
    })).toThrow('missing tenantId/organizationId')
  })

  it('allows explicit full scope when the source row is missing', () => {
    expect(resolveQueryIndexRecordScope({
      payloadTenantId: 'tenant-1',
      payloadOrganizationId: 'org-1',
      hasPayloadTenantId: true,
      hasPayloadOrganizationId: true,
      sourceScope: { kind: 'missing' },
    })).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it.each([
    { payloadTenantId: undefined, payloadOrganizationId: null, hasPayloadTenantId: false, hasPayloadOrganizationId: true },
    { payloadTenantId: null, payloadOrganizationId: undefined, hasPayloadTenantId: true, hasPayloadOrganizationId: true },
    { payloadTenantId: 'tenant-1', payloadOrganizationId: null, hasPayloadTenantId: true, hasPayloadOrganizationId: true },
  ])('rejects invalid global payload %#', (payload) => {
    expect(() => resolveQueryIndexRecordScope({ ...payload, sourceScope: { kind: 'global' } })).toThrow(QueryIndexScopeError)
  })

  it('accepts only explicit null/null global scope', () => {
    expect(resolveQueryIndexRecordScope({
      payloadTenantId: null,
      payloadOrganizationId: null,
      hasPayloadTenantId: true,
      hasPayloadOrganizationId: true,
      sourceScope: { kind: 'global' },
    })).toEqual({ tenantId: null, organizationId: null })
  })
})

describe('resolveQueryIndexReindexScope', () => {
  it('rejects implicit all-tenant reindex payloads', () => {
    expect(() => resolveQueryIndexReindexScope({ tenantId: undefined, organizationId: undefined })).toThrow('all-tenant reindex must opt in')
  })

  it('allows explicit all-tenant reindex payloads', () => {
    expect(resolveQueryIndexReindexScope({
      tenantId: undefined,
      organizationId: undefined,
      allowAllTenants: true,
    })).toEqual({ tenantId: undefined, organizationId: undefined })
  })

  it('preserves explicit global scope', () => {
    expect(resolveQueryIndexReindexScope({ tenantId: null, organizationId: null })).toEqual({ tenantId: null, organizationId: null })
  })
})
