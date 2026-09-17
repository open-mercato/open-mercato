/** @jest-environment node */

import type { DataSyncAdapter } from '../adapter'
import {
  DATA_SYNC_DEFAULT_BATCH_SIZE,
  declaredDefaultBatchSize,
  defaultBatchSizeFor,
  resolveDefaultBatchSizeMap,
} from '../default-batch-size'

function buildAdapter(overrides: Partial<DataSyncAdapter> = {}): DataSyncAdapter {
  return {
    providerKey: 'mixed-provider',
    direction: 'import',
    supportedEntities: ['orders.feed', 'orders.backfill'],
    getMapping: async ({ entityType }) => ({ entityType, matchStrategy: 'externalId' as const, fields: [] }),
    ...overrides,
  }
}

describe('resolveDefaultBatchSizeMap', () => {
  it('returns an empty map for an adapter that declares nothing', () => {
    expect(resolveDefaultBatchSizeMap(buildAdapter())).toEqual({})
  })

  it('returns an empty map when no adapter resolved at all', () => {
    expect(resolveDefaultBatchSizeMap(null)).toEqual({})
  })

  it('records only the entity types the adapter declares', () => {
    const map = resolveDefaultBatchSizeMap(buildAdapter({
      defaultBatchSize: (entityType) => (entityType === 'orders.backfill' ? 500 : undefined),
    }))

    expect(map).toEqual({ 'orders.backfill': 500 })
  })

  it('clamps a declaration above the run API’s own ceiling', () => {
    const map = resolveDefaultBatchSizeMap(buildAdapter({
      supportedEntities: ['orders.backfill'],
      defaultBatchSize: () => 5000,
    }))

    expect(map).toEqual({ 'orders.backfill': 1000 })
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 250.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('ignores a %s declaration rather than treating it as a page size', (_label, declared) => {
    const map = resolveDefaultBatchSizeMap(buildAdapter({
      supportedEntities: ['orders.backfill'],
      defaultBatchSize: () => declared,
    }))

    expect(map).toEqual({})
  })

  it('ignores a declaration that is not a number at all', () => {
    const map = resolveDefaultBatchSizeMap(buildAdapter({
      supportedEntities: ['orders.backfill'],
      defaultBatchSize: (() => '500') as unknown as DataSyncAdapter['defaultBatchSize'],
    }))

    expect(map).toEqual({})
  })

  // One adapter's broken hook must not fail `api/data_sync/options`, which
  // evaluates every registered adapter in a single response.
  it('treats a throwing hook as "not declared"', () => {
    const map = resolveDefaultBatchSizeMap(buildAdapter({
      defaultBatchSize: () => {
        throw new Error('[internal] adapter hook blew up')
      },
    }))

    expect(map).toEqual({})
  })

  // On a plain object literal `map.__proto__ = value` sets the prototype rather
  // than creating an own property, so the declaration would serialize away and
  // reach the dashboard as "core's default".
  it('keeps a prototype-named entity type as a serializable own entry', () => {
    const map = resolveDefaultBatchSizeMap(buildAdapter({
      supportedEntities: ['__proto__'],
      defaultBatchSize: () => 500,
    }))

    expect(Object.keys(map)).toEqual(['__proto__'])

    const overWire = JSON.parse(JSON.stringify(map))
    expect(Object.keys(overWire)).toEqual(['__proto__'])
    expect(Object.getOwnPropertyDescriptor(overWire, '__proto__')?.value).toBe(500)
  })

  it('never asks about an entity type the adapter does not support', () => {
    const defaultBatchSize = jest.fn(() => 500)
    resolveDefaultBatchSizeMap(buildAdapter({ supportedEntities: ['orders.feed'], defaultBatchSize }))

    expect(defaultBatchSize.mock.calls.map((call) => (call as unknown[])[0])).toEqual(['orders.feed'])
  })
})

describe('defaultBatchSizeFor', () => {
  it('returns core’s default when the adapter declares nothing', () => {
    expect(defaultBatchSizeFor(buildAdapter(), 'orders.backfill')).toBe(DATA_SYNC_DEFAULT_BATCH_SIZE)
  })

  it('returns core’s default when no adapter resolved at all', () => {
    expect(defaultBatchSizeFor(null, 'orders.backfill')).toBe(DATA_SYNC_DEFAULT_BATCH_SIZE)
  })

  it('returns the declared page size for the entity type asked about', () => {
    const adapter = buildAdapter({
      defaultBatchSize: (entityType) => (entityType === 'orders.backfill' ? 500 : undefined),
    })

    expect(defaultBatchSizeFor(adapter, 'orders.backfill')).toBe(500)
    expect(defaultBatchSizeFor(adapter, 'orders.feed')).toBe(DATA_SYNC_DEFAULT_BATCH_SIZE)
  })

  // The start paths run this too, where a throw would refuse the run outright.
  it('falls back to core’s default when the hook throws', () => {
    const adapter = buildAdapter({
      defaultBatchSize: () => {
        throw new Error('[internal] adapter hook blew up')
      },
    })

    expect(defaultBatchSizeFor(adapter, 'orders.backfill')).toBe(DATA_SYNC_DEFAULT_BATCH_SIZE)
  })
})

describe('declaredDefaultBatchSize', () => {
  it('returns core’s default for an entity type the map does not declare', () => {
    expect(declaredDefaultBatchSize({ 'orders.backfill': 500 }, 'orders.feed'))
      .toBe(DATA_SYNC_DEFAULT_BATCH_SIZE)
  })

  it('returns core’s default when the integration shipped no map', () => {
    expect(declaredDefaultBatchSize(undefined, 'orders.feed')).toBe(DATA_SYNC_DEFAULT_BATCH_SIZE)
  })

  it('returns core’s default before an entity type is selected', () => {
    expect(declaredDefaultBatchSize({ 'orders.backfill': 500 }, '')).toBe(DATA_SYNC_DEFAULT_BATCH_SIZE)
  })

  it('reads the declaration for a declared entity type', () => {
    expect(declaredDefaultBatchSize({ 'orders.backfill': 500 }, 'orders.backfill')).toBe(500)
  })

  // The map arrives over the wire, so it is re-validated rather than trusted.
  it('falls back when the map carries a value outside the accepted range', () => {
    expect(declaredDefaultBatchSize({ 'orders.backfill': 0 }, 'orders.backfill'))
      .toBe(DATA_SYNC_DEFAULT_BATCH_SIZE)
    expect(declaredDefaultBatchSize({ 'orders.backfill': 5000 }, 'orders.backfill')).toBe(1000)
  })

  it('ignores inherited properties so a prototype-shaped entity type keeps core’s default', () => {
    expect(declaredDefaultBatchSize({}, 'constructor')).toBe(DATA_SYNC_DEFAULT_BATCH_SIZE)
    expect(declaredDefaultBatchSize({}, '__proto__')).toBe(DATA_SYNC_DEFAULT_BATCH_SIZE)
  })
})
