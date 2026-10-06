import { describe, expect, jest, test } from '@jest/globals'
import { Migration20260914120000 } from '../Migration20260914120000'

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(Migration20260914120000.prototype) as Migration20260914120000
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql)),
  })
  await migration[direction]()
  return statements
}

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim()

describe('Migration20260914120000', () => {
  test('up() installs unaccent and pg_trgm, in that order', async () => {
    const statements = (await collectSql('up')).map(normalize)

    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain(`create extension if not exists "unaccent" schema public`)
    expect(statements[1]).toContain(`create extension if not exists "pg_trgm" schema public`)
  })

  // A bare `permission denied to create extension` aborts the whole db:migrate
  // run, taking every later module's migrations with it, so the failure has to
  // say which extension and what to grant. Both a plain privilege denial
  // (42501) and a managed-provider allowlist rejection (0A000) must be caught,
  // since either bare error aborts the run the same way.
  test('up() turns a missing CREATE privilege or an unallowlisted extension into an actionable error', async () => {
    const statements = (await collectSql('up')).map(normalize)

    for (const [index, extension] of ['unaccent', 'pg_trgm'].entries()) {
      expect(statements[index]).toContain(`exception when insufficient_privilege or feature_not_supported then`)
      expect(statements[index]).toContain(`Open Mercato requires the PostgreSQL "${extension}" extension`)
      expect(statements[index]).toContain(`CREATE EXTENSION IF NOT EXISTS "${extension}" SCHEMA public`)
    }
  })

  test('up() skips the create when the extension is already installed, so no privilege is needed', async () => {
    const statements = (await collectSql('up')).map(normalize)

    for (const [index, extension] of ['unaccent', 'pg_trgm'].entries()) {
      expect(statements[index]).toContain(
        `if not exists (select 1 from pg_extension where extname = '${extension}') then`,
      )
    }
  })

  // Dropping an extension cascades to every object built on it, including ones
  // this module does not own.
  test('down() leaves the extensions in place', async () => {
    expect(await collectSql('down')).toEqual([])
  })
})
