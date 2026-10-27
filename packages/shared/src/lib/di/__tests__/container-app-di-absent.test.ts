// The app-level DI override module (`@/di`) is OPTIONAL: most apps ship no
// src/di.ts, and packages contexts cannot resolve the alias at all. Its
// absence must not produce warnings — only real load/register failures do
// (covered in container-app-di.test.ts). This file deliberately does NOT
// mock '@/di', so the import fails with module-not-found, exercising the
// quiet branch.

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
const mockDebug = jest.fn()
jest.mock('../../logger', () => ({
  createLogger: () => ({
    debug: (...args: unknown[]) => mockDebug(...args),
    info: jest.fn(),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: jest.fn(),
    child() { return this },
  }),
}))

const {
  createRequestContainer,
  registerAppDiRegistrar,
  registerDiRegistrars,
  resetBootstrapCache,
} = require('@open-mercato/shared/lib/di/container')

describe('app-level DI override hook when @/di is absent', () => {
  beforeEach(() => {
    resetBootstrapCache()
    registerAppDiRegistrar(null)
    registerDiRegistrars([])
    mockWarn.mockClear()
    mockDebug.mockClear()
  })

  it('creates the container without warning', async () => {
    const firstContainer = await createRequestContainer()
    const secondContainer = await createRequestContainer()
    expect(firstContainer).toBeDefined()
    expect(secondContainer).toBeDefined()
    expect(mockWarn).not.toHaveBeenCalled()
  })

  // Worker and CLI processes create one request container per job against built package
  // output, where the app's `@/` alias does not exist. Retrying the doomed import per
  // container repeats a failed module resolution — and its log line — once per job.
  it('stops retrying the unresolvable @/di import after the first container', async () => {
    await createRequestContainer()
    await createRequestContainer()
    await createRequestContainer()

    const unresolvableLogs = mockDebug.mock.calls.filter(
      ([message]) => message === 'App-level DI override module (@/di) not resolvable; skipping',
    )
    expect(unresolvableLogs).toHaveLength(1)
  })

  it('warns once when @/di fails because a nested app alias is missing', async () => {
    const nestedAliasError = Object.assign(new Error("Cannot find module '@/di/helpers'"), {
      code: 'MODULE_NOT_FOUND',
    })
    jest.doMock('@/di', () => {
      throw nestedAliasError
    }, { virtual: true })

    const firstContainer = await createRequestContainer()
    const secondContainer = await createRequestContainer()

    expect(firstContainer).toBeDefined()
    expect(secondContainer).toBeDefined()
    expect(mockWarn).toHaveBeenCalledTimes(1)
    expect(mockWarn).toHaveBeenCalledWith(
      'App-level DI override module (@/di) failed to load; its registrations are skipped',
      { err: nestedAliasError },
    )
  })
})
