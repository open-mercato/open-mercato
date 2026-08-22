const GLOBAL_EVENT_REGISTRY_KEY = '__openMercatoEventDefinitionRegistry__'

type EventFactoryModule = typeof import('../factory')

describe('event definition registry', () => {
  const globalScope = globalThis as Record<string, unknown>
  const originalRegistry = globalScope[GLOBAL_EVENT_REGISTRY_KEY]

  beforeEach(() => {
    delete globalScope[GLOBAL_EVENT_REGISTRY_KEY]
  })

  afterAll(() => {
    if (originalRegistry === undefined) {
      delete globalScope[GLOBAL_EVENT_REGISTRY_KEY]
    } else {
      globalScope[GLOBAL_EVENT_REGISTRY_KEY] = originalRegistry
    }
  })

  it('shares declarations and registered configs across isolated module instances', () => {
    let firstInstance: EventFactoryModule | undefined
    let secondInstance: EventFactoryModule | undefined

    jest.isolateModules(() => {
      firstInstance = require('../factory') as EventFactoryModule
      const config = firstInstance.createModuleEvents({
        moduleId: 'isolated_events_test',
        events: [{
          id: 'isolated_events_test.invalidated',
          label: 'Invalidated',
          crossProcessBroadcast: true,
        }] as const,
      })
      firstInstance.registerEventModuleConfigs([config])
    })

    jest.isolateModules(() => {
      secondInstance = require('../factory') as EventFactoryModule
    })

    expect(secondInstance).not.toBe(firstInstance)
    expect(secondInstance?.isEventDeclared('isolated_events_test.invalidated')).toBe(true)
    expect(secondInstance?.isCrossProcessBroadcastEvent('isolated_events_test.invalidated')).toBe(true)
    expect(secondInstance?.getDeclaredEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'isolated_events_test.invalidated',
        module: 'isolated_events_test',
      }),
    ]))
    expect(secondInstance?.getEventModuleConfigs()).toHaveLength(1)
  })

  it('refreshes a module definition during HMR without duplicating its event id', () => {
    let firstInstance: EventFactoryModule | undefined
    let secondInstance: EventFactoryModule | undefined

    jest.isolateModules(() => {
      firstInstance = require('../factory') as EventFactoryModule
      firstInstance.createModuleEvents({
        moduleId: 'hmr_events_test',
        events: [{ id: 'hmr_events_test.changed', label: 'Before' }] as const,
      })
    })

    jest.isolateModules(() => {
      secondInstance = require('../factory') as EventFactoryModule
      secondInstance.createModuleEvents({
        moduleId: 'hmr_events_test',
        events: [{
          id: 'hmr_events_test.changed',
          label: 'After',
          clientBroadcast: true,
        }] as const,
      })
    })

    expect(firstInstance?.isBroadcastEvent('hmr_events_test.changed')).toBe(true)
    expect(firstInstance?.getAllDeclaredEventIds()).toEqual(['hmr_events_test.changed'])
    expect(firstInstance?.getDeclaredEvents()).toEqual([
      expect.objectContaining({
        id: 'hmr_events_test.changed',
        label: 'After',
        clientBroadcast: true,
      }),
    ])
  })
})
