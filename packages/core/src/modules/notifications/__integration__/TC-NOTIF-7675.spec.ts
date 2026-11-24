import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { cleanupLegacyNotificationCommands } from '../lib/legacyCommandCleanup'

let postgres: StartedTestContainer | undefined
let database: Kysely<never>
const tenantId = randomUUID()
const organizationId = randomUUID()
const before = '2026-10-20T00:00:00.000Z'
const commandAction = { id: 'approve', commandId: 'tests.approve' }
const linkAction = { id: 'view', href: '/backend/example' }
const options = { tenant: tenantId, before, apply: true, limit: 100 }

async function insertNotification(overrides: {
  tenant?: string
  org?: string | null
  createdAt?: string
  status?: string
  actionedAt?: string | null
  actionData?: unknown
} = {}) {
  const id = randomUUID()
  await sql`
    insert into notifications (id, tenant_id, organization_id, created_at, status, actioned_at, action_data)
    values (${id}::uuid, ${overrides.tenant ?? tenantId}::uuid,
      ${overrides.org === undefined ? organizationId : overrides.org}::uuid,
      ${overrides.createdAt ?? '2026-10-19T00:00:00Z'}::timestamptz,
      ${overrides.status ?? 'unread'}, ${overrides.actionedAt ?? null}::timestamptz,
      ${JSON.stringify(overrides.actionData === undefined ? { actions: [commandAction, linkAction], custom: 'retained' } : overrides.actionData)}::jsonb)
  `.execute(database)
  return id
}

test.beforeAll(async () => {
  postgres = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({ POSTGRES_DB: 'notification_cleanup', POSTGRES_USER: 'fixture', POSTGRES_PASSWORD: 'fixture' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start()
  database = new Kysely<never>({ dialect: new PostgresDialect({ pool: new Pool({
    host: postgres.getHost(), port: postgres.getMappedPort(5432),
    user: 'fixture', password: 'fixture', database: 'notification_cleanup',
  }) }) })
  await sql`
    create table notifications (
      id uuid primary key, tenant_id uuid not null, organization_id uuid,
      created_at timestamptz not null, status text not null, actioned_at timestamptz,
      action_data jsonb, dismissed_at timestamptz, expires_at timestamptz
    )
  `.execute(database)
})

test.beforeEach(async () => {
  await sql`truncate notifications`.execute(database)
})

test.afterAll(async () => {
  try {
    await database?.destroy()
  } finally {
    await postgres?.stop()
  }
})

test('previews without writes, then removes command actions while preserving links and metadata', async () => {
  const id = await insertNotification()
  expect(await cleanupLegacyNotificationCommands(database, { ...options, apply: false })).toEqual([
    { id, tenantId, organizationId },
  ])
  const original = (await sql<{ status: string; action_data: unknown }>`select * from notifications`.execute(database)).rows[0]
  expect(original.status).toBe('unread')
  expect(original.action_data).toEqual({ actions: [commandAction, linkAction], custom: 'retained' })
  expect(await cleanupLegacyNotificationCommands(database, options)).toHaveLength(1)
  const updated = (await sql<{ status: string; action_data: unknown; expires_at: Date; actioned_at: null }>`select * from notifications`.execute(database)).rows[0]
  expect(updated.status).toBe('dismissed')
  expect(updated.action_data).toEqual({ actions: [linkAction], custom: 'retained' })
  expect(updated.expires_at.getTime()).toBeLessThanOrEqual(Date.now())
  expect(updated.actioned_at).toBeNull()
  expect(await cleanupLegacyNotificationCommands(database, options)).toEqual([])
})

test('keeps scope, cutoff and claimed actions isolated and handles malformed legacy JSON', async () => {
  const target = await insertNotification({ status: 'read' })
  const dismissed = await insertNotification({ status: 'dismissed' })
  const retained = await Promise.all([
    insertNotification({ tenant: randomUUID() }),
    insertNotification({ org: randomUUID() }),
    insertNotification({ org: null }),
    insertNotification({ createdAt: before }),
    insertNotification({ createdAt: '2026-10-21T00:00:00Z' }),
    insertNotification({ actionedAt: '2026-10-19T01:00:00Z' }),
    insertNotification({ status: 'actioned' }),
    insertNotification({ actionData: null }),
    insertNotification({ actionData: { actions: 'malformed' } }),
    insertNotification({ actionData: { actions: [linkAction] } }),
  ])
  const result = await cleanupLegacyNotificationCommands(database, { ...options, org: organizationId })
  expect(result.map((notification) => notification.id).sort()).toEqual([target, dismissed].sort())
  const untouched = await sql<{ id: string }>`select id from notifications where action_data -> 'actions' @> ${JSON.stringify([commandAction])}::jsonb`.execute(database)
  expect(untouched.rows.map((notification) => notification.id).sort()).toEqual(retained.slice(0, 7).sort())
})

test('limits each batch and includes tenant-global rows only when no organization filter is supplied', async () => {
  const global = await insertNotification({ org: null })
  await insertNotification()
  expect(await cleanupLegacyNotificationCommands(database, { ...options, limit: 1 })).toHaveLength(1)
  expect(await cleanupLegacyNotificationCommands(database, options)).toHaveLength(1)
  expect(await cleanupLegacyNotificationCommands(database, options)).toEqual([])
  const row = (await sql<{ status: string }>`select status from notifications where id = ${global}::uuid`.execute(database)).rows[0]
  expect(row.status).toBe('dismissed')
})

test('skips rows locked by an action claim and leaves an already claimed action intact', async () => {
  const id = await insertNotification()
  await database.transaction().execute(async (transaction) => {
    await sql`select id from notifications where id = ${id}::uuid for update`.execute(transaction)
    expect(await cleanupLegacyNotificationCommands(database, { ...options, apply: false })).toEqual([
      { id, tenantId, organizationId },
    ])
    expect(await cleanupLegacyNotificationCommands(database, options)).toEqual([])
    await sql`update notifications set status = 'actioned', actioned_at = now() where id = ${id}::uuid`.execute(transaction)
  })
  expect(await cleanupLegacyNotificationCommands(database, options)).toEqual([])
  const row = (await sql<{ action_data: unknown }>`select action_data from notifications where id = ${id}::uuid`.execute(database)).rows[0]
  expect(row.action_data).toEqual({ actions: [commandAction, linkAction], custom: 'retained' })
})
