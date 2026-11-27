import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { Migration20260121082330 } from '../migrations/Migration20260121082330'
import { Migration20260121142334 } from '../migrations/Migration20260121142334'
import { Migration20260608231000 } from '../migrations/Migration20260608231000'
import { Migration20261020142226_resources } from '../migrations/Migration20261020142226_resources'

const tables = [
  'resources_resources',
  'resources_resource_activities',
  'resources_resource_comments',
  'resources_resource_tags',
  'resources_resource_tag_assignments',
  'resources_resource_types',
] as const

type QueuedMigration = {
  reset(): void
  up(): void | Promise<void>
  down(): void | Promise<void>
  getQueries(): unknown[]
}

async function applyMigration(client: IntegrationDbClient, migration: QueuedMigration, direction: 'up' | 'down'): Promise<void> {
  migration.reset()
  await migration[direction]()
  for (const statement of migration.getQueries()) {
    expect(typeof statement).toBe('string')
    await client.query(String(statement))
  }
}

async function readSchema(client: IntegrationDbClient, schema: string) {
  const columns = await client.query(
    `select table_name, column_name, data_type, is_nullable, column_default, datetime_precision
       from information_schema.columns where table_schema = $1 order by table_name, column_name`,
    [schema],
  )
  const constraints = await client.query(
    `select relation.relname as table_name, constraint_record.conname, pg_get_constraintdef(constraint_record.oid) as definition
       from pg_constraint constraint_record
       join pg_class relation on relation.oid = constraint_record.conrelid
       where relation.relnamespace = $1::regnamespace order by relation.relname, constraint_record.conname`,
    [schema],
  )
  const indexes = await client.query(
    'select tablename, indexname, indexdef from pg_indexes where schemaname = $1 order by tablename, indexname',
    [schema],
  )
  return { columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows }
}

async function readPreservedRows(client: IntegrationDbClient) {
  const snapshots: Record<string, unknown> = {}
  for (const table of tables) {
    const projection = table === 'resources_resource_activities' ? "to_jsonb(record) - 'deleted_at'" : 'to_jsonb(record)'
    snapshots[table] = (await client.query(`select ${projection} as record from ${table} record order by id`)).rows
  }
  return snapshots
}

