import {
  sanitizeModuleId,
  validateTableName,
  makeConstraintDropsIdempotent,
  getMigrationSnapshotName,
  shouldCreateInitialModuleMigration,
  resolveGeneratedMigrationPath,
  dbGenerate,
  dbGreenfield,
} from '../commands'
import { MetadataStorage } from '@mikro-orm/core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModuleEntry, PackageResolver } from '../../resolver'

describe('db commands security', () => {
  describe('sanitizeModuleId', () => {
    it('should preserve valid module IDs', () => {
      expect(sanitizeModuleId('customers')).toBe('customers')
      expect(sanitizeModuleId('auth')).toBe('auth')
      expect(sanitizeModuleId('api_keys')).toBe('api_keys')
      expect(sanitizeModuleId('catalog123')).toBe('catalog123')
    })

    it('should replace hyphens with underscores', () => {
      expect(sanitizeModuleId('my-module')).toBe('my_module')
      expect(sanitizeModuleId('test-module-name')).toBe('test_module_name')
    })

    it('should replace special characters with underscores', () => {
      expect(sanitizeModuleId('module.name')).toBe('module_name')
      expect(sanitizeModuleId('module@name')).toBe('module_name')
      expect(sanitizeModuleId('module/name')).toBe('module_name')
    })

    it('should sanitize SQL injection attempts', () => {
      expect(sanitizeModuleId('module; DROP TABLE users;--')).toBe('module__DROP_TABLE_users___')
      expect(sanitizeModuleId("test' OR '1'='1")).toBe('test__OR__1___1')
      expect(sanitizeModuleId('test" OR "1"="1')).toBe('test__OR__1___1')
    })

    it('should handle newlines and special whitespace', () => {
      expect(sanitizeModuleId('module\ntest')).toBe('module_test')
      expect(sanitizeModuleId('module\rtest')).toBe('module_test')
      expect(sanitizeModuleId('module\ttest')).toBe('module_test')
    })

    it('should preserve uppercase letters', () => {
      expect(sanitizeModuleId('MyModule')).toBe('MyModule')
      expect(sanitizeModuleId('API_Keys')).toBe('API_Keys')
    })

    it('should handle empty string', () => {
      expect(sanitizeModuleId('')).toBe('')
    })
  })

  describe('validateTableName', () => {
    it('should accept valid table names', () => {
      expect(() => validateTableName('mikro_orm_migrations_customers')).not.toThrow()
      expect(() => validateTableName('mikro_orm_migrations_auth')).not.toThrow()
      expect(() => validateTableName('mikro_orm_migrations_api_keys')).not.toThrow()
      expect(() => validateTableName('_private_table')).not.toThrow()
      expect(() => validateTableName('Table123')).not.toThrow()
      expect(() => validateTableName('a')).not.toThrow()
    })

    it('should reject names starting with numbers', () => {
      expect(() => validateTableName('123_table')).toThrow(/Invalid table name/)
      expect(() => validateTableName('1table')).toThrow(/Invalid table name/)
    })

    it('should reject names with hyphens', () => {
      expect(() => validateTableName('table-name')).toThrow(/Invalid table name/)
    })

    it('should reject names with spaces', () => {
      expect(() => validateTableName('table name')).toThrow(/Invalid table name/)
    })

    it('should reject names with dots', () => {
      expect(() => validateTableName('schema.table')).toThrow(/Invalid table name/)
    })

    it('should reject names with semicolons', () => {
      expect(() => validateTableName('table;drop')).toThrow(/Invalid table name/)
    })

    it('should reject empty string', () => {
      expect(() => validateTableName('')).toThrow(/Invalid table name/)
    })

    it('should include the invalid table name in error message', () => {
      expect(() => validateTableName('invalid-name')).toThrow(/invalid-name/)
    })
  })
})

