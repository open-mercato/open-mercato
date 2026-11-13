/** @jest-environment jsdom */
import {
  readJsonFromLocalStorage,
  writeJsonToLocalStorage,
  removeLocalStorageKey,
} from '../safeLocalStorage'

describe('safeLocalStorage (browser environment)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('round-trips a value through write then read', () => {
    writeJsonToLocalStorage('test:a', { foo: 'bar' })
    expect(readJsonFromLocalStorage('test:a', null)).toEqual({ foo: 'bar' })
  })

  it('returns the fallback when the key is missing', () => {
    expect(readJsonFromLocalStorage('test:missing', 'fallback')).toBe('fallback')
  })

  it('returns the fallback on malformed JSON instead of throwing', () => {
    window.localStorage.setItem('test:bad', '{not json')
    expect(readJsonFromLocalStorage('test:bad', 'fallback')).toBe('fallback')
  })

  it('removes a stored key', () => {
    writeJsonToLocalStorage('test:b', { foo: 'bar' })
    removeLocalStorageKey('test:b')
    expect(window.localStorage.getItem('test:b')).toBeNull()
  })
})
