const createBootstrapMock = jest.fn(() => jest.fn())
const registerAppDictionaryLoaderMock = jest.fn()
const registerEventModuleConfigsMock = jest.fn()
const registerMessageTypesMock = jest.fn()
const registerMessageObjectTypesMock = jest.fn()
const runBootstrapRegistrationsMock = jest.fn()

describe('app bootstrap', () => {
  beforeEach(() => {
    jest.resetModules()
    createBootstrapMock.mockClear()
    registerAppDictionaryLoaderMock.mockClear()
    registerEventModuleConfigsMock.mockClear()
    registerMessageTypesMock.mockClear()
    registerMessageObjectTypesMock.mockClear()
    runBootstrapRegistrationsMock.mockClear()
  })

  it('registers the slim app module manifest instead of the route-aware full registry', async () => {
    const fullModules = [{ id: 'full', backendRoutes: [{ pattern: '/backend/customers' }] }]
    const appModules = [{ id: 'app-only' }]

    jest.doMock('@open-mercato/shared/lib/i18n/server', () => ({
      registerAppDictionaryLoader: registerAppDictionaryLoaderMock,
    }))
    jest.doMock('@/.mercato/generated/modules.generated', () => ({ modules: fullModules }))
    jest.doMock('@/.mercato/generated/modules.app.generated', () => ({ modules: appModules }))
    jest.doMock('@/.mercato/generated/entities.generated', () => ({ entities: [] }))
    jest.doMock('@/.mercato/generated/di.generated', () => ({ diRegistrars: [] }))
    jest.doMock('@/.mercato/generated/entities.ids.generated', () => ({ E: {} }))
    jest.doMock('@/.mercato/generated/entity-fields-registry', () => ({ entityFieldsRegistry: {} }))
    jest.doMock('@/.mercato/generated/dashboard-widgets.generated', () => ({ dashboardWidgetEntries: [] }))
    jest.doMock('@/.mercato/generated/injection-widgets.generated', () => ({ injectionWidgetEntries: [] }))
    jest.doMock('@/.mercato/generated/translations-fields.generated', () => ({}))
    jest.doMock('@/.mercato/generated/injection-tables.generated', () => ({ injectionTables: [] }))
    jest.doMock('@/.mercato/generated/search.generated', () => ({ searchModuleConfigs: [] }))
    jest.doMock('@/.mercato/generated/events.generated', () => ({ eventModuleConfigs: [], allEvents: [] }))
    jest.doMock('@/.mercato/generated/analytics.generated', () => ({ analyticsModuleConfigs: [] }))
    jest.doMock('@/.mercato/generated/enrichers.generated', () => ({ enricherEntries: [] }))
    jest.doMock('@/.mercato/generated/interceptors.generated', () => ({ interceptorEntries: [] }))
    jest.doMock('@/.mercato/generated/component-overrides.generated', () => ({ componentOverrideEntries: [] }))
    jest.doMock('@/.mercato/generated/guards.generated', () => ({ guardEntries: [] }))
    jest.doMock('@/.mercato/generated/command-interceptors.generated', () => ({ commandInterceptorEntries: [] }))
    jest.doMock('@/.mercato/generated/notification-handlers.generated', () => ({ notificationHandlerEntries: [] }))
    jest.doMock('@/.mercato/generated/message-types.generated', () => ({ messageTypes: [] }))
    jest.doMock('@/.mercato/generated/message-objects.generated', () => ({ messageObjectTypes: [] }))
    jest.doMock('@/.mercato/generated/bootstrap-registrations.generated', () => ({
      runBootstrapRegistrations: runBootstrapRegistrationsMock,
    }))
    jest.doMock('@open-mercato/shared/modules/events', () => ({
      registerEventModuleConfigs: registerEventModuleConfigsMock,
    }))
    jest.doMock('@open-mercato/core/modules/messages/lib/message-types-registry', () => ({
      registerMessageTypes: registerMessageTypesMock,
    }))
    jest.doMock('@open-mercato/core/modules/messages/lib/message-objects-registry', () => ({
      registerMessageObjectTypes: registerMessageObjectTypesMock,
    }))
    jest.doMock('@open-mercato/shared/lib/bootstrap', () => ({
      createBootstrap: createBootstrapMock,
      isBootstrapped: jest.fn(() => false),
    }))

    await import('@/bootstrap')

    expect(createBootstrapMock).toHaveBeenCalledTimes(1)
    expect(createBootstrapMock.mock.calls[0][0].modules).toBe(appModules)
    expect(createBootstrapMock.mock.calls[0][0].modules).not.toBe(fullModules)
  })
})
