import type { AwilixContainer } from 'awilix'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import type { EntityManager } from '@mikro-orm/postgresql'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { getApiInterceptorsForRoute } from '@open-mercato/shared/lib/crud/interceptor-registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { assertEntityAclForRequest } from '@open-mercato/core/modules/entities/lib/entityAcl'
import { classifyRecordsEntity } from '@open-mercato/core/modules/entities/lib/entityClassification'
import { applyAssignmentEnrichments, resolveAssignmentEnrichments } from '../assignmentDetails'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  getModules: () => [{ id: 'catalog' }, { id: 'sales' }, { id: 'customers' }, { id: 'entities' }, { id: 'query_index' }],
}))
jest.mock('@open-mercato/shared/lib/encryption/entityIds', () => ({
  getEntityIds: () => ({
    catalog: {
      catalog_product: 'catalog:catalog_product',
      catalog_product_variant: 'catalog:catalog_product_variant',
    },
    customers: { customer_entity: 'customers:customer_entity' },
    sales: { sales_channel: 'sales:sales_channel', sales_order: 'sales:sales_order' },
  }),
}))
jest.mock('@open-mercato/shared/lib/crud/interceptor-registry', () => ({
  getApiInterceptorsForRoute: jest.fn(() => []),
}))
jest.mock('@open-mercato/core/modules/entities/lib/entityClassification', () => ({
  classifyRecordsEntity: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/entities/lib/entityAcl', () => ({
  ...jest.requireActual('@open-mercato/core/modules/entities/lib/entityAcl'),
  assertEntityAclForRequest: jest.fn(),
}))

const tenantId = '10000000-0000-4000-8000-000000000001'
const organizationId = '10000000-0000-4000-8000-000000000002'
const foreignTenantId = '10000000-0000-4000-8000-000000000003'
const foreignOrganizationId = '10000000-0000-4000-8000-000000000004'
const localId = '20000000-0000-4000-8000-000000000001'
const foreignId = '20000000-0000-4000-8000-000000000002'
const outOfOrgId = '20000000-0000-4000-8000-000000000003'
const product = { type: 'catalog:catalog_product', id: localId }
const auth = { sub: 'fixture-user', tenantId, orgId: organizationId }
const loadAcl = jest.fn()
const em = {
  getMetadata: () => ({
    find: (name: string) => {
      if (name === 'CatalogProduct') return { tableName: 'att10336_products' }
      if (name === 'CatalogProductVariant') return { tableName: 'att10336_variants' }
      return undefined
    },
  }),
}
const container = { resolve: (key: string) => key === 'em' ? em : { loadAcl } } as unknown as AwilixContainer
const query = jest.fn()
const opts = {
  tenantId, organizationId, authorization: { auth, container },
  queryEngine: { query } as unknown as QueryEngine,
}

function grant(...features: string[]) {
  loadAcl.mockResolvedValue({ features, isSuperAdmin: false, organizations: [organizationId] })
}

beforeEach(() => {
  jest.resetAllMocks()
  grant('attachments.view', 'attachments.manage')
  jest.mocked(getApiInterceptorsForRoute).mockReturnValue([])
  jest.mocked(classifyRecordsEntity).mockImplementation(async (_em, entityId) => (
    entityId === 'fixture:restricted'
      ? { kind: 'custom', restricted: true }
      : { kind: 'system', restricted: false }
  ))
  query.mockResolvedValue({ items: [] })
})

it('leaves stored assignment metadata opaque for attachment-only callers', async () => {
  const assignments = [
    { type: 'auth:user', id: localId, label: 'Manual label', href: '/manual' },
    { type: 'customers:customer_entity', id: localId },
    { type: 'sales:sales_channel', id: localId },
    { type: 'sales:sales_order', id: localId },
    product,
  ]
  const result = await resolveAssignmentEnrichments(assignments, opts)
  expect(applyAssignmentEnrichments(assignments, result)).toEqual(assignments)
  expect(classifyRecordsEntity).not.toHaveBeenCalled()
  expect(query).not.toHaveBeenCalled()
})

