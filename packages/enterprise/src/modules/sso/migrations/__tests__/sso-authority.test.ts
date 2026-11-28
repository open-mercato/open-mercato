import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Migration20261115020000_sso_authority } from '../Migration20261115020000_sso_authority'

async function migrationSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(Migration20261115020000_sso_authority.prototype) as Migration20261115020000_sso_authority
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', { value: (sql: string) => statements.push(sql) })
  await migration[direction]()
  return statements
}

describe('SSO authority migration', () => {
  it('adds nullable provenance without assigning untrusted historic authors', async () => {
    expect(await migrationSql('up')).toEqual(['alter table "sso_configs" add column "authorization_user_id" uuid null;'])
  })

  it('rolls back only the new column without deleting configs or identities', async () => {
    expect(await migrationSql('down')).toEqual(['alter table "sso_configs" drop column "authorization_user_id";'])
  })

  it('records optional UUID provenance while retaining existing config versioning', () => {
    const snapshot = JSON.parse(readFileSync(join(__dirname, '../.snapshot-open-mercato.json'), 'utf8')) as {
      tables: Array<{ name: string; columns: Record<string, { name: string; type: string; nullable: boolean }> }>
    }
    const config = snapshot.tables.find((table) => table.name === 'sso_configs')!
    expect(config.columns.authorization_user_id).toMatchObject({ type: 'uuid', nullable: true })
    expect(config.columns.updated_at.nullable).toBe(false)
    expect(config.columns.app_role_mappings.nullable).toBe(false)
  })
})
