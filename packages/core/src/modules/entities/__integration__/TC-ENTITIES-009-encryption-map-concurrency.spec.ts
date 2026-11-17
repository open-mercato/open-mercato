import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from '@playwright/test'
import type { EntityManager } from '@mikro-orm/postgresql'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { upsertEncryptionMapSpecs } from '@open-mercato/core/modules/entities/cli'
import { invalidateEncryptionMapScopes } from '@open-mercato/core/modules/entities/lib/encryption-maps'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type { ModuleEncryptionFieldRule, ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { Migration20261004120000_encryption_map_scope_uniqueness } from '../migrations/Migration20261004120000_encryption_map_scope_uniqueness'

const execFileAsync = promisify(execFile)
const currentDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(currentDir, '..', '..', '..', '..', '..', '..')
const cliBin = path.join(repoRoot, 'packages', 'cli', 'dist', 'bin.js')
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
  if (!connectionString) throw new Error('[internal] DATABASE_URL is required for TC-ENTITIES-009')
  const client = new Client({ connectionString })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

async function deleteMaps(where: { tenantId: string; entityId?: string }): Promise<void> {
  await withDatabase(async (client) => {
    if (where.entityId) {
      await client.query('delete from encryption_maps where tenant_id = $1 and entity_id = $2', [where.tenantId, where.entityId])
      return
    }
    await client.query('delete from encryption_maps where tenant_id = $1', [where.tenantId])
  })
}

type EncryptionMapFixture = {
  entityId: string
  tenantId: string | null
  organizationId: string | null
  fields: ModuleEncryptionFieldRule[]
  deleted?: boolean
}

type EncryptionMapRow = {
  id: string
  tenant_id: string | null
  organization_id: string | null
  fields_json: ModuleEncryptionFieldRule[]
  updated_at: Date
  deleted_at: Date | null
}

async function insertMaps(fixtures: EncryptionMapFixture[]): Promise<string[]> {
  return withDatabase(async (client) => {
    const ids: string[] = []
    for (const fixture of fixtures) {
      const id = randomUUID()
      await client.query(
        `insert into encryption_maps
          (id, entity_id, tenant_id, organization_id, fields_json, is_active, created_at, updated_at, deleted_at)
         values ($1, $2, $3, $4, $5::jsonb, true, now() - interval '1 day', now() - interval '1 day',
                 case when $6::boolean then now() - interval '1 day' else null end)`,
        [id, fixture.entityId, fixture.tenantId, fixture.organizationId, JSON.stringify(fixture.fields), fixture.deleted === true],
      )
      ids.push(id)
    }
    return ids
  })
}

async function readMaps(entityId: string): Promise<Map<string, EncryptionMapRow>> {
  return withDatabase(async (client) => {
    const result = await client.query<EncryptionMapRow>(
      `select id, tenant_id, organization_id, fields_json, updated_at, deleted_at
         from encryption_maps
        where entity_id = $1`,
      [entityId],
    )
    return new Map(result.rows.map((row) => [row.id, row]))
  })
}

async function deleteEntityMaps(entityId: string): Promise<void> {
  await withDatabase(async (client) => {
    await client.query('delete from encryption_maps where entity_id = $1', [entityId])
  })
}

async function withEncryptionEnabled<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.TENANT_DATA_ENCRYPTION
  process.env.TENANT_DATA_ENCRYPTION = 'yes'
  try {
    return await run()
  } finally {
    if (previous === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = previous
  }
}

function uniqueEntityId(prefix: string): string {
  return `entities:${prefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
}

async function collectMigrationSql(): Promise<string[]> {
  const migration = Object.create(
    Migration20261004120000_encryption_map_scope_uniqueness.prototype,
  ) as Migration20261004120000_encryption_map_scope_uniqueness
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: (sql: string) => statements.push(sql),
  })
  await migration.up()
  return statements
}

test.describe('TC-ENTITIES-009: encryption map materialization is conflict-safe', () => {
  test('overlapping CLI seeders leave one active map in a tenant-global NULL organization scope', async () => {
    test.slow()
    const tenantId = randomUUID()
    const args = [cliBin, 'entities', 'seed-encryption', '--tenant', tenantId]
    const options = {
      cwd: appDir,
      env: {
        ...process.env,
        TENANT_DATA_ENCRYPTION: 'yes',
        FORCE_COLOR: '0',
        NODE_NO_WARNINGS: '1',
      },
    }

    try {
      const results = await Promise.all([
        execFileAsync(process.execPath, args, options),
        execFileAsync(process.execPath, args, options),
      ])
      for (const result of results) {
        expect(result.stdout).toContain('Encryption maps seeded')
      }

      const state = await withDatabase(async (client) => {
        const result = await client.query(
          `select count(*)::int as live_count,
                  count(*) filter (where is_active)::int as active_count,
                  bool_and(organization_id is null) as null_organization
             from encryption_maps
            where entity_id = 'auth:user'
              and tenant_id = $1
              and deleted_at is null`,
          [tenantId],
        )
        return result.rows[0]
      })

      expect(state).toMatchObject({ live_count: 1, active_count: 1, null_organization: true })
    } finally {
      await deleteMaps({ tenantId })
    }
  })

  test('overlapping API seeders leave one active organization-scoped canonical map', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(token)
    const entityId = `entities:encryption_race_${randomUUID().replaceAll('-', '').slice(0, 12)}`

    try {
      const responses = await Promise.all([
        apiRequest(request, 'POST', '/api/entities/encryption', {
          token,
          data: { entityId, fields: [{ field: 'first_secret' }], isActive: true },
        }),
        apiRequest(request, 'POST', '/api/entities/encryption', {
          token,
          data: { entityId, fields: [{ field: 'second_secret' }], isActive: true },
        }),
      ])
      expect(responses.map((response) => response.status())).toEqual([200, 200])

      const state = await withDatabase(async (client) => {
        const result = await client.query(
          `select count(*)::int as live_count,
                  count(*) filter (where is_active)::int as active_count,
                  min(id::text) as canonical_id
             from encryption_maps
            where entity_id = $1
              and tenant_id = $2
              and organization_id is not distinct from $3
              and deleted_at is null`,
          [entityId, tenantId, organizationId],
        )
        return result.rows[0]
      })

      expect(state.live_count).toBe(1)
      expect(state.active_count).toBe(1)
      expect(state.canonical_id).toMatch(/^[0-9a-f-]{36}$/)
    } finally {
      await deleteMaps({ tenantId, entityId })
    }
  })

  test('migration deterministically merges existing global duplicates before enforcing uniqueness', async () => {
    await withDatabase(async (client) => {
      await client.query('create temporary table encryption_maps_dedup_test (like encryption_maps including defaults)')
      await client.query(
        `insert into encryption_maps_dedup_test
          (id, entity_id, tenant_id, organization_id, fields_json, is_active, created_at, updated_at, deleted_at)
         values
          ('00000000-0000-0000-0000-000000000001', 'test:legacy_duplicate', null, null,
           '[{"field":"inactive_only"},{"field":"email","hashField":"inactive_hash"}]'::jsonb,
           false, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', null),
          ('00000000-0000-0000-0000-000000000002', 'test:legacy_duplicate', null, null,
           '[{"field":"email"},{"field":"phone"}]'::jsonb,
           true, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', null),
          ('00000000-0000-0000-0000-000000000003', 'test:legacy_duplicate', null, null,
           '[{"field":"email","hashField":"active_hash"},{"field":"display_name"}]'::jsonb,
           true, '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z', null)`,
      )

      const statements = await collectMigrationSql()
      for (const statement of statements) {
        await client.query(
          statement
            .replaceAll('"encryption_maps"', '"encryption_maps_dedup_test"')
            .replaceAll('"encryption_maps_entity_scope_live_unique"', '"encryption_maps_dedup_test_live_unique"'),
        )
      }

      const result = await client.query(
        `select id, fields_json, is_active, deleted_at
           from encryption_maps_dedup_test
          order by created_at asc, id asc`,
      )
      expect(result.rows).toHaveLength(3)
      expect(result.rows[0]).toMatchObject({
        id: '00000000-0000-0000-0000-000000000001',
        is_active: true,
        deleted_at: null,
        fields_json: [
          { field: 'display_name' },
          { field: 'email', hashField: 'active_hash' },
          { field: 'phone' },
        ],
      })
      expect(result.rows.slice(1).every((row) => row.is_active === false && row.deleted_at instanceof Date)).toBe(true)

      await expect(client.query(
        `insert into encryption_maps_dedup_test
          (id, entity_id, tenant_id, organization_id, fields_json, is_active, created_at, updated_at, deleted_at)
         values
          ('00000000-0000-0000-0000-000000000004', 'test:legacy_duplicate', null, null,
           '[]'::jsonb, true, now(), now(), null)`,
      )).rejects.toMatchObject({ code: '23505' })
    })
  })

  test('an outer upgrade transaction rollback removes its encryption-map write', async () => {
    // Bootstrapping the full app in-process (module registry, DI, ORM) costs most of the
    // default budget on a cold worker before the rollback scenario itself runs.
    test.slow()
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const entityId = `entities:rollback_${randomUUID().replaceAll('-', '').slice(0, 12)}`
    const rollbackError = new Error('TC-ENTITIES-009 deliberate outer transaction rollback')

    try {
      await bootstrapFromAppRoot(runtimeAppRoot)
      const container = await createRequestContainer()
      const em = container.resolve<EntityManager>('em')

      await expect(em.transactional(async (transactionalEm) => {
        await upsertEncryptionMapSpecs(
          transactionalEm,
          tenantId,
          organizationId,
          [{ entityId, fields: [{ field: 'secret' }] }],
        )
        throw rollbackError
      })).rejects.toBe(rollbackError)

      const state = await withDatabase(async (client) => {
        const result = await client.query(
          `select count(*)::int as live_count
             from encryption_maps
            where entity_id = $1
              and tenant_id = $2
              and organization_id is not distinct from $3
              and deleted_at is null`,
          [entityId, tenantId, organizationId],
        )
        return result.rows[0]
      })

      expect(state).toMatchObject({ live_count: 0 })
    } finally {
      await deleteMaps({ tenantId, entityId })
    }
  })

  test('a tenant-wide seed appends a missing rule to existing organization maps exactly once under repeated and overlapping runs', async () => {
    test.slow()
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const entityId = uniqueEntityId('org_append')
    const specs: ModuleEncryptionMap[] = [{
      entityId,
      fields: [{ field: 'email', hashField: 'email_hash' }, { field: 'phone' }],
    }]

    try {
      const [organizationMapId, ...controlIds] = await insertMaps([
        {
          entityId,
          tenantId,
          organizationId,
          fields: [{ field: 'email', hashField: 'legacy_email_hash' }, { field: 'admin_note' }],
        },
        { entityId, tenantId: null, organizationId: null, fields: [{ field: 'email' }] },
        { entityId, tenantId: randomUUID(), organizationId: randomUUID(), fields: [{ field: 'email' }] },
        { entityId, tenantId, organizationId: randomUUID(), fields: [{ field: 'email' }], deleted: true },
      ])
      const before = await readMaps(entityId)

      await withEncryptionEnabled(async () => {
        await bootstrapFromAppRoot(runtimeAppRoot)
        const container = await createRequestContainer()
        const em = container.resolve<EntityManager>('em')
        const encryptionService = container.resolve<TenantDataEncryptionService>('tenantEncryptionService')
        const resolveOrganizationFields = () => encryptionService.getEncryptedFieldNames(
          entityId,
          tenantId,
          organizationId,
          { ignoreRuntimeHealth: true },
        )
        const seedTenantWide = () => upsertEncryptionMapSpecs(em.fork(), tenantId, null, specs, () => {}, async (scope) => {
          await invalidateEncryptionMapScopes(encryptionService, [scope])
        })

        expect(await resolveOrganizationFields()).not.toContain('phone')

        const overlapping = await Promise.all([seedTenantWide(), seedTenantWide(), seedTenantWide()])
        const organizationReports = overlapping.flat().filter((scope) => scope.organizationId === organizationId)
        expect(organizationReports).toEqual([{ entityId, tenantId, organizationId }])

        const repeated = await seedTenantWide()
        expect(repeated).toEqual([{ entityId, tenantId, organizationId: null }])

        expect(await resolveOrganizationFields()).toEqual(['email', 'admin_note', 'phone'])
      })

      const after = await readMaps(entityId)
      expect(after.get(organizationMapId)?.fields_json).toEqual([
        { field: 'email', hashField: 'legacy_email_hash' },
        { field: 'admin_note' },
        { field: 'phone' },
      ])
      for (const controlId of controlIds) {
        expect(after.get(controlId)).toEqual(before.get(controlId))
      }
      const tenantMaps = [...after.values()].filter((row) => (
        row.tenant_id === tenantId && row.organization_id === null && row.deleted_at === null
      ))
      expect(tenantMaps.map((row) => row.fields_json)).toEqual([specs[0].fields])
    } finally {
      await deleteEntityMaps(entityId)
    }
  })

  test('an outer transaction rollback discards a tenant-wide organization-map append and its deferred invalidation', async () => {
    test.slow()
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const entityId = uniqueEntityId('org_append_rollback')
    const specs: ModuleEncryptionMap[] = [{ entityId, fields: [{ field: 'email' }, { field: 'phone' }] }]
    const rollbackError = new Error('TC-ENTITIES-009 deliberate outer transaction rollback')

    try {
      const [organizationMapId] = await insertMaps([
        { entityId, tenantId, organizationId, fields: [{ field: 'email' }] },
      ])
      const before = await readMaps(entityId)

      await withEncryptionEnabled(async () => {
        await bootstrapFromAppRoot(runtimeAppRoot)
        const container = await createRequestContainer()
        const em = container.resolve<EntityManager>('em')
        const encryptionService = container.resolve<TenantDataEncryptionService>('tenantEncryptionService')
        const afterCommitCallbacks: Array<() => Promise<void>> = []
        const invalidatedScopes: unknown[] = []
        const recordingService = {
          invalidateMap: async (scopeEntityId: string, scopeTenantId: string | null, scopeOrganizationId: string | null) => {
            invalidatedScopes.push({ entityId: scopeEntityId, tenantId: scopeTenantId, organizationId: scopeOrganizationId })
            await encryptionService.invalidateMap(scopeEntityId, scopeTenantId, scopeOrganizationId)
          },
        }

        await expect(em.transactional(async (transactionalEm) => {
          const scopes = await upsertEncryptionMapSpecs(transactionalEm, tenantId, null, specs)
          expect(scopes).toContainEqual({ entityId, tenantId, organizationId })
          expect(await encryptionService.getEncryptedFieldNames(entityId, tenantId, organizationId, {
            ignoreRuntimeHealth: true,
            em: transactionalEm,
          })).toEqual(['email', 'phone'])
          afterCommitCallbacks.push(() => invalidateEncryptionMapScopes(recordingService, scopes))
          throw rollbackError
        })).rejects.toBe(rollbackError)

        expect(afterCommitCallbacks).toHaveLength(1)
        expect(invalidatedScopes).toEqual([])
        expect(await encryptionService.getEncryptedFieldNames(entityId, tenantId, organizationId, {
          ignoreRuntimeHealth: true,
          em: em.fork(),
        })).toEqual(['email'])
      })

      const after = await readMaps(entityId)
      expect(after.size).toBe(1)
      expect(after.get(organizationMapId)).toEqual(before.get(organizationMapId))
    } finally {
      await deleteEntityMaps(entityId)
    }
  })
})
