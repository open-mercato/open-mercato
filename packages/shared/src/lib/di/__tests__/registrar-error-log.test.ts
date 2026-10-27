// A module DI registrar that throws is skipped fail-open (one broken module
// must not take down every request container), but the failure MUST be logged —
// a silent catch leaves the module's services missing with no trace until an
// unrelated Awilix resolution error surfaces much later.

import { asValue } from 'awilix'
import type { AwilixContainer } from 'awilix'

const mockLoggerError = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => {
  const makeLogger = (): Record<string, unknown> => ({
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    child: () => makeLogger(),
  })
  return {
    __esModule: true,
    createLogger: () => makeLogger(),
    getLogLevel: () => 'info',
    isLevelEnabled: () => false,
  }
})

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
    applyModuleOverridesToModules: (modules: unknown[]) => modules,
    applyComponentOverridesToEntries: (entries: unknown[]) => entries,
  }),
  { virtual: false },
)

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

const {
  createRequestContainer,
  registerAppDiRegistrar,
  registerDiRegistrars,
  resetBootstrapCache,
} = require('@open-mercato/shared/lib/di/container')

describe('createRequestContainer — module DI registrar failures', () => {
  beforeEach(() => {
    resetBootstrapCache()
    registerAppDiRegistrar(null)
    mockLoggerError.mockClear()
  })

  afterAll(() => {
    registerDiRegistrars([])
  })

  it('logs the error and continues with the remaining registrars', async () => {
    const boom = new Error('di exploded')
    const workingRegistrar = jest.fn((container: AwilixContainer) => {
      container.register({ registrarProbeService: asValue('registered') })
    })
    registerDiRegistrars([
      () => { throw boom },
      workingRegistrar,
    ])

    const container = await createRequestContainer()

    expect(workingRegistrar).toHaveBeenCalledTimes(1)
    expect(container.resolve('registrarProbeService')).toBe('registered')
    expect(mockLoggerError).toHaveBeenCalledWith('Module DI registrar failed', {
      registrarIndex: 0,
      err: boom,
    })
  })

  it('does not log when every registrar succeeds', async () => {
    registerDiRegistrars([
      (container: AwilixContainer) => {
        container.register({ registrarProbeService: asValue('ok') })
      },
    ])

    await createRequestContainer()

    expect(mockLoggerError).not.toHaveBeenCalled()
  })
})
