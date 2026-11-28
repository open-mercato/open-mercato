import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from '@playwright/test'
import { Migration20261109120000 } from '../migrations/Migration20261109120000'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(currentDir, '..', '..', '..', '..', '..', '..')
const appDir = path.join(repoRoot, 'apps', 'mercato')
const runtimeAppRoot = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT.trim())
  : appDir

if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(runtimeAppRoot, '.env') })
}

type PgClient = InstanceType<typeof Client>

async function withDatabase<T>(run: (client: PgClient) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('[internal] DATABASE_URL is required for TC-CHKT-044')
  const client = new Client({ connectionString })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

async function collectMigrationSql(): Promise<string[]> {
  const migration = Object.create(Migration20261109120000.prototype) as Migration20261109120000
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: (sql: string) => statements.push(sql),
  })
  await migration.up()
  return statements
}

async function runMigrationAgainst(client: PgClient, tableName: string): Promise<void> {
  for (const statement of await collectMigrationSql()) {
    await client.query(statement.replaceAll('"encryption_maps"', `"${tableName}"`))
  }
}

test.describe('TC-CHKT-044: checkout encryption map backfill migration', () => {
  test('backfills missing maps, appends missing fields while preserving custom ones, skips disabled tenants, and is idempotent', async () => {
    await withDatabase(async (client) => {
      const tableName = 'encryption_maps_checkout_backfill_test'
      await client.query(`create temporary table ${tableName} (like encryption_maps including defaults)`)

      const tenantWithEncryption = '00000000-0000-0000-0000-00000000a001'
      const tenantWithoutEncryption = '00000000-0000-0000-0000-00000000a002'

      // Tenant with active encryption already has a map for an unrelated entity (marks the scope as
      // "has active maps", which is what the backfill's src subquery selects on), and a
      // checkout_transaction map an admin already customized (missing declared fields, plus one of
      // their own that must survive untouched).
      await client.query(
        `insert into ${tableName}
          (id, entity_id, tenant_id, organization_id, fields_json, is_active, created_at, updated_at, deleted_at)
         values
          ('10000000-0000-0000-0000-000000000001', 'auth:user', $1, null,
           '[{"field":"email"}]'::jsonb, true, now(), now(), null),
          ('10000000-0000-0000-0000-000000000002', 'checkout:checkout_transaction', $1, null,
           '[{"field":"customer_data"},{"field":"admin_custom_field"}]'::jsonb, true, now(), now(), null)`,
        [tenantWithEncryption],
      )

      // Tenant without any active map (encryption disabled) must stay untouched.
      await client.query(
        `insert into ${tableName}
          (id, entity_id, tenant_id, organization_id, fields_json, is_active, created_at, updated_at, deleted_at)
         values
          ('10000000-0000-0000-0000-000000000003', 'auth:user', $1, null,
           '[{"field":"email"}]'::jsonb, false, now(), now(), null)`,
        [tenantWithoutEncryption],
      )

      await runMigrationAgainst(client, tableName)

      const linkTemplate = await client.query(
        `select fields_json from ${tableName} where entity_id = 'checkout:checkout_link_template' and tenant_id = $1 and deleted_at is null`,
        [tenantWithEncryption],
      )
      expect(linkTemplate.rows).toHaveLength(1)
      expect(linkTemplate.rows[0].fields_json).toEqual([{ field: 'gateway_settings' }])

      const link = await client.query(
        `select fields_json from ${tableName} where entity_id = 'checkout:checkout_link' and tenant_id = $1 and deleted_at is null`,
        [tenantWithEncryption],
      )
      expect(link.rows).toHaveLength(1)
      expect(link.rows[0].fields_json).toEqual([{ field: 'gateway_settings' }])

      const transaction = await client.query(
        `select fields_json from ${tableName} where entity_id = 'checkout:checkout_transaction' and tenant_id = $1 and deleted_at is null`,
        [tenantWithEncryption],
      )
      expect(transaction.rows).toHaveLength(1)
      const transactionFields = (transaction.rows[0].fields_json as Array<{ field: string }>).map((rule) => rule.field)
      expect(transactionFields).toEqual(
        expect.arrayContaining([
          'customer_data',
          'admin_custom_field',
          'first_name',
          'last_name',
          'email',
          'phone',
          'accepted_legal_consents',
          'ip_address',
        ]),
      )
      expect(transactionFields).toHaveLength(8)

      const disabledTenantRows = await client.query(
        `select entity_id from ${tableName} where tenant_id = $1 and entity_id like 'checkout:%'`,
        [tenantWithoutEncryption],
      )
      expect(disabledTenantRows.rows).toHaveLength(0)

      // Re-running must be a no-op: no duplicate rows, no duplicate field entries.
      await runMigrationAgainst(client, tableName)

      const linkTemplateAfterRerun = await client.query(
        `select fields_json from ${tableName} where entity_id = 'checkout:checkout_link_template' and tenant_id = $1 and deleted_at is null`,
        [tenantWithEncryption],
      )
      expect(linkTemplateAfterRerun.rows).toHaveLength(1)

      const transactionAfterRerun = await client.query(
        `select fields_json from ${tableName} where entity_id = 'checkout:checkout_transaction' and tenant_id = $1 and deleted_at is null`,
        [tenantWithEncryption],
      )
      expect(transactionAfterRerun.rows).toHaveLength(1)
      expect((transactionAfterRerun.rows[0].fields_json as Array<{ field: string }>)).toHaveLength(8)
    })
  })
})
