import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { expect, test } from '@playwright/test'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM } from '@mikro-orm/postgresql'
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader'
import { AccessLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import { EncryptionMap } from '@open-mercato/core/modules/entities/data/entities'

export const integrationMeta = { dependsOnModules: ['audit_logs', 'entities'] }

loadEnv({ path: path.resolve(process.cwd(), 'apps/mercato/.env') })

test('TC-AUD-8182: access-log writes see committed encryption policy changes and read policy once per batch', async () => {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) throw new Error('[internal] Managed integration DATABASE_URL is required for TC-AUD-8182')
  const previous = {
    enabled: process.env.TENANT_DATA_ENCRYPTION,
    key: process.env.TENANT_DATA_ENCRYPTION_KEY,
    maxPending: process.env.AUDIT_LOGS_MAX_PENDING,
    rotate: process.env.AUDIT_LOGS_ROTATE_INTERVAL_MS,
  }
  process.env.TENANT_DATA_ENCRYPTION = 'yes'
  process.env.TENANT_DATA_ENCRYPTION_KEY = 'audit-log-integration-test-encryption-key'
  process.env.AUDIT_LOGS_MAX_PENDING = '100'
  process.env.AUDIT_LOGS_ROTATE_INTERVAL_MS = '60000'
  const schema = `audit_encryption_${randomUUID().replaceAll('-', '')}`
  let orm: MikroORM | undefined
  let resetRuntimeState: (() => void) | undefined
  try {
    await bootstrapFromAppRoot(process.env.OM_TEST_APP_ROOT?.trim() || 'apps/mercato')
    orm = await MikroORM.init({
      clientUrl: databaseUrl,
      entities: [AccessLog, EncryptionMap],
      metadataProvider: ReflectMetadataProvider,
      schema,
      pool: { min: 0, max: 8 },
      driverOptions: { options: `-c search_path=${schema} -c statement_timeout=10000` },
    })
    await orm.schema.create()
    const [{ currentSchema }] = await orm.em.getConnection().execute<Array<{ currentSchema: string }>>('select current_schema() as "currentSchema"')
    expect(currentSchema).toBe(schema)
    const serviceModule = await import('@open-mercato/core/modules/audit_logs/services/accessLogService')
    serviceModule.resetAccessLogRuntimeStateForTests()
    resetRuntimeState = serviceModule.resetAccessLogRuntimeStateForTests
    const em = orm.em.fork()
    const originalFork = em.fork.bind(em)
    let policyReads = 0
    em.fork = ((options?: unknown) => {
      const fork = originalFork(options as never)
      const originalExecute = fork.execute.bind(fork)
      fork.execute = ((sql: string, params?: unknown[]) => {
        if (sql.toLowerCase().includes('from encryption_maps')) policyReads += 1
        return originalExecute(sql, params)
      }) as typeof fork.execute
      return fork
    }) as typeof em.fork
    const service = new serviceModule.AccessLogService(em)
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const mapId = randomUUID()
    await orm.em.getConnection().execute(
      `insert into encryption_maps (id, entity_id, tenant_id, organization_id, fields_json, is_active, created_at, updated_at)
       values (?, 'audit_logs:access_log', ?, ?, '[{"field":"resource_id"}]'::jsonb, true, now(), now())`,
      [mapId, tenantId, organizationId],
    )
    const createInput = (resourceId: string) => ({
      tenantId,
      organizationId,
      resourceKind: 'audit_logs.encryption_policy_fixture',
      resourceId,
      accessType: 'read',
      fields: ['name'],
      context: { marker: 'policy-test' },
    })
    const firstId = randomUUID()
    const secondId = randomUUID()
    const batchIds = [randomUUID(), randomUUID(), randomUUID()]
    expect(await service.log(createInput(firstId))).not.toBeNull()
    const firstRow = await orm.em.getConnection().execute<Array<{ resource_id: string }>>(
      'select resource_id from access_logs where tenant_id = ? and resource_kind = ? and resource_id like ?',
      [tenantId, 'audit_logs.encryption_policy_fixture', '%:v1'],
    )
    expect(firstRow).toHaveLength(1)
    expect(firstRow[0].resource_id).toMatch(/:v1$/)
    expect(firstRow[0].resource_id).not.toBe(firstId)

    await orm.em.getConnection().execute(
      'update encryption_maps set fields_json = \'[]\'::jsonb, updated_at = now() where id = ?',
      [mapId],
    )
    expect(await service.log(createInput(secondId))).not.toBeNull()
    const writtenBatch = await service.logMany(batchIds.map(createInput))
    expect(writtenBatch).toBe(batchIds.length)
    expect(policyReads).toBe(3)
    const rows = await orm.em.getConnection().execute<Array<{ resource_id: string }>>(
      'select resource_id from access_logs where tenant_id = ? and resource_kind = ? order by created_at asc',
      [tenantId, 'audit_logs.encryption_policy_fixture'],
    )
    expect(rows).toHaveLength(2 + batchIds.length)
    expect(rows.filter((row) => row.resource_id.endsWith(':v1'))).toHaveLength(1)
    expect(rows.map((row) => row.resource_id).filter((resourceId) => !resourceId.endsWith(':v1')).sort())
      .toEqual([secondId, ...batchIds].sort())
  } finally {
    try {
      if (orm) {
        const em = orm.em.getConnection()
        await em.execute(`drop schema if exists "${schema}" cascade`)
        await orm.close(true)
      }
    } finally {
      resetRuntimeState?.()
      restore('TENANT_DATA_ENCRYPTION', previous.enabled)
      restore('TENANT_DATA_ENCRYPTION_KEY', previous.key)
      restore('AUDIT_LOGS_MAX_PENDING', previous.maxPending)
      restore('AUDIT_LOGS_ROTATE_INTERVAL_MS', previous.rotate)
    }
  }
})

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

