// Regression tests for module DI registrations under Awilix CLASSIC
// injection mode (silent undefined-dependency injection).
//
// `createRequestContainer()` builds the request container with
// `InjectionMode.CLASSIC`, which resolves factory dependencies by PARAMETER
// NAME. A factory registered as `asFunction(({ em, eventBus }) => ...)`
// WITHOUT `.proxy()` is parsed by CLASSIC as positional dependencies named
// after the destructured keys; awilix resolves each key and passes them as
// separate POSITIONAL arguments. The factory then destructures the FIRST
// positional argument (e.g. the EntityManager instance) instead of the
// cradle, so every destructured dependency comes out `undefined` — no error
// is thrown, the service just silently degrades.
//
// Concrete failures this suite guards against:
// - `catalogPricingService` (catalog/di.ts): `eventBus` resolved to
//   undefined and `eventBus ?? null` masked it as "no event bus", so
//   catalog pricing events were never emitted.
// - `notificationService` (notifications/di.ts): `em`, `eventBus` and
//   `commandBus` were all undefined, so the service crashed (or silently
//   no-oped) on first use.
//
// Both registrations now use `.proxy()` (same pattern as sales,
// integrations and data_sync). These tests resolve the services from a REAL
// `createRequestContainer()` CLASSIC container to keep the wiring honest.

jest.mock('@open-mercato/shared/lib/db/mikro', () => {
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
})

jest.mock('@open-mercato/shared/lib/query/engine', () => ({
  __esModule: true,
  BasicQueryEngine: class {},
}))

jest.mock('@open-mercato/shared/lib/data/engine', () => ({
  __esModule: true,
  DefaultDataEngine: class {},
}))

jest.mock('@open-mercato/shared/lib/commands', () => ({
  __esModule: true,
  commandRegistry: {},
  CommandBus: class { constructor() {} },
}))

jest.mock('@open-mercato/shared/modules/overrides', () => ({
  __esModule: true,
  applyDiOverridesToContainer: () => {},
}))

// Keep this suite hermetic: without this mock the REAL core bootstrap module
// loads (and runs its module-level side effects), polluting globalThis state
// shared with sibling test files.
jest.mock('@open-mercato/core/bootstrap', () => ({
  __esModule: true,
  bootstrap: async () => {},
}))

jest.mock('@open-mercato/shared/lib/encryption/subscriber', () => ({
  __esModule: true,
  registerTenantEncryptionSubscriber: () => {},
}))

// Wrap (not replace) the notification service factory so the test can
// observe the exact dependencies awilix injects while the real factory runs.
jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => {
  const actual = jest.requireActual(
    '@open-mercato/core/modules/notifications/lib/notificationService',
  )
  return {
    __esModule: true,
    ...actual,
    createNotificationService: jest.fn(actual.createNotificationService),
  }
})

import { asValue } from 'awilix'
import { register as registerCatalogDi } from '@open-mercato/core/modules/catalog/di'
import { register as registerNotificationsDi } from '@open-mercato/core/modules/notifications/di'
import { createNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

const {
  createRequestContainer,
  registerDiRegistrars,
  resetBootstrapCache,
} = require('@open-mercato/shared/lib/di/container')

const fakeEventBus = { emit: jest.fn(async () => {}) }

function registerFakeEventBus(container: AppContainer) {
  container.register({ eventBus: asValue(fakeEventBus) })
}

describe('module DI registrations under CLASSIC injection mode', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetBootstrapCache()
    registerDiRegistrars([registerFakeEventBus, registerCatalogDi, registerNotificationsDi])
  })

  it('injects the real eventBus into catalogPricingService', async () => {
    const container = await createRequestContainer()
    const service = container.resolve('catalogPricingService')
    expect(typeof service.resolvePrice).toBe('function')
    expect((service as { eventBus?: unknown }).eventBus).toBe(fakeEventBus)
  })

  it('injects em, eventBus and commandBus into notificationService', async () => {
    const container = await createRequestContainer()
    const service = container.resolve('notificationService')
    expect(typeof service.create).toBe('function')

    expect(createNotificationService).toHaveBeenCalledTimes(1)
    const deps = (createNotificationService as jest.Mock).mock.calls[0][0]
    expect(deps.em).toBe(container.resolve('em'))
    expect(deps.eventBus).toBe(fakeEventBus)
    expect(deps.commandBus).toBe(container.resolve('commandBus'))
  })
})
