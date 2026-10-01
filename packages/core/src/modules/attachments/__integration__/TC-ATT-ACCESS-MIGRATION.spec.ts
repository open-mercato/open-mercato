import { expect, test } from '@playwright/test'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { Migration20261001120000_attachments } from '../migrations/Migration20261001120000_attachments'

test('owner policy migration protects historical Documents references without importing Documents', async () => {
  if (!process.env.DATABASE_URL?.trim()) throw new Error('[internal] Managed integration DATABASE_URL is required')
  await withClient(async (client) => {
    await client.query('begin')
    try {
      await client.query(`create temporary table attachment_partitions (
        code text primary key, updated_at timestamptz default now(), access_resolver_requirements jsonb
      ) on commit drop`)
      await client.query(`create temporary table attachments (
        partition_code text, entity_id text, storage_metadata jsonb
      ) on commit drop`)
      const previous = [{ resolverId: 'clinical.files', targetEntity: 'clinical.patient' }]
      for (const code of ['primary', 'array', 'legacy', 'malformed-owner', 'unrelated', 'invalid-policy']) {
        await client.query('insert into attachment_partitions (code, access_resolver_requirements) values ($1, $2::jsonb)', [
          code, JSON.stringify(code === 'invalid-policy' ? { invalid: true } : previous),
        ])
      }
      const rows = [
        ['primary', ' documents:document ', null],
        ['primary', 'sync_excel:import', { assignments: 'malformed' }],
        ['array', 'sync_excel:import', { assignments: [null, 42, 'bad', { type: ' documents:document ', id: 'record' }] }],
        ['legacy', 'sync_excel:import', { assignments: { type: 'documents:document', id: 'record' } }],
        ['malformed-owner', 'sync_excel:import', { assignments: { type: 'documents:document' } }],
        ['unrelated', 'sync_excel:import', { assignments: [null, { type: 'sync_excel:import' }] }],
        ['invalid-policy', 'documents:document', null],
      ]
      for (const [partition, entity, metadata] of rows) {
        await client.query('insert into attachments (partition_code, entity_id, storage_metadata) values ($1, $2, $3::jsonb)', [
          partition, entity, JSON.stringify(metadata),
        ])
      }
      const migration = new Migration20261001120000_attachments(
        {} as ConstructorParameters<typeof Migration20261001120000_attachments>[0],
        {} as ConstructorParameters<typeof Migration20261001120000_attachments>[1],
      )
      await migration.up()
      for (let run = 0; run < 2; run += 1) {
        for (const statement of migration.getQueries()) await client.query(statement as string)
      }
      const result = await client.query<{ code: string; access_resolver_requirements: unknown }>(
        'select code, access_resolver_requirements from attachment_partitions order by code',
      )
      const requirements = new Map(result.rows.map((row) => [row.code, row.access_resolver_requirements]))
      for (const code of ['primary', 'array', 'legacy', 'malformed-owner']) {
        expect(requirements.get(code)).toEqual([...previous, {
          resolverId: 'documents.document-attachments', targetEntity: 'documents:document',
        }])
      }
      expect(requirements.get('unrelated')).toEqual(previous)
      expect(requirements.get('invalid-policy')).toEqual({ invalid: true })
    } finally {
      await client.query('rollback')
    }
  })
})
