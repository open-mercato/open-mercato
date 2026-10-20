import type { BootstrapData } from '../types'
import { createBootstrap, resetBootstrapState, waitForAsyncRegistration } from '../factory'
import { getModules } from '../../modules/registry'
import { getEntityIds } from '../../encryption/entityIds'

jest.mock('@open-mercato/core/modules/widgets/lib/injection', () => ({
  registerCoreInjectionWidgets: jest.fn(),
  registerCoreInjectionTables: jest.fn(),
  registerEnabledModuleIds: jest.fn(),
}))

const ENTITY_IDS = { insights: { process_run: 'insights:process_run' } }

function bootstrapData(overrides: Partial<BootstrapData> = {}): BootstrapData {
  return {
    modules: [{ id: 'insights' }],
    entities: [],
    diRegistrars: [],
    entityIds: ENTITY_IDS,
    dashboardWidgetEntries: [],
    injectionWidgetEntries: [],
    injectionTables: [],
    searchModuleConfigs: [],
    ...overrides,
  }
}

describe('createBootstrap — CLI generator-plugin registrations (step 6h)', () => {
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    resetBootstrapState()
    process.env.NODE_ENV = 'production'
  })

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv
  })

  it('runs cliBootstrapRegistrations once, after modules and entity ids are registered', async () => {
    const seen: { moduleIds: string[]; entityIds: unknown } = { moduleIds: [], entityIds: null }
    const cliBootstrapRegistrations = jest.fn(() => {
      seen.moduleIds = getModules().map((module) => module.id)
      seen.entityIds = getEntityIds()
    })
    const bootstrap = createBootstrap(bootstrapData({ cliBootstrapRegistrations }), {
      registrationKey: 'cli-registrations',
      skipUiRegistries: true,
    })

    bootstrap()
    await waitForAsyncRegistration()

    expect(cliBootstrapRegistrations).toHaveBeenCalledTimes(1)
    expect(cliBootstrapRegistrations).toHaveBeenCalledWith()
    expect(seen.moduleIds).toContain('insights')
    expect(seen.entityIds).toEqual(ENTITY_IDS)
  })

  it('runs the registrations before reporting the registration as complete', () => {
    const order: string[] = []
    const bootstrap = createBootstrap(
      bootstrapData({ cliBootstrapRegistrations: () => { order.push('cli-registrations') } }),
      {
        registrationKey: 'cli-registrations-order',
        skipUiRegistries: true,
        onRegistrationComplete: () => { order.push('complete') },
      },
    )

    bootstrap()

    expect(order).toEqual(['cli-registrations', 'complete'])
  })

  it('does not run the registrations again for an already bootstrapped key outside development', () => {
    const cliBootstrapRegistrations = jest.fn()
    const bootstrap = createBootstrap(bootstrapData({ cliBootstrapRegistrations }), {
      registrationKey: 'cli-registrations-repeat',
      skipUiRegistries: true,
    })

    bootstrap()
    bootstrap()

    expect(cliBootstrapRegistrations).toHaveBeenCalledTimes(1)
  })

  it('bootstraps normally when no CLI registrations were generated', async () => {
    const onRegistrationComplete = jest.fn()
    const bootstrap = createBootstrap(bootstrapData(), {
      registrationKey: 'cli-registrations-absent',
      skipUiRegistries: true,
      onRegistrationComplete,
    })

    expect(() => bootstrap()).not.toThrow()
    await waitForAsyncRegistration()

    expect(onRegistrationComplete).toHaveBeenCalledTimes(1)
    expect(getModules().map((module) => module.id)).toContain('insights')
  })
})
