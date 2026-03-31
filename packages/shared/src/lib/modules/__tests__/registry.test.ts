import {
  getModuleSubscribers,
  registerModuleSubscribers,
  getModules,
  registerModules,
} from '../registry'
import type { Module } from '@open-mercato/shared/modules/registry'

const MODULES_GLOBAL_KEY = '__openMercatoModules__'
const MODULE_SUBSCRIBERS_GLOBAL_KEY = '__openMercatoModuleSubscribers__'

function clearRegistryState() {
  delete (globalThis as Record<string, unknown>)[MODULES_GLOBAL_KEY]
  delete (globalThis as Record<string, unknown>)[MODULE_SUBSCRIBERS_GLOBAL_KEY]
}

describe('module registry', () => {
  beforeEach(() => {
    clearRegistryState()
    jest.restoreAllMocks()
  })

  afterAll(() => {
    clearRegistryState()
    jest.restoreAllMocks()
  })

  it('stores module subscribers in the global registry', () => {
    const subscribers: NonNullable<Module['subscribers']> = [
      {
        id: 'customers.created.sync',
        event: 'customers.customer.created',
        sync: true,
        priority: 10,
        handler: jest.fn(),
      },
    ]

    registerModuleSubscribers(subscribers)

    expect(getModuleSubscribers()).toEqual(subscribers)
  })

  it('does not warn when the same subscriber manifest is re-registered', () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {})
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'

    const firstSubscribers: NonNullable<Module['subscribers']> = [
      {
        id: 'customers.created.sync',
        event: 'customers.customer.created',
        sync: true,
        priority: 10,
        handler: jest.fn(),
      },
    ]

    const secondSubscribers: NonNullable<Module['subscribers']> = [
      {
        id: 'customers.created.sync',
        event: 'customers.customer.created',
        sync: true,
        priority: 10,
        handler: jest.fn(),
      },
    ]

    try {
      registerModuleSubscribers(firstSubscribers)
      registerModuleSubscribers(secondSubscribers)
    } finally {
      process.env.NODE_ENV = previousNodeEnv
    }

    expect(debugSpy).not.toHaveBeenCalledWith(
      '[Bootstrap] Module subscribers re-registered (this may occur during HMR)'
    )
  })

  it('warns when a different subscriber manifest is re-registered in development', () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {})
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'

    try {
      registerModuleSubscribers([
        {
          id: 'customers.created.sync',
          event: 'customers.customer.created',
          sync: true,
          priority: 10,
          handler: jest.fn(),
        },
      ])

      registerModuleSubscribers([
        {
          id: 'customers.updated.sync',
          event: 'customers.customer.updated',
          sync: true,
          priority: 10,
          handler: jest.fn(),
        },
      ])
    } finally {
      process.env.NODE_ENV = previousNodeEnv
    }

    expect(debugSpy).toHaveBeenCalledWith(
      '[Bootstrap] Module subscribers re-registered (this may occur during HMR)'
    )
  })

  it('reads modules from the global registry', () => {
    const modules: Module[] = [
      {
        id: 'customers',
      },
    ]

    registerModules(modules)

    expect(getModules()).toEqual(modules)
  })
})
