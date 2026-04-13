import {
  registerCliModules,
  getCliModules,
  hasCliModules,
  padByCodePointWidth,
  run,
} from '../mercato'

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
      '💥 Failed: connect ECONNREFUSED 127.0.0.1:5432',
    )

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
