import { randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM } from '@mikro-orm/postgresql'
import { importFromAppRuntime } from '@open-mercato/core/helpers/integration/appRuntime'
import type { AccessLogCreateInput } from '@open-mercato/core/modules/audit_logs/data/validators'

export async function withOverloadRuntime(run: (runtime: Awaited<ReturnType<typeof createRuntime>>) => Promise<void>): Promise<void> {
  const runtime = await createRuntime()
  try {
    await run(runtime)
  } finally {
    try {
      try {
        await runtime.flushAccessLog()
      } finally {
        runtime.resetAccessLogRuntimeStateForTests()
        await runtime.orm.em.getConnection().execute(`drop schema if exists "${runtime.schema}" cascade`)
      }
    } finally {
      try {
        await runtime.orm.close(true)
      } finally {
        runtime.restoreEnvironment()
      }
    }
  }
}

async function createRuntime() {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) throw new Error('[internal] Managed integration DATABASE_URL is required for audit overload coverage')
  const environment = {
    AUDIT_LOGS_MAX_PENDING: process.env.AUDIT_LOGS_MAX_PENDING,
    AUDIT_LOGS_ROTATE_INTERVAL_MS: process.env.AUDIT_LOGS_ROTATE_INTERVAL_MS,
    TENANT_DATA_ENCRYPTION: process.env.TENANT_DATA_ENCRYPTION,
  }
  const restoreEnvironment = () => {
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  process.env.AUDIT_LOGS_MAX_PENDING = '4'
  process.env.AUDIT_LOGS_ROTATE_INTERVAL_MS = '0'
  process.env.TENANT_DATA_ENCRYPTION = 'off'
  const schema = `audit_overload_${randomUUID().replaceAll('-', '')}`
  let orm: MikroORM | undefined
  try {
    const { AccessLog } = await importFromAppRuntime<typeof import('@open-mercato/core/modules/audit_logs/data/entities')>(
      '@open-mercato/core/modules/audit_logs/data/entities',
    )
    const serviceModule = await importFromAppRuntime<typeof import('@open-mercato/core/modules/audit_logs/services/accessLogService')>(
      '@open-mercato/core/modules/audit_logs/services/accessLogService',
    )
    serviceModule.resetAccessLogRuntimeStateForTests()
    orm = await MikroORM.init({
      clientUrl: databaseUrl,
      entities: [AccessLog],
      metadataProvider: ReflectMetadataProvider,
      schema,
      pool: { min: 0, max: 8 },
      driverOptions: { options: `-c search_path=${schema} -c statement_timeout=10000` },
    })
    await orm.schema.create()
    const [{ currentSchema }] = await orm.em.getConnection().execute<Array<{ currentSchema: string }>>(
      'select current_schema() as "currentSchema"',
    )
    expect(currentSchema).toBe(schema)
    const service = new serviceModule.AccessLogService(orm.em.fork())
    return { orm, schema, service, restoreEnvironment, ...serviceModule }
  } catch (error) {
    try {
      if (orm) {
        try {
          await orm.em.getConnection().execute(`drop schema if exists "${schema}" cascade`)
        } finally {
          await orm.close(true)
        }
      }
    } finally {
      restoreEnvironment()
    }
    throw error
  }
}

export function accessPayload(tenantId: string, organizationId: string): AccessLogCreateInput {
  return {
    tenantId, organizationId, resourceId: randomUUID(),
    resourceKind: 'audit_overload.fixture', accessType: 'read', fields: ['name'],
  }
}

export async function waitForBlockedAuditQuery(orm: MikroORM, blockerPid: number, operation: 'insert' | 'delete', count = 1): Promise<void> {
  await expect.poll(async () => {
    const rows = await orm.em.getConnection().execute<Array<{ count: string }>>(
      `select count(*)::text as count from pg_stat_activity
        where ? = any(pg_blocking_pids(pid)) and lower(ltrim(query)) like ?`,
      [blockerPid, `${operation}%`],
    )
    return Number(rows[0]?.count ?? 0)
  }).toBe(count)
}
