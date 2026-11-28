// The entity metadata, the migration SQL and the migration snapshot must
// describe the same unique keys; otherwise the next `yarn db:generate`
// emits a spurious migration for this module.
import { readFileSync, readdirSync } from 'node:fs'
import { MetadataStorage } from '@mikro-orm/core'
import { CostCenter, DefaultAccountPostingRule, PostingRulesSettings } from '../entities'

type SnapshotIndex = { keyName: string; unique: boolean; where?: string; columnNames: string[] }
type Snapshot = { tables: Array<{ name: string; indexes: SnapshotIndex[] }> }

function readMigrationSources(): string {
  const migrationsUrl = new URL('../../migrations/', import.meta.url)
  return readdirSync(migrationsUrl)
    .filter((file) => file.startsWith('Migration') && file.endsWith('.ts'))
    .map((file) => readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'))
    .join('\n')
}

function readSnapshot(): Snapshot {
  return JSON.parse(
    readFileSync(new URL('../../migrations/.snapshot-open-mercato.json', import.meta.url), 'utf8'),
  ) as Snapshot
}

const uniqueCases = [
  { entity: CostCenter, table: 'posting_rules_cost_centers', name: 'posting_rules_cost_centers_scope_code_unique', where: '"deleted_at" is null' },
  { entity: DefaultAccountPostingRule, table: 'posting_rules_default_account_posting_rules', name: 'posting_rules_default_account_posting_rules_source_unique', where: undefined },
  { entity: PostingRulesSettings, table: 'posting_rules_settings', name: 'posting_rules_settings_scope_unique', where: undefined },
]

describe('posting_rules schema', () => {
  it('ships a migration snapshot covering the module\'s three tables', () => {
    expect(readSnapshot().tables.map((table) => table.name).sort()).toEqual([
      'posting_rules_cost_centers',
      'posting_rules_default_account_posting_rules',
      'posting_rules_settings',
    ])
  })

  it.each(uniqueCases)('$name: entity, migration and snapshot agree on the predicate', ({ entity, table, name, where }) => {
    const metadata = Object.values(MetadataStorage.getMetadata()).find((candidate) => candidate.class === entity)
    const unique = metadata?.uniques.find((candidate) => candidate.name === name)
    expect(unique).toBeDefined()
    expect(unique?.where).toBe(where)

    const migrationSource = readMigrationSources()
    if (where) {
      expect(migrationSource).toContain(`create unique index "${name}" on "${table}"`)
      expect(migrationSource).toContain(`where ${where};`)
    } else {
      expect(migrationSource).toContain(`add constraint "${name}" unique`)
    }

    const snapshotIndex = readSnapshot()
      .tables.find((candidate) => candidate.name === table)
      ?.indexes.find((index) => index.keyName === name)
    expect(snapshotIndex).toMatchObject({ unique: true })
    expect(snapshotIndex?.where).toBe(where)
  })
})
