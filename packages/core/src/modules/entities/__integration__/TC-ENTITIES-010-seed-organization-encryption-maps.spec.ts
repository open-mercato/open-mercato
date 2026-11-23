import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from '@playwright/test'
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getDefaultEncryptionMaps } from '@open-mercato/shared/modules/registry'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import seedOrganizationEncryptionMaps from '@open-mercato/core/modules/entities/subscribers/seed-organization-encryption-maps'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(currentDir, '..', '..', '..', '..', '..', '..')
const appDir = path.join(repoRoot, 'apps', 'mercato')
const runtimeAppRoot = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT.trim())
  : appDir

if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(appDir, '.env') })
}

type PgClient = InstanceType<typeof Client>

async function withDatabase<T>(run: (client: PgClient) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('[internal] DATABASE_URL is required for TC-ENTITIES-010')
  const client = new Client({ connectionString })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

async function deleteMaps(tenantId: string): Promise<void> {
  await withDatabase(async (client) => {
    await client.query('delete from encryption_maps where tenant_id = $1', [tenantId])
  })
}

test.describe('TC-ENTITIES-010: a newly-created organization gets the init organization\'s encryption maps', () => {
  test('the directory.organization.created subscriber seeds every registered default map for the new org scope', async () => {
    // Bootstrapping the full app in-process (module registry, DI, ORM) costs most of the
    // default budget on a cold worker before the seeding scenario itself runs; the first
    // bootstrap in a worker can be CPU-contention-sensitive, so this needs more than
    // test.slow()'s 3x multiplier.
    test.setTimeout(150_000)
    const tenantId = randomUUID()
    const organizationId = randomUUID()

    try {
      await bootstrapFromAppRoot(runtimeAppRoot)
      const container = await createRequestContainer()

      const expectedEntityIds = getDefaultEncryptionMaps(getModules())
        .filter((map) => map.keyScope !== 'system')
        .map((map) => map.entityId)
        .sort()
      expect(expectedEntityIds.length).toBeGreaterThan(0)

      await seedOrganizationEncryptionMaps(
        { id: organizationId, tenantId, organizationId },
        { resolve: (name: string) => container.resolve(name) },
      )

      const rows = await withDatabase(async (client) => {
        const result = await client.query<{ entity_id: string; is_active: boolean }>(
          `select entity_id, is_active
             from encryption_maps
            where tenant_id = $1
              and organization_id = $2
              and deleted_at is null
            order by entity_id asc`,
          [tenantId, organizationId],
        )
        return result.rows
      })

      expect(rows.map((row) => row.entity_id).sort()).toEqual(expectedEntityIds)
      expect(rows.every((row) => row.is_active)).toBe(true)
    } finally {
      await deleteMaps(tenantId)
    }
  })

  test('the real event bus delivers the seeding subscriber inline on a persistent directory.organization.created emit, before any worker drains the queue', async () => {
    // Regression guard for the #7629 review finding: a `persistent: true` subscriber would be
    // skipped inline under single-delivery (the default) and would only run once an events
    // worker drains the queue — reopening #7591's plaintext-write window for every record
    // created in between. `seed-organization-encryption-maps.ts` is `persistent: false`
    // specifically so it runs inline. This test goes through the real, module-registered
    // `eventBus` (not the subscriber handler directly) and asserts the maps already exist the
    // moment `emit()` resolves — no worker involved — on a `persistent: true` emit, exactly
    // how `directory.organizations.create` emits `organizationCrudEvents`.
    test.setTimeout(150_000)
    const tenantId = randomUUID()
    const organizationId = randomUUID()

    try {
      await bootstrapFromAppRoot(runtimeAppRoot)
      const container = await createRequestContainer()
      const eventBus = container.resolve('eventBus') as {
        emit(event: string, payload: unknown, options?: Record<string, unknown>): Promise<void>
      }

      const expectedEntityIds = getDefaultEncryptionMaps(getModules())
        .filter((map) => map.keyScope !== 'system')
        .map((map) => map.entityId)
        .sort()
      expect(expectedEntityIds.length).toBeGreaterThan(0)

      await eventBus.emit(
        'directory.organization.created',
        { id: organizationId, tenantId, organizationId },
        { tenantId, organizationId, persistent: true },
      )

      const rows = await withDatabase(async (client) => {
        const result = await client.query<{ entity_id: string }>(
          `select entity_id
             from encryption_maps
            where tenant_id = $1
              and organization_id = $2
              and deleted_at is null
            order by entity_id asc`,
          [tenantId, organizationId],
        )
        return result.rows
      })

      expect(rows.map((row) => row.entity_id).sort()).toEqual(expectedEntityIds)
    } finally {
      await deleteMaps(tenantId)
    }
  })

  test('is idempotent when the organization-created event is redelivered', async () => {
    test.slow()
    const tenantId = randomUUID()
    const organizationId = randomUUID()

    try {
      await bootstrapFromAppRoot(runtimeAppRoot)
      const container = await createRequestContainer()
      const ctx = { resolve: (name: string) => container.resolve(name) }
      const payload = { id: organizationId, tenantId, organizationId }

      await seedOrganizationEncryptionMaps(payload, ctx)
      await seedOrganizationEncryptionMaps(payload, ctx)

      const state = await withDatabase(async (client) => {
        const result = await client.query(
          `select entity_id, count(*)::int as live_count
             from encryption_maps
            where tenant_id = $1
              and organization_id = $2
              and deleted_at is null
            group by entity_id
            having count(*) > 1`,
          [tenantId, organizationId],
        )
        return result.rows
      })

      expect(state).toEqual([])
    } finally {
      await deleteMaps(tenantId)
    }
  })
})
