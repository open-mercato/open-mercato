import { asValue, createContainer, InjectionMode } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { register } from '../di'

// The real app container is built with InjectionMode.CLASSIC (see
// packages/shared/src/lib/di/container.ts). Under CLASSIC, Awilix injects by
// PARAMETER NAME; a factory whose only parameter is a destructuring pattern has
// no readable name, so every dependency arrives as `undefined` unless the
// registration opts back in with `.proxy()`. Unit tests that construct a service
// directly never notice — the failure only shows up at runtime, on the first
// call that touches an injected dependency.
function makeClassicContainer() {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  const moduleConfigService = { getValue: jest.fn().mockResolvedValue({}), setValue: jest.fn() }
  const cache = { get: jest.fn(), set: jest.fn(), deleteByTags: jest.fn() }
  const eventBus = { emitEvent: jest.fn() }
  container.register({
    moduleConfigService: asValue(moduleConfigService),
    cache: asValue(cache),
    eventBus: asValue(eventBus),
    em: asValue({}),
  })
  register(container as unknown as AppContainer)
  return { container, moduleConfigService, cache, eventBus }
}

describe('catalog DI registration under InjectionMode.CLASSIC', () => {
  it('injects moduleConfigService into catalogOmnibusService', async () => {
    const { container, moduleConfigService } = makeClassicContainer()

    const service = container.resolve('catalogOmnibusService') as {
      getConfig: (scope?: { tenantId?: string | null }) => Promise<unknown>
    }
    await service.getConfig({ tenantId: 'tenant-1' })

    // The real assertion: the call reached the injected dependency instead of
    // throwing "Cannot read properties of undefined (reading 'getValue')".
    expect(moduleConfigService.getValue).toHaveBeenCalledWith(
      'catalog',
      'omnibus',
      expect.objectContaining({ scope: expect.objectContaining({ tenantId: 'tenant-1' }) }),
    )
  })

  it('injects the cache so omnibus results can be tagged and invalidated', async () => {
    const { container, cache } = makeClassicContainer()

    const service = container.resolve('catalogOmnibusService') as Record<string, unknown>

    // Reaching into the instance is deliberate: the point is that the wiring
    // handed over the real cache rather than the `?? null` fallback, which is
    // exactly what CLASSIC mode silently substituted.
    expect(service.cache).toBe(cache)
  })

  it('injects eventBus into catalogPricingService', () => {
    const { container, eventBus } = makeClassicContainer()

    const service = container.resolve('catalogPricingService') as Record<string, unknown>

    expect(service.eventBus).toBe(eventBus)
  })

  it('keeps the omnibus service scoped so one request sees one config read', () => {
    const { container } = makeClassicContainer()

    const scopeA = container.createScope()
    const scopeB = container.createScope()

    expect(scopeA.resolve('catalogOmnibusService')).toBe(scopeA.resolve('catalogOmnibusService'))
    expect(scopeA.resolve('catalogOmnibusService')).not.toBe(scopeB.resolve('catalogOmnibusService'))
  })
})
