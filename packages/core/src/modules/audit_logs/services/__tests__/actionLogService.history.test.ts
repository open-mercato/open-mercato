import type { EntityManager } from '@mikro-orm/postgresql'
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
} from 'kysely'
import { encryptWithAesGcm, generateDek } from '@open-mercato/shared/lib/encryption/aes'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { ActionLogService } from '../actionLogService'

const tenantId = '10000000-0000-4000-8000-000000000001'
const organizationId = '20000000-0000-4000-8000-000000000001'
const rowId = '30000000-0000-4000-8000-000000000001'
const actorUserId = '40000000-0000-4000-8000-000000000001'
const resource = { tenantId, resourceKind: 'sales.quote', resourceId: 'quote-1' }
const exact = { ...resource, organization: { mode: 'exact', organizationId } as const }
const tenantLevel = { ...resource, organization: { mode: 'exact', organizationId: null } as const }
const fallback = { ...resource, organization: { mode: 'tenant-level-fallback', organizationIds: [organizationId] } as const }

function fixture(encryption?: TenantDataEncryptionService) {
  const executeQuery = jest.fn<Promise<{ rows: object[] }>, [CompiledQuery]>().mockResolvedValue({ rows: [] })
  const driver = new DummyDriver()
  driver.acquireConnection = async () => ({ executeQuery }) as unknown as DatabaseConnection
  const db = new Kysely({
    dialect: {
      createDriver: () => driver,
      createAdapter: () => new PostgresAdapter(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (database) => new PostgresIntrospector(database),
    },
  })
  const em = { getKysely: () => db } as unknown as EntityManager
  return { executeQuery, service: new ActionLogService(em, encryption) }
}

test('requires tenant, resource, active status and exact organization on every lookup', async () => {
  const { executeQuery, service } = fixture()

  await service.findLatestResourceHistory(exact)
  await service.findLatestActorHistory(exact, actorUserId)
  await service.findResourceHistoryById(exact, rowId)

  const [resourceQuery, actorQuery, idQuery] = executeQuery.mock.calls.map(([query]) => query)
  for (const query of [resourceQuery, actorQuery, idQuery]) {
    expect(query.sql).toContain('where "tenant_id" = $1 and "resource_kind" = $2 and "resource_id" = $3 and "deleted_at" is null and "organization_id" = $4')
    expect(query.parameters.slice(0, 4)).toEqual([tenantId, resource.resourceKind, resource.resourceId, organizationId])
    expect(query.parameters.at(-1)).toBe(1)
  }
  expect(resourceQuery.sql).toContain('order by "created_at" desc limit')
  expect(actorQuery.sql).toContain('"actor_user_id" = $5 order by "created_at" desc limit')
  expect(actorQuery.parameters[4]).toBe(actorUserId)
  expect(idQuery.sql).toContain('"id" = $5 limit')
  expect(idQuery.parameters[4]).toBe(rowId)
})

test('distinguishes exact SQL null from a finite authorized fallback', async () => {
  const { executeQuery, service } = fixture()

  await service.findLatestResourceHistory(tenantLevel)
  await service.findResourceHistoryById(tenantLevel, rowId)
  await service.findLatestResourceHistory(fallback)
  await service.findLatestActorHistory(fallback, actorUserId)
  await service.findLatestResourceHistory({ ...fallback, organization: { mode: 'tenant-level-fallback', organizationIds: [] } })
  await service.findLatestResourceHistory({ ...exact, tenantId: '' })

  expect(executeQuery).toHaveBeenCalledTimes(4)
  const [nullResource, nullById, orgResource, orgActor] = executeQuery.mock.calls.map(([query]) => query)
  expect(nullResource.sql).toContain('"organization_id" is null order by "created_at"')
  expect(nullById.sql).toContain('"organization_id" is null and "id" = $4')
  expect(orgResource.sql).toContain('"organization_id" in ($4) order by "created_at"')
  expect(orgActor.sql).toContain('"organization_id" in ($4) and "actor_user_id" = $5')
  expect(orgActor.parameters.slice(3)).toEqual([organizationId, actorUserId, 1])
})

test('normalizes an authorized fallback row and decrypts once under its actual organization', async () => {
  const key = generateDek()
  const createdAt = new Date('2026-11-24T10:00:00.000Z')
  const encryptedLabel = encryptWithAesGcm('Incoming label', key).value
  const changesJson = JSON.stringify({ 'entity.label': { from: 'Before label', to: encryptedLabel } })
  const snapshotAfter = JSON.stringify({ entity: { label: encryptedLabel } })
  const encryption = {
    isEnabled: jest.fn().mockReturnValue(true),
    getDek: jest.fn().mockResolvedValue({ key }),
    decryptEntityPayload: jest.fn().mockResolvedValue({ changesJson, snapshotAfter }),
  }
  const { service, executeQuery } = fixture(encryption as unknown as TenantDataEncryptionService)

  await expect(service.findResourceHistoryById(tenantLevel, rowId)).resolves.toBeNull()
  expect(encryption.getDek).not.toHaveBeenCalled()

  executeQuery.mockResolvedValue({
    rows: [{
      id: rowId,
      tenant_id: tenantId,
      organization_id: organizationId,
      actor_user_id: actorUserId,
      created_at: createdAt,
      changes_json: changesJson,
      snapshot_after: snapshotAfter,
      snapshot_before: { entity: { label: 'Before label' } },
    }],
  })
  await expect(service.findLatestResourceHistory(fallback)).resolves.toEqual({
    id: rowId,
    actorUserId,
    createdAt,
    changesJson: { 'entity.label': { from: 'Before label', to: 'Incoming label' } },
    snapshotBefore: { entity: { label: 'Before label' } },
    snapshotAfter: { entity: { label: 'Incoming label' } },
  })
  expect(encryption.getDek).toHaveBeenCalledTimes(1)
  expect(encryption.getDek).toHaveBeenCalledWith(tenantId)
  expect(encryption.decryptEntityPayload).toHaveBeenCalledTimes(1)
  expect(encryption.decryptEntityPayload).toHaveBeenCalledWith(
    'audit_logs:action_log', expect.any(Object), tenantId, organizationId, expect.any(Object),
  )
})

test('propagates operational query and decryption failures', async () => {
  const decryptionError = new Error('decryption unavailable')
  const encryption = {
    isEnabled: jest.fn().mockReturnValue(true),
    getDek: jest.fn().mockRejectedValue(decryptionError),
  } as unknown as TenantDataEncryptionService
  const { service, executeQuery } = fixture(encryption)
  const queryError = new Error('database unavailable')
  executeQuery.mockRejectedValueOnce(queryError)
  await expect(service.findLatestResourceHistory(exact)).rejects.toBe(queryError)

  executeQuery.mockResolvedValueOnce({ rows: [{ id: rowId, tenant_id: tenantId }] })
  await expect(service.findLatestResourceHistory(exact)).rejects.toBe(decryptionError)
})
