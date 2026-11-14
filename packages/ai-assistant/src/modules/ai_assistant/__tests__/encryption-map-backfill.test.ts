import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill'
import { Client } from 'pg'
import { defaultEncryptionMaps } from '../encryption'
import { Migration20261108000000_ai_assistant_encryption_backfill } from '../migrations/Migration20261108000000_ai_assistant_encryption_backfill'

function collectSql(direction: 'up' | 'down'): string[] {
  const migration = Object.create(
    Migration20261108000000_ai_assistant_encryption_backfill.prototype,
  ) as Migration20261108000000_ai_assistant_encryption_backfill
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: (sql: string) => statements.push(sql),
  })
  migration[direction]()
  return statements
}

describe('AI assistant encryption upgrade', () => {
  it('backfills every shipped map for pre-existing encryption scopes', () => {
    expect(collectSql('up')).toEqual(defaultEncryptionMaps.map(buildEncryptionMapBackfillSql))
    expect(collectSql('up')).toHaveLength(3)
  })

  it('uses guarded SQL that preserves scoped custom rules and supports repeated upgrades', () => {
    for (const sql of collectSql('up')) {
      expect(sql).toContain("to_regclass('encryption_maps') is null")
      expect(sql).toContain('where "is_active" = true and "deleted_at" is null')
      expect(sql).toContain('src."tenant_id", src."organization_id"')
      expect(sql).toContain('not exists')
      expect(sql).toContain('coalesce("fields_json", \'[]\'::jsonb) ||')
      expect(sql).not.toMatch(/delete from|drop table/i)
    }
  })

  it('never removes encryption maps on downgrade', () => {
    expect(collectSql('down')).toEqual([])
  })
})

const postgresTest = process.env.OM_ENCRYPTION_BACKFILL_TEST_URL ? it : it.skip

postgresTest('upgrades existing PostgreSQL scopes idempotently without removing custom rules', async () => {
  const client = new Client({ connectionString: process.env.OM_ENCRYPTION_BACKFILL_TEST_URL })
  await client.connect()
  try {
    await client.query('begin')
    await client.query('set local search_path to pg_temp')
    await client.query(`create temporary table encryption_maps (
      id uuid primary key default gen_random_uuid(), entity_id text not null,
      tenant_id uuid, organization_id uuid, fields_json jsonb, is_active boolean not null,
      created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz
    )`)
    const tenantId = '11111111-1111-4111-8111-111111111111'
    const organizationId = '22222222-2222-4222-8222-222222222222'
    const disabledTenantId = '33333333-3333-4333-8333-333333333333'
    await client.query(`insert into encryption_maps (entity_id, tenant_id, organization_id, fields_json, is_active)
      values ('existing:entity', $1, $2, '[]', true),
        ('existing:entity', $1, null, '[]', true),
        ('existing:entity', $3, null, '[]', false),
        ('ai_assistant:ai_chat_message', $1, $2, '[{"field":"content","hashField":"custom_hash"},{"field":"custom"}]', true)`,
    [tenantId, organizationId, disabledTenantId])

    for (const sql of collectSql('up')) await client.query(sql)
    const first = await client.query<{ tenant_id: string; organization_id: string | null; entity_id: string; fields_json: Array<{ field: string; hashField?: string }> }>(
      "select tenant_id, organization_id, entity_id, fields_json from encryption_maps where entity_id like 'ai_assistant:%' order by entity_id, organization_id nulls first",
    )
    expect(first.rows).toHaveLength(6)
    expect(first.rows.every((row) => row.tenant_id === tenantId)).toBe(true)
    for (const map of defaultEncryptionMaps) {
      const rows = first.rows.filter((row) => row.entity_id === map.entityId)
      expect(rows.map((row) => row.organization_id)).toEqual([null, organizationId])
      for (const row of rows) expect(row.fields_json).toEqual(expect.arrayContaining(map.fields.map((rule) => expect.objectContaining(rule))))
    }
    const customized = first.rows.find((row) => row.entity_id === 'ai_assistant:ai_chat_message' && row.organization_id === organizationId)
    expect(customized?.fields_json).toContainEqual({ field: 'content', hashField: 'custom_hash' })
    expect(customized?.fields_json).toContainEqual({ field: 'custom' })
    for (const sql of collectSql('up')) await client.query(sql)
    const repeated = await client.query("select tenant_id, organization_id, entity_id, fields_json from encryption_maps where entity_id like 'ai_assistant:%' order by entity_id, organization_id nulls first")
    expect(repeated.rows).toEqual(first.rows)
  } finally {
    await client.query('rollback')
    await client.end()
  }
})