describe('makeConstraintDropsIdempotent', () => {
  it('adds IF EXISTS to standard drop constraint statements', () => {
    const sql = 'alter table "users" drop constraint "fk_user_org";'

    const result = makeConstraintDropsIdempotent(sql)

    expect(result).toBe('alter table "users" drop constraint if exists "fk_user_org";')
  })

  it('keeps already idempotent statements unchanged', () => {
    const sql = 'alter table "users" drop constraint if exists "fk_user_org";'

    const result = makeConstraintDropsIdempotent(sql)

    expect(result).toBe(sql)
  })

  it('handles multiple statements and multiline SQL', () => {
    const sql = [
      'alter table "users" drop constraint "fk_user_org";',
      'alter table orders drop constraint fk_order_user;',
      'alter table public_logs',
      '  drop constraint   "ck_log_created";',
    ].join('\n')

    const result = makeConstraintDropsIdempotent(sql)

    expect(result).toBe([
      'alter table "users" drop constraint if exists "fk_user_org";',
      'alter table orders drop constraint if exists fk_order_user;',
      'alter table public_logs drop constraint if exists "ck_log_created";',
    ].join('\n'))
  })

  it('does not alter DROP CONSTRAINT with CASCADE suffix', () => {
    const sql = 'alter table "users" drop constraint "fk_user_org" cascade;'

    const result = makeConstraintDropsIdempotent(sql)

    expect(result).toBe(sql)
  })
})

describe('getMigrationSnapshotName', () => {
  it('keeps the historical fixed snapshot name', () => {
    const snapshotName = getMigrationSnapshotName({
      getRootDir: () => '/tmp/any-project',
    })

    expect(snapshotName).toBe('.snapshot-open-mercato')
  })
})

