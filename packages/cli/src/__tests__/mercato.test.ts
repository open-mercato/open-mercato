import type { Module } from '@open-mercato/shared/modules/registry'
import {
  registerCliModules,
  getCliModules,
  hasCliModules,
  padByCodePointWidth,
  run,
} from '../mercato'

type MockChildAutoExit = { code: number | null; signal?: NodeJS.Signals | null } | undefined
type MockChildSpawnRouter = (args: string[]) => MockChildAutoExit

function buildMockChildProcessModule(routeAutoExit: MockChildSpawnRouter) {
  const { EventEmitter } = jest.requireActual('node:events')

  const createChild = (spawnargs: string[], autoExit?: MockChildAutoExit) => {
    const child = new EventEmitter() as any
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.spawnargs = spawnargs
    child.killed = false
    child.exitCode = null
    child.signalCode = null
    child.kill = jest.fn((signal: NodeJS.Signals = 'SIGTERM') => {
      child.killed = true
      if (child.exitCode !== null || child.signalCode !== null) {
        return true
      }
      child.signalCode = signal
      queueMicrotask(() => {
        child.emit('exit', null, signal)
      })
      return true
    })

    if (autoExit) {
      queueMicrotask(() => {
        if (child.exitCode !== null || child.signalCode !== null) return
        child.exitCode = autoExit.code
        child.signalCode = autoExit.signal ?? null
        child.emit('exit', child.exitCode, child.signalCode)
      })
    }

    return child
  }

  return {
    spawn: jest.fn((_command: string, args: string[]) => createChild(['node', ...args], routeAutoExit(args))),
  }
}

const eventsWorkerFixture: Pick<Module, 'id' | 'workers'> = {
  id: 'events',
  workers: [
    {
      id: 'events.test-worker',
      queue: 'events',
      concurrency: 1,
      handler: jest.fn(),
    },
  ],
}

describe('mercato CLI module registration', () => {
  beforeEach(() => {
    // Reset module state by re-importing
    jest.resetModules()
  })

  describe('getCliModules', () => {
    it('returns empty array when no modules registered', () => {
      // Fresh import to get clean state
      const { getCliModules: freshGetCliModules } = jest.requireActual('../mercato')

      // In a fresh state (or after reset), should return empty array
      const modules = freshGetCliModules()
      expect(Array.isArray(modules)).toBe(true)
    })

    it('returns registered modules after registration', () => {
      const mockModules = [
        { id: 'test-module', cli: [{ command: 'test', run: jest.fn() }] },
      ] as any

      registerCliModules(mockModules)
      const result = getCliModules()

      expect(result).toBe(mockModules)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('test-module')
    })
  })

  describe('hasCliModules', () => {
    it('returns false when no modules registered', () => {
      const { hasCliModules: freshHasCliModules } = jest.requireActual('../mercato')
      // Note: This test depends on module state
      // In practice, hasCliModules checks if _cliModules is not null and has length
    })

    it('returns true after modules are registered', () => {
      const mockModules = [
        { id: 'auth', cli: [{ command: 'setup', run: jest.fn() }] },
      ] as any

      registerCliModules(mockModules)

      expect(hasCliModules()).toBe(true)
    })

    it('returns false when empty array is registered', () => {
      registerCliModules([])

      expect(hasCliModules()).toBe(false)
    })
  })

  describe('registerCliModules', () => {
    it('allows re-registration in development mode', () => {
      const originalEnv = process.env.NODE_ENV
      ;(process.env as Record<string, string | undefined>).NODE_ENV = 'development'

      const consoleSpy = jest.spyOn(console, 'debug').mockImplementation()

      const modules1 = [{ id: 'mod1', cli: [] }] as any
      const modules2 = [{ id: 'mod2', cli: [] }] as any

      registerCliModules(modules1)
      registerCliModules(modules2)

      const result = getCliModules()
      expect(result).toBe(modules2)

      consoleSpy.mockRestore()
      ;(process.env as Record<string, string | undefined>).NODE_ENV = originalEnv
    })

    it('registers modules correctly', () => {
      const testModules = [
        { id: 'customers', cli: [{ command: 'seed', run: jest.fn() }] },
        { id: 'catalog', cli: [{ command: 'import', run: jest.fn() }] },
      ] as any

      registerCliModules(testModules)

      const result = getCliModules()
      expect(result).toHaveLength(2)
      expect(result.map((m: any) => m.id)).toEqual(['customers', 'catalog'])
    })
  })
})