test.describe('TC-RES-7667-MIGRATION: disposable resources migration round trip', () => {
  test('up/down/up changes only nullable activity deleted_at and preserves unrelated rows, columns, constraints and indexes', async () => {
    await withClient(async (client) => {
      const schema = `resources_7667_${randomUUID().replace(/-/g, '')}`
      await client.query('begin')
      try {
        await client.query("set local statement_timeout = '5s'")
        await client.query(`create schema "${schema}"`)
        await client.query("select set_config('search_path', $1, true)", [schema])
        expect((await client.query<{ current_schema: string }>('select current_schema()')).rows[0]?.current_schema).toBe(schema)

        for (const MigrationClass of [Migration20260121082330, Migration20260121142334, Migration20260608231000]) {
          const baseline = new MigrationClass(
            {} as ConstructorParameters<typeof MigrationClass>[0],
            {} as ConstructorParameters<typeof MigrationClass>[1],
          )
          await applyMigration(client, baseline, 'up')
        }

        const tenantId = randomUUID()
        const activityIds: string[] = []
        for (const scope of [
          { tenantId, organizationId: randomUUID() },
          { tenantId, organizationId: randomUUID() },
          { tenantId: randomUUID(), organizationId: randomUUID() },
        ]) {
          const resourceId = randomUUID()
          const activityId = randomUUID()
          const tagId = randomUUID()
          const typeId = randomUUID()
          activityIds.push(activityId)
          await client.query(
            `insert into resources_resource_types (id, tenant_id, organization_id, name, created_at, updated_at)
             values ($1, $2, $3, 'Preserved type', now(), now())`,
            [typeId, scope.tenantId, scope.organizationId],
          )
          await client.query(
            `insert into resources_resources (id, tenant_id, organization_id, name, resource_type_id, custom_fieldset_code, created_at, updated_at)
             values ($1, $2, $3, 'Preserved resource', $4, 'retained-fieldset', now(), now())`,
            [resourceId, scope.tenantId, scope.organizationId, typeId],
          )
          await client.query(
            `insert into resources_resource_activities
               (id, tenant_id, organization_id, resource_id, activity_type, body, occurred_at, created_at, updated_at)
             values ($1, $2, $3, $4, 'meeting', 'Preserved activity', '2026-10-01T08:30:00Z', now(), now())`,
            [activityId, scope.tenantId, scope.organizationId, resourceId],
          )
          await client.query(
            `insert into resources_resource_comments (id, tenant_id, organization_id, resource_id, body, deleted_at, created_at, updated_at)
             values ($1, $2, $3, $4, 'Preserved hidden comment', '2026-10-02T08:30:00Z', now(), now())`,
            [randomUUID(), scope.tenantId, scope.organizationId, resourceId],
          )
          await client.query(
            `insert into resources_resource_tags (id, tenant_id, organization_id, slug, label, created_at, updated_at)
             values ($1, $2, $3, 'preserved-tag', 'Preserved tag', now(), now())`,
            [tagId, scope.tenantId, scope.organizationId],
          )
          await client.query(
            `insert into resources_resource_tag_assignments (id, tenant_id, organization_id, resource_id, tag_id, created_at, updated_at)
             values ($1, $2, $3, $4, $5, now(), now())`,
            [randomUUID(), scope.tenantId, scope.organizationId, resourceId, tagId],
          )
        }

        const beforeSchema = await readSchema(client, schema)
        const beforeRows = await readPreservedRows(client)
        const migration = new Migration20261020142226_resources(
          {} as ConstructorParameters<typeof Migration20261020142226_resources>[0],
          {} as ConstructorParameters<typeof Migration20261020142226_resources>[1],
        )
        for (const direction of ['up', 'down', 'up'] as const) {
          await applyMigration(client, migration, direction)
          const afterSchema = await readSchema(client, schema)
          const markerColumns = afterSchema.columns.filter((column) => (
            column.table_name === 'resources_resource_activities' && column.column_name === 'deleted_at'
          ))
          expect({
            ...afterSchema,
            columns: afterSchema.columns.filter((column) => !markerColumns.includes(column)),
          }, `${direction} preserves every unrelated schema attribute`).toEqual(beforeSchema)
          expect(await readPreservedRows(client), `${direction} preserves every stored row and reference`).toEqual(beforeRows)
          if (direction === 'down') {
            expect(markerColumns, 'down removes the activity marker').toEqual([])
          } else {
            expect(markerColumns).toEqual([{
              table_name: 'resources_resource_activities', column_name: 'deleted_at', data_type: 'timestamp with time zone',
              is_nullable: 'YES', column_default: null, datetime_precision: 6,
            }])
            expect((await client.query('select deleted_at from resources_resource_activities order by id')).rows)
              .toEqual(activityIds.map(() => ({ deleted_at: null })))
            await client.query('update resources_resource_activities set deleted_at = $2 where id = $1', [activityIds[0], '2026-10-03T08:30:00Z'])
            expect((await client.query<{ deleted_at: Date }>('select deleted_at from resources_resource_activities where id = $1', [activityIds[0]])).rows[0]?.deleted_at.toISOString())
              .toBe('2026-10-03T08:30:00.000Z')
            await client.query('update resources_resource_activities set deleted_at = null where id = $1', [activityIds[1]])
          }
        }
      } finally {
        await client.query('rollback')
      }
      expect((await client.query('select nspname from pg_namespace where nspname = $1', [schema])).rows, 'rollback removes the disposable schema').toEqual([])
    })
  })
})
