import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Migration20261029160000_scim_token_lookup_hash } from '../Migration20261029160000_scim_token_lookup_hash'

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(Migration20261029160000_scim_token_lookup_hash.prototype) as Migration20261029160000_scim_token_lookup_hash
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', { value: (sql: string) => statements.push(sql) })
  await migration[direction]()
  return statements
}

describe('SCIM lookup hash migration', () => {
  it('adds only a nullable lookup column and exact-match index, preserving existing credentials', async () => {
    expect(await collectSql('up')).toEqual([
      'alter table "scim_tokens" add column "token_lookup_hash" text null;',
      'create index "scim_tokens_token_lookup_hash_idx" on "scim_tokens" ("token_lookup_hash");',
    ])
  })

  it('rolls back the index before its column without removing credential rows or bcrypt hashes', async () => {
    expect(await collectSql('down')).toEqual([
      'drop index if exists "scim_tokens_token_lookup_hash_idx";',
      'alter table "scim_tokens" drop column "token_lookup_hash";',
    ])
  })

  it('records the nullable indexed column in the affected module snapshot', () => {
    const snapshot = JSON.parse(readFileSync(join(__dirname, '../.snapshot-open-mercato.json'), 'utf8')) as {
      tables: Array<{ name: string; columns: Record<string, { name: string; type: string; nullable: boolean }>; indexes: Array<{ keyName: string; columnNames: string[] }> }>
    }
    const tokens = snapshot.tables.find((table) => table.name === 'scim_tokens')!
    expect(tokens.columns.token_lookup_hash).toEqual(expect.objectContaining({ name: 'token_lookup_hash', type: 'text', nullable: true }))
    expect(tokens.columns.token_hash.nullable).toBe(false)
    expect(tokens.indexes).toContainEqual(expect.objectContaining({ keyName: 'scim_tokens_token_lookup_hash_idx', columnNames: ['token_lookup_hash'] }))
  })
})
