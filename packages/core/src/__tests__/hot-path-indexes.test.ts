import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Hot-path index guard (#2966).
 *
 * Two of the platform's hottest read paths used to run sequential scans:
 * TokenSearchStrategy filters search_tokens by (token_hash IN ..., tenant_id)
 * on every keystroke, and RBAC scans user_roles by user_id on every ACL cache
 * miss and by role_id on user-list/role-mutation paths — Postgres does not
 * auto-index FK columns.
 *
 * This test pins the fix at all three declaration sites so a refactor cannot
 * silently drop one of them: the entity `@Index` decorator, the migration SQL,
 * and the module's `.snapshot-open-mercato.json` (which keeps `yarn db:generate`
 * from re-emitting the diff).
 */

const modulesRoot = join(__dirname, '..', 'modules')

function readEntities(module: string): string {
  return readFileSync(join(modulesRoot, module, 'data', 'entities.ts'), 'utf8')
}

function readSnapshotIndexNames(module: string, table: string): string[] {
  const snapshotPath = join(modulesRoot, module, 'migrations', '.snapshot-open-mercato.json')
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
    tables: Array<{ name: string; indexes: Array<{ keyName: string }> }>
  }
  const tableSnapshot = snapshot.tables.find((candidate) => candidate.name === table)
  expect(tableSnapshot).toBeDefined()
  return tableSnapshot!.indexes.map((index) => index.keyName)
}

function readAllMigrationSql(module: string): string {
  const migrationsDir = join(modulesRoot, module, 'migrations')
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8'))
    .join('\n')
}

describe('hot-path indexes (#2966)', () => {
  describe('search_tokens (tenant_id, token_hash)', () => {
    it('declares the index on the SearchToken entity', () => {
      const source = readEntities('query_index')
      expect(source).toContain(
        "@Index({ name: 'search_tokens_tenant_token_hash_idx', properties: ['tenantId', 'tokenHash'] })",
      )
    })

    it('creates the index concurrently in a query_index migration', () => {
      const sql = readAllMigrationSql('query_index')
      expect(sql).toContain(
        'create index concurrently if not exists "search_tokens_tenant_token_hash_idx" on "search_tokens" ("tenant_id", "token_hash")',
      )
    })

    it('records the index in the query_index schema snapshot', () => {
      expect(readSnapshotIndexNames('query_index', 'search_tokens')).toContain(
        'search_tokens_tenant_token_hash_idx',
      )
    })
  })

  describe('user_roles (user_id) and (role_id)', () => {
    it('declares both FK indexes on the UserRole entity', () => {
      const source = readEntities('auth')
      expect(source).toContain("@Index({ name: 'user_roles_user_id_idx', properties: ['user'] })")
      expect(source).toContain("@Index({ name: 'user_roles_role_id_idx', properties: ['role'] })")
    })

    it('creates both indexes in an auth migration', () => {
      const sql = readAllMigrationSql('auth')
      expect(sql).toContain('create index if not exists "user_roles_user_id_idx" on "user_roles" ("user_id")')
      expect(sql).toContain('create index if not exists "user_roles_role_id_idx" on "user_roles" ("role_id")')
    })

    it('records both indexes in the auth schema snapshot', () => {
      const indexNames = readSnapshotIndexNames('auth', 'user_roles')
      expect(indexNames).toContain('user_roles_user_id_idx')
      expect(indexNames).toContain('user_roles_role_id_idx')
    })
  })
})
