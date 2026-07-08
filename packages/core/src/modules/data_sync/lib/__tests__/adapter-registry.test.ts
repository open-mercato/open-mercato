import type { DataSyncAdapter } from '../adapter'

const REGISTRY_KEY = Symbol.for('@open-mercato/core/data_sync/adapter-registry')

function makeAdapter(providerKey: string): DataSyncAdapter {
  return {
    providerKey,
    direction: 'import',
    supportedEntities: [],
    getMapping: async () => ({ entityType: 'x', fields: [], matchStrategy: 'externalId' }),
  }
}

function clearGlobalRegistry(): void {
  delete (globalThis as Record<symbol, unknown>)[REGISTRY_KEY]
}

describe('data_sync adapter registry', () => {
  beforeEach(() => {
    clearGlobalRegistry()
    jest.resetModules()
  })

  afterEach(() => {
    clearGlobalRegistry()
  })

  it('registers and retrieves an adapter by providerKey', () => {
    const { registerDataSyncAdapter, getDataSyncAdapter } = require('../adapter-registry')
    const adapter = makeAdapter('subiekt')
    registerDataSyncAdapter(adapter)
    expect(getDataSyncAdapter('subiekt')).toBe(adapter)
  })

  it('returns undefined for an unknown providerKey', () => {
    const { getDataSyncAdapter } = require('../adapter-registry')
    expect(getDataSyncAdapter('nonexistent')).toBeUndefined()
  })

  it('lists all registered adapters', () => {
    const { registerDataSyncAdapter, getAllDataSyncAdapters } = require('../adapter-registry')
    const a = makeAdapter('subiekt')
    const b = makeAdapter('akeneo')
    registerDataSyncAdapter(a)
    registerDataSyncAdapter(b)
    expect(getAllDataSyncAdapters()).toEqual(expect.arrayContaining([a, b]))
    expect(getAllDataSyncAdapters()).toHaveLength(2)
  })

  // Regression for the bundler module-duplication bug: when a bundler emits this
  // file into more than one chunk, each copy holds its own module-local state.
  // Loading the module twice simulates that. An adapter registered through one
  // copy must be visible through the other because both resolve the same
  // globalThis-backed Map — a plain module-local Map would fail this.
  it('shares state across duplicated module instances via globalThis', () => {
    jest.isolateModules(() => {
      const first = require('../adapter-registry')
      first.registerDataSyncAdapter(makeAdapter('subiekt'))
    })
    jest.isolateModules(() => {
      const second = require('../adapter-registry')
      expect(second.getDataSyncAdapter('subiekt')?.providerKey).toBe('subiekt')
    })
  })
})
