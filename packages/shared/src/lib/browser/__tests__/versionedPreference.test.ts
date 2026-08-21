/** @jest-environment jsdom */
import {
  readVersionedPreference,
  writeVersionedPreference,
  clearVersionedPreference,
  readVersionedIdSet,
  writeVersionedIdSet,
} from '../versionedPreference'

function isStringRecord(value: unknown): value is Record<string, string> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((v) => typeof v === 'string')
}

describe('versionedPreference', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips a value through write then read', () => {
    writeVersionedPreference('test:a', 1, { foo: 'bar' })
    expect(readVersionedPreference('test:a', 1, isStringRecord, {})).toEqual({ foo: 'bar' })
  })

  it('discards data on version mismatch', () => {
    writeVersionedPreference('test:b', 1, { foo: 'bar' })
    expect(readVersionedPreference('test:b', 2, isStringRecord, {})).toEqual({})
  })

  it('discards malformed/invalid envelope data', () => {
    localStorage.setItem('test:c', JSON.stringify({ v: 1, data: { foo: 42 } }))
    expect(readVersionedPreference('test:c', 1, isStringRecord, {})).toEqual({})
  })

  it('migrates a legacy bare (unversioned) value and upgrades it on next write', () => {
    localStorage.setItem('test:d', JSON.stringify({ foo: 'legacy' }))
    const value = readVersionedPreference('test:d', 1, isStringRecord, {}, { legacyIsValid: isStringRecord })
    expect(value).toEqual({ foo: 'legacy' })

    writeVersionedPreference('test:d', 1, value)
    expect(JSON.parse(localStorage.getItem('test:d')!)).toEqual({ v: 1, data: { foo: 'legacy' } })
  })

  it('treats a legacy record with a literal "v" key as legacy data, not a malformed envelope', () => {
    localStorage.setItem('test:legacy-v-key', JSON.stringify({ v: 250, other: 300 }))
    function isNumberRecord(value: unknown): value is Record<string, number> {
      return !!value && typeof value === 'object' && !Array.isArray(value)
        && Object.values(value as Record<string, unknown>).every((v) => typeof v === 'number')
    }
    expect(readVersionedPreference('test:legacy-v-key', 1, isNumberRecord, {}, { legacyIsValid: isNumberRecord }))
      .toEqual({ v: 250, other: 300 })
  })

  it('does not migrate a legacy value when legacyIsValid is not provided', () => {
    localStorage.setItem('test:e', JSON.stringify({ foo: 'legacy' }))
    expect(readVersionedPreference('test:e', 1, isStringRecord, {})).toEqual({})
  })

  it('clearVersionedPreference removes the key', () => {
    writeVersionedPreference('test:f', 1, { foo: 'bar' })
    clearVersionedPreference('test:f')
    expect(localStorage.getItem('test:f')).toBeNull()
  })

  describe('readVersionedIdSet / writeVersionedIdSet', () => {
    it('round-trips a set of ids', () => {
      writeVersionedIdSet('test:ids', 1, new Set(['a', 'b']))
      expect(readVersionedIdSet('test:ids', 1)).toEqual(new Set(['a', 'b']))
    })

    it('migrates a legacy bare string[] array', () => {
      localStorage.setItem('test:ids-legacy', JSON.stringify(['x', 'y']))
      expect(readVersionedIdSet('test:ids-legacy', 1)).toEqual(new Set(['x', 'y']))
    })

    it('falls back to an empty set for malformed entries', () => {
      localStorage.setItem('test:ids-bad', JSON.stringify({ v: 1, data: [1, 2, 3] }))
      expect(readVersionedIdSet('test:ids-bad', 1)).toEqual(new Set())
    })
  })
})
