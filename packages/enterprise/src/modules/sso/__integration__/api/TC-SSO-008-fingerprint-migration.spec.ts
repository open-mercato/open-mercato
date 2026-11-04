import { expect, test } from '@playwright/test'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { Migration20261029160000_scim_token_lookup_hash } from '../../migrations/Migration20261029160000_scim_token_lookup_hash'

test('TC-SSO-008: migration up and down preserve existing credentials in PostgreSQL', async () => {
  await withClient(async (client) => {
    await client.query('begin')
    try {
      await client.query('set local search_path = pg_temp')
      await client.query('create temporary table scim_tokens (id text primary key, token_hash text not null, token_prefix text not null, is_active boolean not null) on commit drop')
      await client.query("insert into scim_tokens values ('legacy', 'bcrypt-legacy', 'omscim_old', true), ('revoked', 'bcrypt-revoked', 'omscim_rev', false)")
      const original = await client.query('select * from scim_tokens order by id')
      const migration = Object.create(Migration20261029160000_scim_token_lookup_hash.prototype) as Migration20261029160000_scim_token_lookup_hash
      const statements: string[] = []
      Object.defineProperty(migration, 'addSql', { value: (sql: string) => statements.push(sql) })
      await migration.up()
      for (const statement of statements) await client.query(statement)
      const upgraded = await client.query('select * from scim_tokens order by id')
      expect(upgraded.rows).toEqual(original.rows.map((row) => ({ ...row, token_lookup_hash: null })))
      const indexed = await client.query<{ present: boolean }>("select to_regclass('pg_temp.scim_tokens_token_lookup_hash_idx') is not null as present")
      expect(indexed.rows[0].present).toBe(true)
      await client.query("update scim_tokens set token_lookup_hash = 'enrolled-fingerprint' where id = 'legacy'")
      statements.length = 0
      await migration.down()
      for (const statement of statements) await client.query(statement)
      expect((await client.query('select * from scim_tokens order by id')).rows).toEqual(original.rows)
      const rolledBack = await client.query<{ present: boolean }>("select to_regclass('pg_temp.scim_tokens_token_lookup_hash_idx') is not null as present")
      expect(rolledBack.rows[0].present).toBe(false)
    } finally {
      await client.query('rollback')
    }
  })
})