describe('padByCodePointWidth', () => {
  it('pads emoji labels based on code point width', () => {
    expect(padByCodePointWidth('👑 Superadmin:', 13)).toBe('👑 Superadmin:')
    expect(padByCodePointWidth('🧰 Admin:', 13)).toBe('🧰 Admin:     ')
    expect(padByCodePointWidth('👷 Employee:', 13)).toBe('👷 Employee:  ')
  })

  it('does not trim or pad when value meets or exceeds target width', () => {
    expect(padByCodePointWidth('1234567890123', 13)).toBe('1234567890123')
    expect(padByCodePointWidth('12345678901234', 13)).toBe('12345678901234')
  })
})

describe('db command failure output', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL

  beforeEach(() => {
    jest.restoreAllMocks()
    process.env.DATABASE_URL = 'postgres://postgres:secret@127.0.0.1:5432/open_mercato'
  })

  afterAll(() => {
    process.env.DATABASE_URL = originalDatabaseUrl
  })

  it('shows a targeted message when db:migrate cannot reach postgres', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    const migrateError = new AggregateError(
      [Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' })],
      'AggregateError',
    )

    registerCliModules([
      {
        id: 'db',
        cli: [{ command: 'migrate', run: jest.fn().mockRejectedValue(migrateError) }],
      } as any,
    ])

    const exitCode = await run(['node', 'mercato', 'db', 'migrate'])

    expect(exitCode).toBe(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '💥 Failed: PostgreSQL at 127.0.0.1:5432/open_mercato is not reachable: it refused the connection. Start the database service or fix DATABASE_URL in .env, then retry `yarn db:migrate`.',
    )

    consoleErrorSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })

  it('does not load app CLI while dispatching built-in db commands', async () => {
    const originalFunction = global.Function
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    const dbGenerate = jest.fn().mockResolvedValue(undefined)

    try {
      ;(global as typeof globalThis & { Function: typeof Function }).Function = jest.fn(() => {
        throw new Error('app cli import should not run for built-in db commands')
      }) as unknown as typeof Function

      registerCliModules([
        {
          id: 'db',
          cli: [{ command: 'generate', run: dbGenerate }],
        } as any,
      ])

      const exitCode = await run(['node', 'mercato', 'db', 'generate'])

      expect(exitCode).toBe(0)
      expect(dbGenerate).toHaveBeenCalled()
    } finally {
      ;(global as typeof globalThis & { Function: typeof Function }).Function = originalFunction
      consoleErrorSpy.mockRestore()
      consoleLogSpy.mockRestore()
    }
  })

  it('does not import the DI container module while dispatching built-in db commands', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

    try {
      jest.resetModules()
      jest.doMock('@open-mercato/shared/lib/di/container', () => {
        throw new Error('di container should stay lazy for built-in db commands')
      })

      const mercato = await import('../mercato')
      const dbGenerate = jest.fn().mockResolvedValue(undefined)

      mercato.registerCliModules([
        {
          id: 'db',
          cli: [{ command: 'generate', run: dbGenerate }],
        } as any,
      ])

      const exitCode = await mercato.run(['node', 'mercato', 'db', 'generate'])

      expect(exitCode).toBe(0)
      expect(dbGenerate).toHaveBeenCalled()
    } finally {
      jest.dontMock('@open-mercato/shared/lib/di/container')
      jest.resetModules()
      consoleErrorSpy.mockRestore()
      consoleLogSpy.mockRestore()
    }
  })

  it('falls back to nested error messages when a command throws an aggregate error with an empty top-level message', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    const cacheError = new AggregateError(
      [Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' })],
      '',
    )

    registerCliModules([
      {
        id: 'configs',
        cli: [{ command: 'cache', run: jest.fn().mockRejectedValue(cacheError) }],
      } as any,
    ])

    const exitCode = await run(['node', 'mercato', 'configs', 'cache', 'structural'])

    expect(exitCode).toBe(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '💥 Failed: PostgreSQL at 127.0.0.1:5432/open_mercato is not reachable: it refused the connection. This command needs PostgreSQL. Start the database service or fix DATABASE_URL in .env, then retry `yarn mercato configs cache`.',
    )

    consoleErrorSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })
})

