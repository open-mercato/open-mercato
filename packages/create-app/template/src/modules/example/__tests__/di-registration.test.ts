/** @jest-environment node */
/**
 * The module's own DI registration, exercised against a real Awilix container.
 *
 * Lifetime is the part worth pinning: the service closes over the request
 * container's `em`, so a SINGLETON would pin one request's EntityManager — and with
 * it one request's tenant — for the life of the process.
 */
import { createCalendarEventTypeRegistry, resetCalendarEventTypeRegistryForTests, resolveCalendarEventType } from '@open-mercato/core/modules/customers/calendar-event-types'
import { getProcessDiRegistrar, runCallerSetups, runProcessActivations } from '@open-mercato/shared/lib/di/process-registrar'
import { InjectionMode, asValue, createContainer } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CacheStrategy } from '@open-mercato/cache'
import { EXAMPLE_TODO_SUMMARY_SERVICE, register } from '../di'
import type { TodoSummaryService } from '../lib/todoSummaryCache'
import * as gatewayRegistry from '@open-mercato/shared/modules/payment_gateways/types'
import * as shippingRegistry from '@open-mercato/core/modules/shipping_carriers/lib/adapter-registry'
import * as webhookRegistry from '@open-mercato/webhooks/modules/webhooks/lib/adapter-registry'
import * as currencyRegistry from '@open-mercato/core/modules/currencies/services/providers/registry'

const TENANT_A = '00000000-0000-4000-8000-00000000000a'
const ORG_A1 = '00000000-0000-4000-8000-0000000000a1'

function stubCache(): CacheStrategy {
  return {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    has: jest.fn(async () => false),
    delete: jest.fn(async () => false),
    deleteByTags: jest.fn(async () => 0),
    clear: jest.fn(async () => 0),
    keys: jest.fn(async () => []),
    stats: jest.fn(async () => ({ size: 0, expired: 0 })),
  }
}

function buildContainer(counts: { total: number; done: number }) {
  // CLASSIC, matching `packages/shared/src/lib/di/container.ts`. This is not a detail: classic
  // injection resolves one registration per PARAMETER NAME, so a factory declared with a single
  // named parameter resolves nothing and throws at request time. Building this fixture with
  // PROXY hid exactly that failure — the summary route returned 500 for every caller while this
  // test stayed green — so the fixture now mirrors the container the app actually builds.
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  const count = jest.fn(async (_entity: unknown, where: Record<string, unknown>) =>
    where.isDone === true ? counts.done : counts.total,
  )
  container.register({
    em: asValue({ count }),
    cache: asValue(stubCache()),
  })
  register(container as unknown as AppContainer)
  return { container, count }
}

describe('example module DI registration', () => {
  it('decorates the request command bus with Visit booking serialization', async () => {
    const execute = jest.fn(async (_commandId: string, _options: unknown) => ({ result: { ok: true }, logEntry: null }))
    const originalCommandBus = { execute }
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      commandBus: asValue(originalCommandBus),
      em: asValue({}),
      queryEngine: asValue({ query: jest.fn() }),
    })

    register(container as unknown as AppContainer)
    const decorated = container.resolve<{ execute: typeof execute }>('commandBus')
    expect(decorated).not.toBe(originalCommandBus)
    await decorated.execute('example.todos.update', { input: {}, ctx: {} })
    expect(execute).toHaveBeenCalledWith('example.todos.update', { input: {}, ctx: {} })
  })

  it('registers the todo summary service as a scoped Awilix function provider', () => {
    const { container } = buildContainer({ total: 0, done: 0 })
    const registration = container.registrations[EXAMPLE_TODO_SUMMARY_SERVICE]

    expect(EXAMPLE_TODO_SUMMARY_SERVICE).toBe('exampleTodoSummaryService')
    expect(registration).toBeDefined()
    expect(registration.lifetime).toBe('SCOPED')
  })

  it('resolves a working service that reads counts through the injected EntityManager', async () => {
    const { container, count } = buildContainer({ total: 6, done: 2 })

    const service = container.createScope().resolve<TodoSummaryService>(EXAMPLE_TODO_SUMMARY_SERVICE)
    const result = await service.read({ tenantId: TENANT_A, organizationId: ORG_A1 })

    expect(result.summary).toEqual({
      total: 6,
      done: 2,
      open: 4,
      tenantId: TENANT_A,
      organizationId: ORG_A1,
    })
    for (const call of count.mock.calls) {
      expect(call[1]).toMatchObject({ tenantId: TENANT_A, organizationId: ORG_A1, deletedAt: null })
    }
  })

  it('gives each scope its own instance so one request cannot pin another request state', () => {
    const { container } = buildContainer({ total: 0, done: 0 })

    const first = container.createScope().resolve(EXAMPLE_TODO_SUMMARY_SERVICE)
    const second = container.createScope().resolve(EXAMPLE_TODO_SUMMARY_SERVICE)

    expect(first).not.toBe(second)
  })
})


