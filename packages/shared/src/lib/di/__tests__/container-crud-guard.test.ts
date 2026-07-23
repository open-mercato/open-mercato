// Regression test for the default `crudMutationGuardService` registration
// under Awilix CLASSIC injection mode (issue: silent optimistic-lock bypass).
//
// `createRequestContainer()` builds the container with
// `InjectionMode.CLASSIC`, which resolves factory dependencies by PARAMETER
// NAME. The registration used to destructure-and-rename the cradle —
// `asFunction(({ em: scopedEm }) => ...)` — which CLASSIC parses as a
// dependency named `scopedEm`. Nothing registers that key, so every
// `container.resolve('crudMutationGuardService')` threw, `bridgeLegacyGuard`
// swallowed the error into "no guard", and optimistic locking was silently
// disabled for every `makeCrudRoute` update/delete.

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

import { bridgeLegacyGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

const {
  createRequestContainer,
  registerDiRegistrars,
  resetBootstrapCache,
} = require('@open-mercato/shared/lib/di/container')

describe('default crudMutationGuardService under CLASSIC injection mode', () => {
  beforeEach(() => {
    resetBootstrapCache()
    registerDiRegistrars([])
  })

  it('resolves the default optimistic-lock guard service from a request container', async () => {
    const container = await createRequestContainer()
    const service = container.resolve('crudMutationGuardService')
    expect(typeof service.validateMutation).toBe('function')
    expect(typeof service.afterMutationSuccess).toBe('function')
  })

  it('resolves the default command-level optimistic-lock guard service', async () => {
    const container = await createRequestContainer()
    const service = container.resolve('commandOptimisticLockGuardService')
    expect(typeof service.enforce).toBe('function')
  })

  it('bridges the default guard service into the mutation-guard registry', async () => {
    const container = await createRequestContainer()
    const guard = bridgeLegacyGuard(container)
    expect(guard).not.toBeNull()
    expect(guard?.id).toBe('_legacy.crud-mutation-guard-service')
    expect(guard?.operations).toEqual(['update', 'delete'])
  })
})
