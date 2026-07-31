import { readFileSync, readdirSync } from 'node:fs'

const indexCases = [
  {
    table: 'perspectives',
    ownerColumn: 'user_id',
    indexes: [
      'perspectives_live_user_org_uq',
      'perspectives_live_user_tenant_uq',
      'perspectives_live_user_org_only_uq',
      'perspectives_live_user_global_uq',
    ],
  },
  {
    table: 'role_perspectives',
    ownerColumn: 'role_id',
    indexes: [
      'role_perspectives_live_role_org_uq',
      'role_perspectives_live_role_tenant_uq',
      'role_perspectives_live_role_org_only_uq',
      'role_perspectives_live_role_global_uq',
    ],
  },
]

function readMigrationSources(): string {
  const migrationsUrl = new URL('../../migrations/', import.meta.url)
  return readdirSync(migrationsUrl)
    .filter((file) => file.startsWith('Migration') && file.endsWith('.ts'))
    .map((file) => readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'))
    .join('\n')
}

describe('perspectives live-row uniqueness schema', () => {
  it.each(indexCases)('$table uses live-row partial unique indexes for nullable scope rows', ({ indexes }) => {
    const migrationSource = readMigrationSources()
    const entitySource = readFileSync(new URL('../entities.ts', import.meta.url), 'utf8')

    for (const indexName of indexes) {
      expect(migrationSource).toContain(`create unique index if not exists "${indexName}"`)
      expect(entitySource).toContain(`create unique index "${indexName}"`)
    }

    expect(entitySource).not.toContain('@Unique')
  })

  it('keeps the migration snapshot aligned with the live-row indexes', () => {
    const snapshot = JSON.parse(
      readFileSync(
        new URL('../../migrations/.snapshot-open-mercato.json', import.meta.url),
        'utf8',
      ),
    ) as {
      tables: Array<{ name: string; indexes: Array<{ keyName: string; expression?: string }> }>
    }

    for (const { table, ownerColumn, indexes } of indexCases) {
      const tableSnapshot = snapshot.tables.find((item) => item.name === table)
      expect(tableSnapshot).toBeDefined()
      const expressions = new Map(
        tableSnapshot?.indexes.map((index) => [index.keyName, index.expression ?? '']) ?? [],
      )

      for (const indexName of indexes) {
        const expression = expressions.get(indexName)
        expect(expression).toContain(`"${ownerColumn}"`)
        expect(expression).toContain('"deleted_at" is null')
      }

      expect(
        tableSnapshot?.indexes.some((index) => index.constraint && index.columnNames.includes(ownerColumn)),
      ).toBe(false)
    }
  })
})