it('requires a verified caller, specific organization, and a valid record ID', async () => {
  await expect(resolveAssignmentEnrichments([product], { ...opts, authorization: undefined })).resolves.toEqual(new Map())
  await expect(resolveAssignmentEnrichments([product], { ...opts, organizationId: null })).resolves.toEqual(new Map())
  await expect(resolveAssignmentEnrichments([product], { ...opts, tenantId: foreignTenantId })).resolves.toEqual(new Map())
  await expect(resolveAssignmentEnrichments([{ ...product, id: 'invalid' }], opts)).resolves.toEqual(new Map())
  expect(loadAcl).not.toHaveBeenCalled()
  expect(query).not.toHaveBeenCalled()
})

it('authorizes wildcard read grants and augments the requested same-scope product', async () => {
  grant('catalog.products.*')
  query.mockResolvedValue({ items: [{ id: localId, title: 'Fixture product' }] })
  const result = await resolveAssignmentEnrichments([product], opts)
  expect(applyAssignmentEnrichments([product], result)).toEqual([{
    ...product, label: 'Fixture product', href: `/backend/catalog/products/${localId}`,
  }])
  expect(query).toHaveBeenCalledWith(product.type, expect.objectContaining({
    omitAutomaticTenantOrgScope: true,
    filters: { id: { $in: [localId] }, 'base.tenant_id': tenantId, 'base.organization_id': organizationId },
  }))
})

it('keeps CRM kinds without the corresponding grant out of the lookup', async () => {
  grant('customers.people.view')
  await resolveAssignmentEnrichments([{ type: 'customers:customer_entity', id: localId }], opts)
  expect(query).toHaveBeenCalledWith('customers:customer_entity', expect.objectContaining({
    filters: expect.objectContaining({ 'base.kind': { $in: ['person'] } }),
  }))
})

it('skips direct enrichment when the owning read route has a policy hook', async () => {
  grant('sales.channels.view')
  jest.mocked(getApiInterceptorsForRoute).mockReturnValue([{
    moduleId: 'fixture', moduleOrder: 0, interceptorOrder: 0,
    interceptor: { id: 'fixture.policy', targetRoute: 'sales/channels', methods: ['GET'], before: async () => ({ ok: false }) },
  }])
  await expect(resolveAssignmentEnrichments([{ type: 'sales:sales_channel', id: localId }], opts)).resolves.toEqual(new Map())
  expect(getApiInterceptorsForRoute).toHaveBeenCalledWith('sales/channels', 'GET')
  expect(query).not.toHaveBeenCalled()
})

it('requires custom record permissions including the restricted entity grant', async () => {
  const assignment = { type: 'fixture:restricted', id: localId }
  grant('entities.definitions.view')
  await expect(resolveAssignmentEnrichments([assignment], opts)).resolves.toEqual(new Map())
  expect(query).not.toHaveBeenCalled()

  grant('entities.records.view')
  jest.mocked(assertEntityAclForRequest).mockRejectedValueOnce(new CrudHttpError(403, { error: 'Forbidden' }))
  await expect(resolveAssignmentEnrichments([assignment], opts)).resolves.toEqual(new Map())
  expect(assertEntityAclForRequest).toHaveBeenCalledWith(expect.objectContaining({
    entityId: assignment.type, auth, action: 'view', isCustomEntity: true, isRestricted: true,
  }))
  expect(query).not.toHaveBeenCalled()

  const basic = new BasicQueryEngine(em as unknown as EntityManager)
  const basicQuery = jest.spyOn(basic, 'query')
  await expect(resolveAssignmentEnrichments([assignment], { ...opts, queryEngine: basic })).resolves.toEqual(new Map())
  expect(basicQuery).not.toHaveBeenCalled()

  query.mockResolvedValue({ items: [{ id: localId, label: 'Fixture label' }] })
  await expect(resolveAssignmentEnrichments([assignment], opts)).resolves.toEqual(new Map([
    [`${assignment.type}:${localId}`, { label: 'Fixture label', href: undefined }],
  ]))
  expect(query).toHaveBeenCalledWith(assignment.type, expect.objectContaining({ tenantId, organizationId, forceCustomEntityStorage: true }))
})

