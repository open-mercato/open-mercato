import type { BootstrapData } from '../types'
import { createBootstrap, isBootstrapped, resetBootstrapState, waitForAsyncRegistration } from '../factory'

const registerCoreInjectionWidgetsMock = jest.fn()
const registerCoreInjectionTablesMock = jest.fn()
const registerEnabledModuleIdsMock = jest.fn()

jest.mock('@open-mercato/core/modules/widgets/lib/injection', () => ({
  registerCoreInjectionWidgets: registerCoreInjectionWidgetsMock,
  registerCoreInjectionTables: registerCoreInjectionTablesMock,
  registerEnabledModuleIds: registerEnabledModuleIdsMock,
}))

const emptyBootstrapData: BootstrapData = {
  modules: [],
  entities: [],
  diRegistrars: [],
  entityIds: {},
  dashboardWidgetEntries: [],
  injectionWidgetEntries: [],
  injectionTables: [],
  searchModuleConfigs: [],
}

describe('partitioned bootstrap registration', () => {
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    resetBootstrapState()
    process.env.NODE_ENV = 'production'
    registerCoreInjectionWidgetsMock.mockReset()
    registerCoreInjectionTablesMock.mockReset()
    registerEnabledModuleIdsMock.mockReset()
  })

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv
  })

  it('runs distinct registration keys once each', async () => {
    const apiComplete = jest.fn()
    const fullComplete = jest.fn()
    const apiBootstrap = createBootstrap(emptyBootstrapData, {
      registrationKey: 'api',
      skipUiRegistries: true,
      onRegistrationComplete: apiComplete,
    })
    const fullBootstrap = createBootstrap(emptyBootstrapData, {
      registrationKey: 'full',
      onRegistrationComplete: fullComplete,
    })

    apiBootstrap()
    apiBootstrap()
    fullBootstrap()
    fullBootstrap()
    await waitForAsyncRegistration()

    expect(apiComplete).toHaveBeenCalledTimes(1)
    expect(fullComplete).toHaveBeenCalledTimes(1)
    expect(isBootstrapped()).toBe(true)
  })

  it('keeps API-only bootstrap from replacing core injection widgets', async () => {
    const entry = { moduleId: 'example', key: 'example:widget', source: 'app' as const, loader: async () => ({}) as never }
    const apiBootstrap = createBootstrap({ ...emptyBootstrapData, injectionWidgetEntries: [entry] }, {
      registrationKey: 'api-only',
      skipUiRegistries: true,
      skipCoreInjectionWidgets: true,
    })

    apiBootstrap()
    await waitForAsyncRegistration()

    // The API partition still contributes its entries — module API routes resolve widget
    // contributions on the request path — but in `merge` mode, so it can never shrink a
    // registry the full page bootstrap already published in the same process.
    expect(registerCoreInjectionWidgetsMock).toHaveBeenCalledWith([entry], { mode: 'merge' })
    // The raw widget entries also travel with the tables so a `key`-spelled injection
    // override resolves to the `widgetId` the slots reference (#5152).
    expect(registerCoreInjectionTablesMock).toHaveBeenCalledWith([], [entry])
    expect(registerEnabledModuleIdsMock).toHaveBeenCalledTimes(1)
  })

  it('lets the full bootstrap replace the registry outright', async () => {
    const fullBootstrap = createBootstrap(emptyBootstrapData, { registrationKey: 'full-only' })

    fullBootstrap()
    await waitForAsyncRegistration()

    expect(registerCoreInjectionWidgetsMock).toHaveBeenCalledWith([], undefined)
  })
})