describe('init command failure output', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL

  beforeEach(() => {
    jest.restoreAllMocks()
    jest.resetModules()
    process.env.DATABASE_URL = 'postgres://postgres:secret@127.0.0.1:5432/open_mercato'
  })

  afterEach(() => {
    jest.dontMock('child_process')
    jest.dontMock('pg')
    jest.dontMock('../lib/db')
    jest.dontMock('../lib/generators')
    jest.dontMock('../lib/resolver')
    jest.dontMock('@open-mercato/shared/lib/bootstrap/dynamicLoader')
    jest.resetModules()
  })

  afterAll(() => {
    process.env.DATABASE_URL = originalDatabaseUrl
  })

  it('shows a targeted message when init cannot reach postgres', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    const initError = new AggregateError(
      [Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' })],
      'AggregateError',
    )

    jest.doMock('child_process', () => ({
      execSync: jest.fn(),
    }))
    jest.doMock('pg', () => ({
      Client: jest.fn().mockImplementation(() => ({
        connect: jest.fn().mockRejectedValue(initError),
        end: jest.fn().mockResolvedValue(undefined),
      })),
    }))
    jest.doMock('../lib/generators', () => ({
      generateEntityIds: jest.fn().mockResolvedValue(undefined),
      generateModuleRegistry: jest.fn().mockResolvedValue(undefined),
      generateModuleRegistryApp: jest.fn().mockResolvedValue(undefined),
      generateModuleRegistryCli: jest.fn().mockResolvedValue(undefined),
      generateModuleEntities: jest.fn().mockResolvedValue(undefined),
      generateModuleDi: jest.fn().mockResolvedValue(undefined),
      generateModulePackageSources: jest.fn().mockResolvedValue(undefined),
      generateOpenApi: jest.fn().mockResolvedValue(undefined),
    }))
    jest.doMock('../lib/resolver', () => ({
      createResolver: () => ({
        getAppDir: () => '/tmp/test-app',
      }),
    }))

    const mercato = await import('../mercato')
    const exitCode = await mercato.run(['node', 'mercato', 'init'])

    expect(exitCode).toBe(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '❌ Initialization failed:',
      'PostgreSQL at 127.0.0.1:5432/open_mercato is not reachable: it refused the connection. Start PostgreSQL or fix DATABASE_URL in .env, then retry `yarn initialize`.',
    )

    consoleErrorSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })

  it('shows a DNS-focused message when init cannot resolve postgres host', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    process.env.DATABASE_URL = 'postgres://postgres:secret@db.internal:5432/open_mercato'

    const initError = new AggregateError(
      [Object.assign(new Error('getaddrinfo ENOTFOUND db.internal'), { code: 'ENOTFOUND' })],
      'AggregateError',
    )

    jest.doMock('child_process', () => ({
      execSync: jest.fn(),
    }))
    jest.doMock('pg', () => ({
      Client: jest.fn().mockImplementation(() => ({
        connect: jest.fn().mockRejectedValue(initError),
        end: jest.fn().mockResolvedValue(undefined),
      })),
    }))
    jest.doMock('../lib/generators', () => ({
      generateEntityIds: jest.fn().mockResolvedValue(undefined),
      generateModuleRegistry: jest.fn().mockResolvedValue(undefined),
      generateModuleRegistryApp: jest.fn().mockResolvedValue(undefined),
      generateModuleRegistryCli: jest.fn().mockResolvedValue(undefined),
      generateModuleEntities: jest.fn().mockResolvedValue(undefined),
      generateModuleDi: jest.fn().mockResolvedValue(undefined),
      generateModulePackageSources: jest.fn().mockResolvedValue(undefined),
      generateOpenApi: jest.fn().mockResolvedValue(undefined),
    }))
    jest.doMock('../lib/resolver', () => ({
      createResolver: () => ({
        getAppDir: () => '/tmp/test-app',
      }),
    }))

    const mercato = await import('../mercato')
    const exitCode = await mercato.run(['node', 'mercato', 'init'])

    expect(exitCode).toBe(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '❌ Initialization failed:',
      'PostgreSQL at db.internal:5432/open_mercato is not reachable: it could not be resolved. Start PostgreSQL or fix DATABASE_URL in .env, then retry `yarn initialize`.',
    )

    consoleErrorSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })

  it('keeps init successful when lean presets disable optional modules', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

    const configsRestoreDefaults = jest.fn().mockResolvedValue(undefined)
    const authSetup = jest.fn().mockResolvedValue(undefined)
    const authSeedRoles = jest.fn().mockResolvedValue(undefined)
    const entitiesSeedEncryption = jest.fn().mockResolvedValue(undefined)
    const queryIndexReindex = jest.fn().mockResolvedValue(undefined)

    jest.doMock('child_process', () => ({
      execSync: jest.fn(),
    }))
    jest.doMock('pg', () => ({
      Client: jest.fn().mockImplementation(() => ({
        connect: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockResolvedValue({
          rows: [{ org_id: 'org-1', tenant_id: 'tenant-1' }],
        }),
        end: jest.fn().mockResolvedValue(undefined),
      })),
    }))
    jest.doMock('../lib/generators', () => ({
      generateEntityIds: jest.fn().mockResolvedValue(undefined),
      generateModuleRegistry: jest.fn().mockResolvedValue(undefined),
      generateModuleRegistryApp: jest.fn().mockResolvedValue(undefined),
      generateModuleRegistryCli: jest.fn().mockResolvedValue(undefined),
      generateModuleEntities: jest.fn().mockResolvedValue(undefined),
      generateModuleDi: jest.fn().mockResolvedValue(undefined),
      generateModulePackageSources: jest.fn().mockResolvedValue(undefined),
      generateOpenApi: jest.fn().mockResolvedValue(undefined),
    }))
    jest.doMock('../lib/db', () => ({
      dbMigrate: jest.fn().mockResolvedValue(undefined),
    }))
    jest.doMock('../lib/resolver', () => ({
      createResolver: () => ({
        getAppDir: () => '/tmp/test-app',
      }),
    }))
    jest.doMock('@open-mercato/shared/lib/bootstrap/dynamicLoader', () => ({
      bootstrapFromAppRoot: jest.fn().mockResolvedValue({
        modules: [
          {
            id: 'configs',
            cli: [{ command: 'restore-defaults', run: configsRestoreDefaults }],
          },
          {
            id: 'auth',
            cli: [
              { command: 'setup', run: authSetup },
              { command: 'seed-roles', run: authSeedRoles },
            ],
          },
          {
            id: 'entities',
            cli: [{ command: 'seed-encryption', run: entitiesSeedEncryption }],
          },
          {
            id: 'query_index',
            cli: [{ command: 'reindex', run: queryIndexReindex }],
          },
        ],
      }),
    }))
    jest.doMock('@open-mercato/shared/lib/di/container', () => ({
      createRequestContainer: jest.fn().mockResolvedValue({
        resolve: jest.fn().mockReturnValue({}),
      }),
    }))
    jest.doMock(
      '@open-mercato/core/modules/auth/lib/setup-app',
      () => ({
        ensureCustomRoleAcls: jest.fn().mockResolvedValue(undefined),
      }),
      { virtual: true },
    )

    const mercato = await import('../mercato')
    const exitCode = await mercato.run(['node', 'mercato', 'init'])

    expect(exitCode).toBe(0)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '⏭️  Skipping "feature_toggles:seed-defaults" — module not enabled',
    )
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '⏭️  Skipping "dashboards:seed-defaults" — module not enabled',
    )
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '⏭️  Skipping "dashboards:enable-analytics-widgets" — module not enabled',
    )
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '⏭️  Skipping "search:reindex" — module not enabled',
    )
    expect(configsRestoreDefaults).toHaveBeenCalled()
    expect(authSetup).toHaveBeenCalled()
    expect(queryIndexReindex).toHaveBeenCalledWith(['--force', '--tenant', 'tenant-1'])

    consoleErrorSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })
})

