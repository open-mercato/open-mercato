import { loadDictionary, registerModules } from '../server'
import type { Module } from '../../../modules/registry'

describe('loadDictionary memoization', () => {
  it('returns a cached dictionary for repeated calls with the same locale', async () => {
    registerModules([
      { id: 'demo', translations: { en: { 'demo.hello': 'Hello' } } },
    ] satisfies Module[])

    const first = await loadDictionary('en')
    const second = await loadDictionary('en')

    expect(second).toBe(first)
    expect(first['demo.hello']).toBe('Hello')
  })

  it('busts the cache when the registered module set changes', async () => {
    registerModules([{ id: 'a', translations: { en: { 'a.k': 'A' } } }] satisfies Module[])
    const before = await loadDictionary('en')

    registerModules([
      { id: 'a', translations: { en: { 'a.k': 'A' } } },
      { id: 'b', translations: { en: { 'b.k': 'B' } } },
    ] satisfies Module[])
    const after = await loadDictionary('en')

    expect(after).not.toBe(before)
    expect(after['b.k']).toBe('B')
  })
})
