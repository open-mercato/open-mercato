import type { EntityManager } from '@mikro-orm/postgresql'
import { reindexEntity } from '../lib/reindexer'
import { runQueryIndexTenantContinuation } from '../lib/reindex-scopes'
import { currentDatabaseExecutionContext, isDatabaseRuntimeEnabled } from '@open-mercato/shared/lib/db/runtime'

jest.mock('@open-mercato/shared/lib/db/runtime', () => ({ currentDatabaseExecutionContext: jest.fn(), isDatabaseRuntimeEnabled: jest.fn() }))
jest.mock('../lib/reindex-scopes', () => ({ runQueryIndexTenantContinuation: jest.fn() }))
jest.mock('../lib/subscriber-scope', () => ({
  resolveQueryIndexSourceMetadata: jest.fn(() => ({ table: 'customer_entities', tenantColumn: 'tenant_id', organizationColumn: 'organization_id' })),
  resolveQueryIndexSourceTableMetadata: jest.fn(),
}))
const tenantId = '11111111-1111-4111-8111-111111111111'
const otherTenantId = '22222222-2222-4222-8222-222222222222'

function maintenanceManager(columns = ['id', 'tenant_id', 'organization_id'], tenants = [tenantId, otherTenantId]) {
  const tables: string[] = []
  const builder = {
    select: jest.fn().mockReturnThis(), distinct: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
    execute: jest.fn()
      .mockResolvedValueOnce(columns.map((column_name) => ({ column_name })))
      .mockResolvedValueOnce(tenants.map((tenant) => ({ tenant_id: tenant }))),
  }
  const db = { selectFrom: jest.fn((table: string) => { tables.push(table); return builder }) }
  return { em: { getKysely: () => db } as unknown as EntityManager, builder, tables }
}
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(isDatabaseRuntimeEnabled).mockReturnValue(true)
  jest.mocked(currentDatabaseExecutionContext).mockReturnValue({ kind: 'maintenance', tenantId: null, source: 'maintenance', operation: 'query_index.reindex' })
  jest.mocked(runQueryIndexTenantContinuation).mockResolvedValue({ processed: 2, total: 3, tenantScopes: [tenantId], scopes: [{ tenantId, organizationId: null }] })
})
it('uses maintenance only for discovery and delegates every tenant to a fresh continuation', async () => {
  const { em, tables, builder } = maintenanceManager()
  const result = await reindexEntity(em, { entityType: 'customers:customer_entity', force: true })
  expect(tables).toEqual(['information_schema.columns', 'customer_entities'])
  expect(builder.select).toHaveBeenCalledWith('tenant_id')
  expect(builder.where).toHaveBeenCalledWith('tenant_id', 'is not', null)
  expect(jest.mocked(runQueryIndexTenantContinuation).mock.calls.map(([tenant]) => tenant)).toEqual([tenantId, otherTenantId])
  expect(result).toMatchObject({ processed: 4, total: 6 })
})
it.each([[tenantId, otherTenantId], [otherTenantId, tenantId]])('reindexes the active tenant with discovery order %s, %s', async (first, second) => {
  const expected = { processed: 2, total: 3, tenantScopes: [tenantId], scopes: [{ tenantId, organizationId: null }] }
  jest.mocked(runQueryIndexTenantContinuation).mockImplementation(async (tenant) => tenant === tenantId ? expected : null)
  const { em, tables } = maintenanceManager(undefined, [first, second])
  await expect(reindexEntity(em, { entityType: 'customers:customer_entity' })).resolves.toEqual(expected)
  expect(jest.mocked(runQueryIndexTenantContinuation).mock.calls.map(([tenant]) => tenant)).toEqual([first, second])
  expect(tables).toEqual(['information_schema.columns', 'customer_entities'])
})
it('refuses unclassified unscoped execution before any source row query', async () => {
  jest.mocked(currentDatabaseExecutionContext).mockReturnValue({ kind: 'identity', tenantId: null, source: 'identity' })
  const { em, tables } = maintenanceManager()
  await expect(reindexEntity(em, { entityType: 'customers:customer_entity' })).rejects.toThrow('classified maintenance')
  expect(tables).toEqual(['information_schema.columns'])
  expect(runQueryIndexTenantContinuation).not.toHaveBeenCalled()
})
it('propagates a continuation failure and never falls back to maintenance', async () => {
  const failure = new Error('directory unavailable')
  jest.mocked(runQueryIndexTenantContinuation).mockRejectedValueOnce(failure)
  const { em, tables } = maintenanceManager()
  await expect(reindexEntity(em, { entityType: 'customers:customer_entity' })).rejects.toBe(failure)
  expect(runQueryIndexTenantContinuation).toHaveBeenCalledTimes(1)
  expect(tables).toEqual(['information_schema.columns', 'customer_entities'])
})

it('refuses schema drift that removes the declared tenant column instead of sweeping privately scoped rows as global', async () => {
  const { em, tables } = maintenanceManager(['id'])
  await expect(reindexEntity(em, { entityType: 'customers:customer_entity' })).resolves.toMatchObject({ refused: 'no-tenant-column', processed: 0 })
  expect(tables).toEqual(['information_schema.columns'])
  expect(runQueryIndexTenantContinuation).not.toHaveBeenCalled()
})
it('limits tenant discovery to an explicitly requested organization', async () => {
  const { em, builder } = maintenanceManager()
  const organizationId = '33333333-3333-4333-8333-333333333333'
  await reindexEntity(em, { entityType: 'customers:customer_entity', organizationId })
  expect(builder.where).toHaveBeenCalledWith('organization_id', '=', organizationId)
  expect(runQueryIndexTenantContinuation).toHaveBeenCalledWith(tenantId, organizationId, expect.any(Function))
})
