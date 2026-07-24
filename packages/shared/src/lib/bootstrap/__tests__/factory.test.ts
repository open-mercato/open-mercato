import type { BootstrapData } from '../types'
import { createBootstrap, isBootstrapped, resetBootstrapState } from '../factory'

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
  })

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv
  })

  it('runs distinct registration keys once each', () => {
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

    expect(apiComplete).toHaveBeenCalledTimes(1)
    expect(fullComplete).toHaveBeenCalledTimes(1)
    expect(isBootstrapped()).toBe(true)
  })
})