describe('shouldCreateInitialModuleMigration', () => {
  function createTempMigrationsDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-migrations-'))
  }

  it('uses initial migration mode when a module has no snapshot and no migrations', () => {
    const dir = createTempMigrationsDir()

    expect(shouldCreateInitialModuleMigration(dir, '.snapshot-open-mercato')).toBe(true)

    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('does not use initial migration mode when a snapshot exists', () => {
    const dir = createTempMigrationsDir()
    fs.writeFileSync(path.join(dir, '.snapshot-open-mercato.json'), '{}')

    expect(shouldCreateInitialModuleMigration(dir, '.snapshot-open-mercato')).toBe(false)

    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('does not use initial migration mode when migration files already exist', () => {
    const dir = createTempMigrationsDir()
    fs.writeFileSync(path.join(dir, 'Migration20260506100652.ts'), 'export {}')

    expect(shouldCreateInitialModuleMigration(dir, '.snapshot-open-mercato')).toBe(false)

    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('resolveGeneratedMigrationPath', () => {
  it('resolves MikroORM basename results inside the migrations directory', () => {
    const result = resolveGeneratedMigrationPath(
      'Migration20260506101927.ts',
      '/repo/src/modules/example/migrations',
    )

    expect(result).toBe('/repo/src/modules/example/migrations/Migration20260506101927.ts')
  })

  it('keeps absolute MikroORM results unchanged', () => {
    const result = resolveGeneratedMigrationPath(
      '/repo/src/modules/example/migrations/Migration20260506101927.ts',
      '/other/migrations',
    )

    expect(result).toBe('/repo/src/modules/example/migrations/Migration20260506101927.ts')
  })
})

describe('db commands', () => {
  describe('dbGreenfield', () => {
    it('should require --yes flag', async () => {
      // Mock console.error and process.exit
      const mockConsoleError = jest.spyOn(console, 'error').mockImplementation()
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      const mockResolver = {
        loadEnabledModules: () => [],
        getOutputDir: () => '/tmp/test',
        getRootDir: () => '/tmp',
        getModulePaths: () => ({ appBase: '', pkgBase: '' }),
      } as any

      await expect(dbGreenfield(mockResolver, { yes: false })).rejects.toThrow('process.exit called')

      expect(mockConsoleError).toHaveBeenCalledWith(
        'This command will DELETE all data. Use --yes to confirm.'
      )

      mockConsoleError.mockRestore()
      mockExit.mockRestore()
    })
  })

  describe('integration with sanitization', () => {
    it('should create safe table names from any module ID', () => {
      const dangerousIds = [
        'module; DROP TABLE users;--',
        "test' OR '1'='1",
        'module\ninjection',
        '../../../etc/passwd',
      ]

      dangerousIds.forEach(id => {
        const sanitized = sanitizeModuleId(id)
        const tableName = `mikro_orm_migrations_${sanitized}`

        // The resulting table name should be valid
        expect(() => validateTableName(tableName)).not.toThrow()
      })
    })
  })
})

describe('dbGenerate metadata isolation (issue #1911)', () => {
  // Regression test for https://github.com/open-mercato/open-mercato/issues/1911.
  // Without per-iteration MetadataStorage.clear(), every module's migration
  // accumulated the @Entity() decorator registrations from previously-loaded
  // modules and therefore produced polluted CREATE TABLE statements. The fix
  // is a single MetadataStorage.clear() call at the top of every iteration of
  // the dbGenerate loop. The test verifies that the clear is invoked once per
  // iteration and that it actually wipes any pre-existing global metadata
  // entries (the practical pollution vector that caused the bug).

  const tempDirs: string[] = []
  let clearSpy: jest.SpyInstance

  beforeEach(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://noop@localhost:5432/test'
    MetadataStorage.clear()
    clearSpy = jest.spyOn(MetadataStorage, 'clear')
  })

  afterEach(() => {
    clearSpy.mockRestore()
    for (const dir of tempDirs.splice(0)) {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
    }
    MetadataStorage.clear()
  })

  function createTempModule(id: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mercato-mod-${id}-`))
    tempDirs.push(dir)
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'migrations'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'migrations', '.snapshot-open-mercato.json'), '{}', 'utf8')
    fs.writeFileSync(
      path.join(dir, 'data', 'entities.ts'),
      `export class TestEntity_${id} {}\n`,
      'utf8',
    )
    return dir
  }

  function createMockResolver(modules: { id: string; dir: string }[]): PackageResolver {
    const entries: ModuleEntry[] = modules.map((m) => ({ id: m.id, from: '@app' as const }))
    const byId = new Map(modules.map((m) => [m.id, m.dir]))
    return {
      isMonorepo: () => true,
      getRootDir: () => '/tmp/test-root',
      getAppDir: () => '/tmp/test-app',
      getOutputDir: () => '/tmp/test-out',
      getModulesConfigPath: () => '/tmp/test-root/modules.ts',
      discoverPackages: () => [],
      loadEnabledModules: () => entries,
      getModulePaths: (entry: ModuleEntry) => {
        const dir = byId.get(entry.id) ?? '/nonexistent'
        return { appBase: dir, pkgBase: dir }
      },
      getModuleImportBase: (entry: ModuleEntry) => ({
        appBase: `@/modules/${entry.id}`,
        pkgBase: `@open-mercato/core/modules/${entry.id}`,
      }),
      getPackageOutputDir: () => '/tmp/test-out',
      getPackageRoot: () => '/tmp/test-root',
    }
  }

  it('calls MetadataStorage.clear() at the start of every module iteration', async () => {
    const moduleA = { id: 'modulealpha', dir: createTempModule('modulealpha') }
    const moduleB = { id: 'modulebeta', dir: createTempModule('modulebeta') }
    const resolver = createMockResolver([moduleA, moduleB])

    await dbGenerate(resolver)

    // The fix adds one MetadataStorage.clear() at the top of every iteration of
    // the dbGenerate loop. With two modules, clear must be invoked at least
    // twice. Without the fix (the regression introduced by 3b0b8eb6a), clear is
    // never invoked from dbGenerate at all.
    expect(clearSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('wipes pre-existing global metadata entries before processing each module', async () => {
    // Simulate the @Entity decorator side effect from a previously-loaded
    // module by manually registering a metadata entry. Without the fix, this
    // entry would persist into the next module's MikroORM.init() and end up
    // in its generated migration as an unrelated CREATE TABLE statement.
    MetadataStorage.getMetadata('LingeringEntity', '/stale/path/lingering')
    expect(Object.keys(MetadataStorage.getMetadata())).toHaveLength(1)

    const moduleA = { id: 'modulealpha', dir: createTempModule('modulealpha') }
    const resolver = createMockResolver([moduleA])

    await dbGenerate(resolver)

    // After dbGenerate runs, the clear must have wiped the stale entry. We
    // observe the registry state at clear time AND after dbGenerate exits.
    expect(clearSpy.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(Object.keys(MetadataStorage.getMetadata())).toHaveLength(0)
  })
})