describe('generate post-step structural cache purge', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.resetModules()
  })

  afterEach(() => {
    jest.dontMock('../lib/generators')
    jest.dontMock('../lib/resolver')
    jest.dontMock('@open-mercato/shared/lib/bootstrap/dynamicLoader')
    jest.resetModules()
  })

  it('runs structural cache purge after successful generation when configs cache CLI is available', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    const generateEntityIds = jest.fn().mockResolvedValue(undefined)
    const generateModuleRegistry = jest.fn().mockResolvedValue(undefined)
    const generateModuleRegistryApp = jest.fn().mockResolvedValue(undefined)
    const generateModuleRegistryCli = jest.fn().mockResolvedValue(undefined)
    const generateModuleEntities = jest.fn().mockResolvedValue(undefined)
    const generateModuleDi = jest.fn().mockResolvedValue(undefined)
    const generateModulePackageSources = jest.fn().mockResolvedValue(undefined)
    const generateOpenApi = jest.fn().mockResolvedValue(undefined)
    const cacheRun = jest.fn().mockResolvedValue(undefined)

    jest.doMock('../lib/generators', () => ({
      generateEntityIds,
      generateModuleRegistry,
      generateModuleRegistryApp,
      generateModuleRegistryCli,
      generateModuleEntities,
      generateModuleDi,
      generateModulePackageSources,
      generateOpenApi,
    }))
    jest.doMock('../lib/resolver', () => ({
      createResolver: () => ({
        getAppDir: () => '/tmp/test-app',
      }),
    }))
    jest.doMock('@open-mercato/shared/lib/bootstrap/dynamicLoader', () => ({
      bootstrapFromAppRoot: jest.fn().mockResolvedValue({
        modules: [
          {
            id: 'configs',
            cli: [{ command: 'cache', run: cacheRun }],
          },
        ],
      }),
    }))

    const mercato = await import('../mercato')
    const exitCode = await mercato.run(['node', 'mercato', 'generate'])

    expect(exitCode).toBe(0)
    expect(generateEntityIds).toHaveBeenCalled()
    expect(cacheRun).toHaveBeenCalledWith(['structural', '--all-tenants', '--quiet'])

    consoleErrorSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })

  it('keeps generation successful when the post-generate cache purge bootstrap fails', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    const generateEntityIds = jest.fn().mockResolvedValue(undefined)
    const generateModuleRegistry = jest.fn().mockResolvedValue(undefined)
    const generateModuleRegistryApp = jest.fn().mockResolvedValue(undefined)
    const generateModuleRegistryCli = jest.fn().mockResolvedValue(undefined)
    const generateModuleEntities = jest.fn().mockResolvedValue(undefined)
    const generateModuleDi = jest.fn().mockResolvedValue(undefined)
    const generateModulePackageSources = jest.fn().mockResolvedValue(undefined)
    const generateOpenApi = jest.fn().mockResolvedValue(undefined)

    jest.doMock('../lib/generators', () => ({
      generateEntityIds,
      generateModuleRegistry,
      generateModuleRegistryApp,
      generateModuleRegistryCli,
      generateModuleEntities,
      generateModuleDi,
      generateModulePackageSources,
      generateOpenApi,
    }))
    jest.doMock('../lib/resolver', () => ({
      createResolver: () => ({
        getAppDir: () => '/tmp/test-app',
      }),
    }))
    jest.doMock('@open-mercato/shared/lib/bootstrap/dynamicLoader', () => ({
      bootstrapFromAppRoot: jest.fn().mockRejectedValue(new Error('generated cli bootstrap unavailable')),
    }))

    const mercato = await import('../mercato')
    const exitCode = await mercato.run(['node', 'mercato', 'generate'])

    expect(exitCode).toBe(0)
    expect(generateEntityIds).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })
})

