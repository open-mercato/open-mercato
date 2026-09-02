/** @jest-environment node */

import type { DataSyncAdapter } from '../adapter'
import { applicableStartControls, resolveStartControlMap } from '../start-controls'

function buildAdapter(overrides: Partial<DataSyncAdapter> = {}): DataSyncAdapter {
  return {
    providerKey: 'mixed-provider',
    direction: 'import',
    supportedEntities: ['orders.feed', 'orders.backfill'],
    getMapping: async ({ entityType }) => ({ entityType, matchStrategy: 'externalId' as const, fields: [] }),
    ...overrides,
  }
}

describe('resolveStartControlMap', () => {
  it('returns an empty map for an adapter that declares nothing', () => {
    expect(resolveStartControlMap(buildAdapter())).toEqual({})
  })

  it('returns an empty map when no adapter resolved at all', () => {
    expect(resolveStartControlMap(null)).toEqual({})
  })

  it('records only the entity types the adapter restricts', () => {
    const map = resolveStartControlMap(buildAdapter({
      supportsStartControl: (control, entityType) => !(control === 'fullSync' && entityType === 'orders.backfill'),
    }))

    expect(map).toEqual({
      'orders.backfill': { fullSync: false, batchSize: true },
    })
  })

  it('records each control independently for the same entity type', () => {
    const map = resolveStartControlMap(buildAdapter({
      supportedEntities: ['orders.backfill'],
      supportsStartControl: () => false,
    }))

    expect(map).toEqual({
      'orders.backfill': { fullSync: false, batchSize: false },
    })
  })

  it('treats any return other than an explicit false as applicable', () => {
    const map = resolveStartControlMap(buildAdapter({
      supportsStartControl: (() => undefined) as unknown as DataSyncAdapter['supportsStartControl'],
    }))

    expect(map).toEqual({})
  })

  // One adapter's broken predicate must not fail `api/data_sync/options`, which
  // evaluates every registered adapter in a single response.
  it('treats a throwing predicate as applicable', () => {
    const map = resolveStartControlMap(buildAdapter({
      supportsStartControl: () => {
        throw new Error('[internal] adapter predicate blew up')
      },
    }))

    expect(map).toEqual({})
  })

  it('never asks about an entity type the adapter does not support', () => {
    const supportsStartControl = jest.fn(() => true)
    resolveStartControlMap(buildAdapter({ supportedEntities: ['orders.feed'], supportsStartControl }))

    const askedEntityTypes = new Set(supportsStartControl.mock.calls.map((call) => (call as unknown[])[1]))
    expect([...askedEntityTypes]).toEqual(['orders.feed'])
  })
})

describe('applicableStartControls', () => {
  it('applies every control for an entity type the map does not restrict', () => {
    expect(applicableStartControls({ 'orders.backfill': { fullSync: false, batchSize: true } }, 'orders.feed'))
      .toEqual({ fullSync: true, batchSize: true })
  })

  it('applies every control when the integration shipped no map', () => {
    expect(applicableStartControls(undefined, 'orders.feed')).toEqual({ fullSync: true, batchSize: true })
  })

  it('applies every control before an entity type is selected', () => {
    expect(applicableStartControls({ 'orders.backfill': { fullSync: false, batchSize: true } }, ''))
      .toEqual({ fullSync: true, batchSize: true })
  })

  it('reads the declaration for a restricted entity type', () => {
    expect(applicableStartControls({ 'orders.backfill': { fullSync: false, batchSize: true } }, 'orders.backfill'))
      .toEqual({ fullSync: false, batchSize: true })
  })

  it('ignores inherited properties so a prototype-shaped entity type keeps its controls', () => {
    expect(applicableStartControls({}, 'constructor')).toEqual({ fullSync: true, batchSize: true })
    expect(applicableStartControls({}, '__proto__')).toEqual({ fullSync: true, batchSize: true })
  })
})
