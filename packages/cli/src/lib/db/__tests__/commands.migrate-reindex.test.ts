import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MikroORM } from '@mikro-orm/core'
import { dbMigrate } from '../commands'
import type { ModuleEntry, PackageResolver } from '../../resolver'

const collectQueryIndexReindexEntityTypes = jest.fn<Promise<string[]>, [any, any]>()
const requestQueryIndexReindex = jest.fn<Promise<{ requested: string[]; queued: boolean }>, [any, any]>()
const isMigrationReindexEnabled = jest.fn<boolean, []>()

jest.mock('../migration-reindex', () => ({
  collectQueryIndexReindexEntityTypes: (...args: any[]) => collectQueryIndexReindexEntityTypes(...(args as [any, any])),
  requestQueryIndexReindex: (...args: any[]) => requestQueryIndexReindex(...(args as [any, any])),
  isMigrationReindexEnabled: () => isMigrationReindexEnabled(),
}))

// `MikroORM.init` is stubbed with a spy rather than a module mock: `@mikro-orm/sql` extends the
// real `MikroORM` class at import time, so replacing the module export breaks the driver import.
const ormInit = jest.fn()

type PendingPlan = { pending: string[]; failOn?: string }

const tempDirs: string[] = []
const ormCloses: string[] = []

function createTempModule(id: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mercato-migrate-${id}-`))
  tempDirs.push(dir)
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'migrations'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'data', 'entities.ts'), `export class TestEntity_${id} {}\n`, 'utf8')
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

/**
 * `dbMigrate` calls `MikroORM.init` once per module, in `sortModules` order. Each fake ORM serves
 * that module's plan and records its own `close()`, so a test can assert both the discharge wiring
 * and that no connection pool leaks when a migration throws.
 */
function stubOrmsFor(plans: Record<string, PendingPlan>): void {
  ormInit.mockImplementation(async (config: any) => {
    const moduleId = Object.keys(plans).find((id) => String(config.migrations.path).includes(`-${id}-`))
    const plan = moduleId ? plans[moduleId] : { pending: [] }
    return {
      migrator: {
        getPending: async () => plan.pending.map((name) => ({ name, path: null })),
        up: async (options: { migrations?: string[] } = {}) => {
          const name = options.migrations?.[0]
          if (plan.failOn && name === plan.failOn) throw new Error(`migration ${name} failed`)
        },
      },
      close: async () => {
        if (moduleId) ormCloses.push(moduleId)
      },
    }
  })
}

describe('dbMigrate discharges query-index reindex declarations', () => {
  let logSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance
  let initSpy: jest.SpyInstance
  let stdoutSpy: jest.SpyInstance

  beforeEach(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://noop@localhost:5432/test'
    ormCloses.length = 0
    ormInit.mockReset()
    initSpy = jest.spyOn(MikroORM, 'init').mockImplementation((...args: any[]) => ormInit(...args))
    collectQueryIndexReindexEntityTypes.mockReset()
    requestQueryIndexReindex.mockReset()
    isMigrationReindexEnabled.mockReset()
    isMigrationReindexEnabled.mockReturnValue(true)
    collectQueryIndexReindexEntityTypes.mockResolvedValue(['customers:customer_dictionary_entry'])
    requestQueryIndexReindex.mockResolvedValue({
      requested: ['customers:customer_dictionary_entry'],
      queued: true,
    })
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    initSpy.mockRestore()
    logSpy.mockRestore()
    warnSpy.mockRestore()
    stdoutSpy.mockRestore()
    for (const dir of tempDirs.splice(0)) {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
    }
  })

  it('queues a reindex for the migrations it applied, after every module closed its ORM', async () => {
    const moduleA = { id: 'alpha', dir: createTempModule('alpha') }
    const moduleB = { id: 'beta', dir: createTempModule('beta') }
    stubOrmsFor({
      alpha: { pending: ['Migration20260901120000_reindex_alpha'] },
      beta: { pending: [] },
    })

    await dbMigrate(createMockResolver([moduleA, moduleB]))

    expect(ormCloses).toEqual(['alpha', 'beta'])
    const [applied] = collectQueryIndexReindexEntityTypes.mock.calls[0]
    expect(applied).toEqual([
      expect.objectContaining({ moduleId: 'alpha', name: 'Migration20260901120000_reindex_alpha' }),
    ])
    expect(applied[0].migrationsPath).toContain('migrations')
    expect(requestQueryIndexReindex).toHaveBeenCalledTimes(1)
    expect(requestQueryIndexReindex.mock.calls[0][0]).toEqual(['customers:customer_dictionary_entry'])
  })

  it('still discharges the declarations it already collected when a later migration throws', async () => {
    // The failure this guards: `customers` applies and commits, `sales` then fails. Without an
    // unconditional discharge the customers declaration is lost for good — a re-run never sees it
    // again, because that migration is no longer pending.
    const moduleA = { id: 'alpha', dir: createTempModule('alpha') }
    const moduleB = { id: 'beta', dir: createTempModule('beta') }
    stubOrmsFor({
      alpha: { pending: ['Migration20260901120000_reindex_alpha'] },
      beta: { pending: ['Migration20260901130000_broken'], failOn: 'Migration20260901130000_broken' },
    })

    await expect(dbMigrate(createMockResolver([moduleA, moduleB]))).rejects.toThrow(
      'migration Migration20260901130000_broken failed',
    )

    expect(collectQueryIndexReindexEntityTypes).toHaveBeenCalledTimes(1)
    expect(collectQueryIndexReindexEntityTypes.mock.calls[0][0]).toEqual([
      expect.objectContaining({ moduleId: 'alpha', name: 'Migration20260901120000_reindex_alpha' }),
    ])
    expect(requestQueryIndexReindex).toHaveBeenCalledTimes(1)
    // Both ORMs must have been closed even though the second module threw.
    expect(ormCloses).toEqual(['alpha', 'beta'])
  })

  it('never lets a discharge failure replace the migration error the operator needs to see', async () => {
    const moduleA = { id: 'alpha', dir: createTempModule('alpha') }
    stubOrmsFor({
      alpha: {
        pending: ['Migration20260901120000_reindex_alpha', 'Migration20260901130000_broken'],
        failOn: 'Migration20260901130000_broken',
      },
    })
    collectQueryIndexReindexEntityTypes.mockRejectedValue(new Error('container refused to build'))

    await expect(dbMigrate(createMockResolver([moduleA]))).rejects.toThrow(
      'migration Migration20260901130000_broken failed',
    )
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('container refused to build'))
  })

  it('skips the discharge entirely when the opt-out is set', async () => {
    const moduleA = { id: 'alpha', dir: createTempModule('alpha') }
    stubOrmsFor({ alpha: { pending: ['Migration20260901120000_reindex_alpha'] } })
    isMigrationReindexEnabled.mockReturnValue(false)

    await dbMigrate(createMockResolver([moduleA]))

    expect(collectQueryIndexReindexEntityTypes).not.toHaveBeenCalled()
    expect(requestQueryIndexReindex).not.toHaveBeenCalled()
  })
})