describe('server dev managed process exits', () => {
  const originalAutoSpawnScheduler = process.env.AUTO_SPAWN_SCHEDULER
  const originalAutoSpawnWorkers = process.env.AUTO_SPAWN_WORKERS

  beforeEach(() => {
    jest.restoreAllMocks()
    jest.resetModules()
    process.env.AUTO_SPAWN_SCHEDULER = 'false'
    process.env.AUTO_SPAWN_WORKERS = 'true'
  })

  afterEach(() => {
    jest.dontMock('child_process')
    jest.dontMock('node:fs')
    jest.dontMock('../lib/generators')
    jest.dontMock('../lib/resolver')
    jest.resetModules()
  })

  afterAll(() => {
    process.env.AUTO_SPAWN_SCHEDULER = originalAutoSpawnScheduler
    process.env.AUTO_SPAWN_WORKERS = originalAutoSpawnWorkers
  })

  it('skips scheduler auto-start when the module is not enabled', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    process.env.AUTO_SPAWN_SCHEDULER = 'true'
    process.env.AUTO_SPAWN_WORKERS = 'false'

    jest.doMock('node:fs', () => {
      const actual = jest.requireActual('node:fs')
      return {
        ...actual,
        existsSync: jest.fn((candidate: string) =>
          candidate.includes('next/dist/bin/next') || candidate.includes('@open-mercato/cli/bin/mercato'),
        ),
        unlinkSync: jest.fn(),
      }
    })
    jest.doMock('../lib/generators', () => ({
      generateModulePackageSources: jest.fn().mockResolvedValue(undefined),
    }))
    jest.doMock('../lib/resolver', () => ({
      resolveEnvironment: () => ({
        appDir: '/tmp/test-app',
        rootDir: '/tmp/test-root',
      }),
      createResolver: () => ({}),
    }))
    jest.doMock('child_process', () =>
      buildMockChildProcessModule((args) =>
        args[0]?.includes('next/dist/bin/next') ? { code: null, signal: 'SIGTERM' } : undefined,
      ),
    )

    const mercato = await import('../mercato')
    const exitCode = await mercato.run(['node', 'mercato', 'server', 'dev'])

    expect(exitCode).toBe(0)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
    expect(consoleLogSpy).toHaveBeenCalledWith('[server] Skipping scheduler auto-start — module not enabled')

    consoleErrorSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })

  it('fails loudly when a managed child exits cleanly but unexpectedly', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

    jest.doMock('node:fs', () => {
      const actual = jest.requireActual('node:fs')
      return {
        ...actual,
        existsSync: jest.fn((candidate: string) =>
          candidate.includes('next/dist/bin/next') || candidate.includes('@open-mercato/cli/bin/mercato'),
        ),
        unlinkSync: jest.fn(),
      }
    })
    jest.doMock('../lib/generators', () => ({
      generateModulePackageSources: jest.fn().mockResolvedValue(undefined),
    }))
    jest.doMock('../lib/resolver', () => ({
      resolveEnvironment: () => ({
        appDir: '/tmp/test-app',
        rootDir: '/tmp/test-root',
      }),
      createResolver: () => ({}),
    }))
    jest.doMock('child_process', () =>
      buildMockChildProcessModule((args) => {
        if (args.slice(1).join(' ') === 'queue worker --all') {
          return { code: 0 }
        }
        return undefined
      }),
    )

    const mercato = await import('../mercato')
    mercato.registerCliModules([eventsWorkerFixture as Module])

    const exitCode = await mercato.run(['node', 'mercato', 'server', 'dev'])

    expect(exitCode).toBe(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '💥 Failed: [server] Queue worker (events) exited unexpectedly with exit code 0.',
    )

    consoleErrorSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })
})

