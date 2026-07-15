// Tests for the app-level DI override hook (`src/di.ts` → `@/di`) in
// `createRequestContainer()`. The hook used to swallow EVERY failure with
// bare `catch {}` blocks, so a src/di.ts whose register() threw — or a @/di
// module that failed to load for any reason other than being absent — was
// skipped without a trace and the documented override point silently did
// nothing. Absence of the optional module must stay quiet; real failures
// must be logged.

import { asValue } from 'awilix'

jest.mock(
  '@open-mercato/shared/lib/db/mikro',
  () => {
    const baseEm: any = {
      fork: () => baseEm,
      getRepository: () => ({ find: async () => [], findOne: async () => null }),
    }
    return {
      __esModule: true,
      getOrm: async () => ({ em: baseEm }),
      getOrmEntities: () => [],
      registerOrmEntities: () => {},
    }
  },
  { virtual: false },
)

jest.mock(
  '@mikro-orm/core',
  () => ({
    __esModule: true,
    RequestContext: { getEntityManager: () => null },
  }),
  { virtual: true },
)

jest.mock(
  '@open-mercato/shared/lib/query/engine',
  () => ({ __esModule: true, BasicQueryEngine: class {} }),
  { virtual: false },
)

jest.mock(
  '@open-mercato/shared/lib/data/engine',
  () => ({ __esModule: true, DefaultDataEngine: class {} }),
  { virtual: false },
)

jest.mock(
  '@open-mercato/shared/lib/commands',
  () => ({
    __esModule: true,
    commandRegistry: {},
    CommandBus: class { constructor() {} },
  }),
  { virtual: false },
)

jest.mock(
  '@open-mercato/shared/modules/overrides',
  () => ({
    __esModule: true,
    applyDiOverridesToContainer: () => {},
  }),
  { virtual: false },
)

// Keep this suite hermetic: without this mock the REAL core bootstrap module
// loads (and runs its module-level side effects) whenever generated files
// exist on disk, polluting globalThis state shared with sibling test files.
jest.mock(
  '@open-mercato/core/bootstrap',
  () => ({
    __esModule: true,
    bootstrap: async () => {},
  }),
  { virtual: true },
)

jest.mock(
  '@open-mercato/shared/lib/encryption/subscriber',
  () => ({
    __esModule: true,
    registerTenantEncryptionSubscriber: () => {},
  }),
  { virtual: true },
)

const mockWarn = jest.fn()
jest.mock('../../logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: jest.fn(),
    child() { return this },
  }),
}))

const mockAppDiRegister = jest.fn()
jest.mock(
  '@/di',
  () => ({
    __esModule: true,
    register: (...args: unknown[]) => mockAppDiRegister(...args),
  }),
  { virtual: true },
)

const {
  createRequestContainer,
  registerDiRegistrars,
  resetBootstrapCache,
} = require('@open-mercato/shared/lib/di/container')

describe('app-level DI override hook (@/di)', () => {
  beforeEach(() => {
    resetBootstrapCache()
    registerDiRegistrars([])
    mockWarn.mockClear()
    mockAppDiRegister.mockReset()
  })

  it('calls register() with the request container and applies its registrations', async () => {
    mockAppDiRegister.mockImplementation((container: any) => {
      container.register({ appOverrideProbe: asValue('from-app-di') })
    })
    const container = await createRequestContainer()
    expect(mockAppDiRegister).toHaveBeenCalledTimes(1)
    expect(mockAppDiRegister).toHaveBeenCalledWith(container)
    expect(container.resolve('appOverrideProbe')).toBe('from-app-di')
    expect(mockWarn).not.toHaveBeenCalled()
  })

  it('awaits an async register()', async () => {
    mockAppDiRegister.mockImplementation(async (container: any) => {
      await Promise.resolve()
      container.register({ appOverrideProbe: asValue('async-app-di') })
    })
    const container = await createRequestContainer()
    expect(container.resolve('appOverrideProbe')).toBe('async-app-di')
    expect(mockWarn).not.toHaveBeenCalled()
  })

  it('warns instead of silently swallowing when register() throws', async () => {
    mockAppDiRegister.mockImplementation(() => {
      throw new Error('boom from app di')
    })
    const container = await createRequestContainer()
    expect(container).toBeDefined()
    expect(mockWarn).toHaveBeenCalledTimes(1)
    const [message, fields] = mockWarn.mock.calls[0]
    expect(String(message)).toContain('register()')
    expect((fields as { err: Error }).err.message).toBe('boom from app di')
  })

  it('warns when an async register() rejects', async () => {
    mockAppDiRegister.mockImplementation(async () => {
      throw new Error('async boom from app di')
    })
    const container = await createRequestContainer()
    expect(container).toBeDefined()
    expect(mockWarn).toHaveBeenCalledTimes(1)
  })
})