it('does not query undeclared system targets even with a registered-entity read grant', async () => {
  grant('entities.records.view', 'auth.users.list', 'sales.orders.view')
  await expect(resolveAssignmentEnrichments([
    { type: 'auth:user', id: localId },
    { type: 'sales:sales_order', id: localId },
    { type: 'directory:tenant', id: localId },
  ], opts)).resolves.toEqual(new Map())
  expect(query).not.toHaveBeenCalled()
})

const pgUrl = process.env.OM_ATTACHMENT_ASSIGNMENTS_PG_URL
const postgresSuite = pgUrl ? describe : describe.skip

postgresSuite('assignment enrichment with the initialized query engine', () => {
  let db: Kysely<Record<string, never>>
  let engine: BasicQueryEngine

  beforeAll(async () => {
    db = new Kysely({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: pgUrl, max: 1 }) }) })
    engine = new BasicQueryEngine(em as unknown as EntityManager, () => db)
    await sql`create temporary table att10336_products (
      id uuid primary key, tenant_id uuid, organization_id uuid, title text, sku text, handle text
    )`.execute(db)
    await sql`insert into att10336_products (id, tenant_id, organization_id, title) values
      (${localId}::uuid, ${tenantId}::uuid, ${organizationId}::uuid, 'Local product'),
      (${foreignId}::uuid, ${foreignTenantId}::uuid, ${organizationId}::uuid, 'Other tenant product'),
      (${outOfOrgId}::uuid, ${tenantId}::uuid, ${foreignOrganizationId}::uuid, 'Other organization product')
    `.execute(db)
    await sql`create temporary table catalog_products (
      id uuid primary key, tenant_id uuid, organization_id uuid, deleted_at timestamptz
    )`.execute(db)
    await sql`insert into catalog_products select id, tenant_id, organization_id, null from att10336_products`.execute(db)
    await sql`create temporary table att10336_variants (
      id uuid primary key, tenant_id uuid, organization_id uuid, product_id uuid, name text, sku text
    )`.execute(db)
    await sql`insert into att10336_variants (id, tenant_id, organization_id, product_id, name) values
      (${localId}::uuid, ${tenantId}::uuid, ${organizationId}::uuid, ${localId}::uuid, 'Local variant'),
      (${foreignId}::uuid, ${tenantId}::uuid, ${organizationId}::uuid, ${foreignId}::uuid, 'Variant with out-of-scope parent')
    `.execute(db)
  })

  afterAll(async () => {
    await db?.destroy()
  })

  it('only returns enrichment for a record in the exact caller scope', async () => {
    grant('catalog.products.view')
    const assignments = [product, { ...product, id: foreignId }, { ...product, id: outOfOrgId }]
    const result = await resolveAssignmentEnrichments(assignments, { ...opts, queryEngine: engine })
    expect([...result.keys()]).toEqual([`${product.type}:${localId}`])
    expect(result.get(`${product.type}:${localId}`)?.label).toBe('Local product')
  })

  it('verifies that a variant parent is also in scope', async () => {
    grant('catalog.products.view')
    const variantType = 'catalog:catalog_product_variant'
    const pgContainer = { resolve: (key: string) => (
      key === 'em' ? { ...em, getKysely: () => db } : { loadAcl }
    ) } as unknown as AwilixContainer
    const assignments = [{ type: variantType, id: localId }, { type: variantType, id: foreignId }]
    const pgOpts = { ...opts, authorization: { auth, container: pgContainer }, queryEngine: engine }
    const result = await resolveAssignmentEnrichments(assignments, pgOpts)
    expect([...result.keys()]).toEqual([`${variantType}:${localId}`])

    await sql`alter table catalog_products drop column tenant_id`.execute(db)
    await expect(resolveAssignmentEnrichments(assignments, pgOpts)).resolves.toEqual(new Map())
  })

  it('fails closed when the backing table cannot enforce tenant scope', async () => {
    grant('catalog.products.view')
    await sql`alter table att10336_products drop column tenant_id`.execute(db)
    try {
      await expect(resolveAssignmentEnrichments([product], { ...opts, queryEngine: engine })).resolves.toEqual(new Map())
    } finally {
      await sql`alter table att10336_products add column tenant_id uuid`.execute(db)
      await sql`update att10336_products set tenant_id = ${tenantId}::uuid where id = ${localId}::uuid`.execute(db)
    }
  })
})