describe('example calendar API registration', () => {
  it('registers Visit through optional DI without loading the visual widget registry', () => {
    resetCalendarEventTypeRegistryForTests()
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ calendarEventTypeRegistry: asValue(createCalendarEventTypeRegistry()) })
    register(container)
    expect(resolveCalendarEventType('visit')).toMatchObject({ key: 'visit', adminConfigurable: false })
    expect(resolveCalendarEventType('note')).toBeDefined()
    expect(resolveCalendarEventType('meeting')?.labelKey).toBe('customers.calendar.editor.types.meeting')
  })

  it('continues registration when Customers is absent', () => {
    expect(() => register(createContainer({ injectionMode: InjectionMode.CLASSIC }))).not.toThrow()
  })
})


it('decorates each process-root caller command bus without resolving it during registration', async () => {
  const root = createContainer({ injectionMode: InjectionMode.CLASSIC })
  const rootResolve = jest.spyOn(root, 'resolve')
  await getProcessDiRegistrar(register)!(root as AppContainer)
  expect(rootResolve).not.toHaveBeenCalledWith('commandBus')
  const first = root.createScope()
  const second = root.createScope()
  const executeFirst = jest.fn(async () => ({ result: {}, logEntry: null }))
  const executeSecond = jest.fn(async () => ({ result: {}, logEntry: null }))
  first.register({ commandBus: asValue({ execute: executeFirst }) })
  second.register({ commandBus: asValue({ execute: executeSecond }) })
  await runCallerSetups(root as AppContainer, first as AppContainer)
  await runCallerSetups(root as AppContainer, second as AppContainer)
  await first.resolve<{ execute: (name: string, input: unknown) => Promise<unknown> }>('commandBus').execute('example.todos.update', { input: {}, ctx: {} })
  expect(executeFirst).toHaveBeenCalledTimes(1)
  expect(executeSecond).not.toHaveBeenCalled()
  expect(first.resolve('commandBus')).not.toBe(second.resolve('commandBus'))
})


describe('example process activation', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    resetCalendarEventTypeRegistryForTests()
  })

  function watchProviderRegistrations() {
    return [
      { register: jest.spyOn(gatewayRegistry, 'registerGatewayAdapter').mockImplementation(() => () => {}), count: 4 },
      { register: jest.spyOn(gatewayRegistry, 'registerWebhookHandler').mockImplementation(() => () => {}), count: 4 },
      { register: jest.spyOn(gatewayRegistry, 'registerPaymentGatewayDescriptor').mockImplementation(() => () => {}), count: 4 },
      { register: jest.spyOn(shippingRegistry, 'registerShippingAdapter').mockImplementation(() => () => {}), count: 1 },
      { register: jest.spyOn(webhookRegistry, 'registerWebhookEndpointAdapter').mockImplementation(() => () => {}), count: 1 },
      { register: jest.spyOn(currencyRegistry, 'registerCurrencyRateProvider').mockImplementation(() => () => {}), count: 1 },
    ]
  }

  it('publishes calendar and providers only for an activated generation', async () => {
    resetCalendarEventTypeRegistryForTests()
    const providers = watchProviderRegistrations()
    const calendarRegistry = createCalendarEventTypeRegistry()
    const upsert = jest.spyOn(calendarRegistry, 'upsert')
    const replace = jest.spyOn(calendarRegistry, 'replace')
    const patch = jest.spyOn(calendarRegistry, 'patch')
    const discarded = createContainer({ injectionMode: InjectionMode.CLASSIC })
    const current = createContainer({ injectionMode: InjectionMode.CLASSIC })
    for (const root of [discarded, current]) {
      root.register({ calendarEventTypeRegistry: asValue(calendarRegistry) })
      await getProcessDiRegistrar(register)!(root)
      expect(root.hasRegistration(EXAMPLE_TODO_SUMMARY_SERVICE)).toBe(true)
    }
    await discarded.dispose()
    expect(upsert).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    expect(patch).not.toHaveBeenCalled()
    expect(resolveCalendarEventType('visit')).toBeUndefined()
    for (const provider of providers) expect(provider.register).not.toHaveBeenCalled()

    runProcessActivations(current)
    expect(upsert).toHaveBeenCalled()
    expect(resolveCalendarEventType('visit')).toMatchObject({ key: 'visit', adminConfigurable: false })
    for (const provider of providers) expect(provider.register).toHaveBeenCalledTimes(provider.count)
    await current.dispose()
  })

  it('publishes legacy providers immediately without an activation step', () => {
    const providers = watchProviderRegistrations()
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    register(container)
    for (const provider of providers) expect(provider.register).toHaveBeenCalledTimes(provider.count)
  })
})
