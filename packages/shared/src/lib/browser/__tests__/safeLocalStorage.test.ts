import {
  readJsonFromLocalStorage,
  writeJsonToLocalStorage,
  removeLocalStorageKey,
} from '../safeLocalStorage'

// Deliberately no `@jest-environment jsdom` override: this suite runs under the
// package's default `testEnvironment: 'node'` (jest.config.cjs), the same runtime
// shape as Next.js SSR. There is no `window` global here. If a guard regressed to
// touch `window.localStorage` unconditionally, every call below would throw
// `ReferenceError: window is not defined` instead of degrading gracefully — this
// is what let the Node ExperimentalWarning / SSR-safety report (#8408) go
// unverified by CI.
describe('safeLocalStorage (no window / SSR-like environment)', () => {
  it('has no window global in this environment', () => {
    expect(typeof window).toBe('undefined')
  })

  it('readJsonFromLocalStorage returns the fallback without throwing', () => {
    expect(readJsonFromLocalStorage('any-key', 'fallback')).toBe('fallback')
    const fallback = { foo: 'bar' }
    expect(readJsonFromLocalStorage('other-key', fallback)).toBe(fallback)
  })

  it('writeJsonToLocalStorage is a no-op without throwing', () => {
    expect(() => writeJsonToLocalStorage('any-key', { foo: 'bar' })).not.toThrow()
  })

  it('removeLocalStorageKey is a no-op without throwing', () => {
    expect(() => removeLocalStorageKey('any-key')).not.toThrow()
  })
})