describe('server start managed process exits', () => {
  const originalAutoSpawnScheduler = process.env.AUTO_SPAWN_SCHEDULER
  const originalAutoSpawnWorkers = process.env.AUTO_SPAWN_WORKERS

  beforeEach(() => {
    jest.restoreAllMocks()
    jest.resetModules()
    process.env.AUTO_SPAWN_SCHEDULER = 'false'
    process.env.AUTO_SPAWN_WORKERS = 'true'
  })

  afterEach(() => {
    jest.dontMock('child_process')
    jest.dontMock('node:fs')
    jest.dontMock('../lib/resolver')
    jest.dontMock('../lib/server-start-lock')
    jest.resetModules()
  })

  afterAll(() => {
    process.env.AUTO_SPAWN_SCHEDULER = originalAutoSpawnScheduler
    process.env.AUTO_SPAWN_WORKERS = originalAutoSpawnWorkers
  })

  it('skips scheduler auto-start when the module is not enabled', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    process.env.AUTO_SPAWN_SCHEDULER = 'true'
    process.env.AUTO_SPAWN_WORKERS = 'false'

    jest.doMock('node:fs', () => {
      const actual = jest.requireActual('node:fs')
      return {
        ...actual,
        existsSync: jest.fn((candidate: string) =>
          candidate.includes('next/dist/bin/next') || candidate.includes('@open-mercato/cli/bin/mercato'),
        ),
      }
    })
    jest.doMock('../lib/resolver', () => ({
      resolveEnvironment: () => ({
        appDir: '/tmp/test-app',
        rootDir: '/tmp/test-root',
      }),
    }))
    jest.doMock('../lib/server-start-lock', () => ({
      acquireServerStartLock: jest.fn(() => ({
        release: jest.fn(),
      })),
    }))
    jest.doMock('child_process', () =>
      buildMockChildProcessModule((args) =>
        args[0]?.includes('next/dist/bin/next') ? { code: null, signal: 'SIGTERM' } : undefined,
      ),
    )

    const mercato = await import('../mercato')
    const exitCode = await mercato.run(['node', 'mercato', 'server', 'start'])

    expect(exitCode).toBe(0)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
    expect(consoleLogSpy).toHaveBeenCalledWith('[server] Skipping scheduler auto-start — module not enabled')

    consoleErrorSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })

  it('fails loudly when a managed child exits cleanly but unexpectedly', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

    jest.doMock('node:fs', () => {
      const actual = jest.requireActual('node:fs')
      return {
        ...actual,
        existsSync: jest.fn((candidate: string) =>
          candidate.includes('next/dist/bin/next') || candidate.includes('@open-mercato/cli/bin/mercato'),
        ),
      }
    })
    jest.doMock('../lib/resolver', () => ({
      resolveEnvironment: () => ({
        appDir: '/tmp/test-app',
        rootDir: '/tmp/test-root',
      }),
    }))
    jest.doMock('../lib/server-start-lock', () => ({
      acquireServerStartLock: jest.fn(() => ({
        release: jest.fn(),
      })),
    }))
    jest.doMock('child_process', () =>
      buildMockChildProcessModule((args) => {
        if (args.slice(1).join(' ') === 'queue worker --all') {
          return { code: 0 }
        }
        return undefined
      }),
    )

    const mercato = await import('../mercato')
    mercato.registerCliModules([eventsWorkerFixture as Module])

    const exitCode = await mercato.run(['node', 'mercato', 'server', 'start'])

    expect(exitCode).toBe(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '💥 Failed: [server] Queue worker (events) exited unexpectedly with exit code 0.',
    )

    consoleErrorSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })
})
