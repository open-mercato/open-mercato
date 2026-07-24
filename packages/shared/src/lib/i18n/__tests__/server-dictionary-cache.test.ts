import { loadDictionary, registerModules } from '../server'

describe('loadDictionary memoization', () => {
  it('returns a cached dictionary for repeated calls with the same locale', async () => {
    registerModules([
      { id: 'demo', translations: { en: { 'demo.hello': 'Hello' } } } as any,
    ])

    const first = await loadDictionary('en')
    const second = await loadDictionary('en')

    expect(second).toBe(first) // same object reference => cache hit
    expect(first['demo.hello']).toBe('Hello')
  })

  it('busts the cache when the registered module set changes', async () => {
    registerModules([{ id: 'a', translations: { en: { 'a.k': 'A' } } } as any])
    const before = await loadDictionary('en')

    registerModules([
      { id: 'a', translations: { en: { 'a.k': 'A' } } } as any,
      { id: 'b', translations: { en: { 'b.k': 'B' } } } as any,
    ])
    const after = await loadDictionary('en')

    expect(after).not.toBe(before)
    expect(after['b.k']).toBe('B')
  })
})
