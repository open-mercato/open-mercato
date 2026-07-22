import {
  loadDictionary,
  registerModules,
  registerAppDictionaryLoader,
  invalidateDictionaryCache,
} from '../server'
import type { Locale } from '../config'

describe('i18n dictionary memoization', () => {
  beforeEach(() => {
    registerModules([] as any)
    registerAppDictionaryLoader(async () => ({}))
    invalidateDictionaryCache()
  })

  it('builds the flattened dictionary once per locale and reuses it', async () => {
    const loader = jest.fn(async (_locale: Locale) => ({ greeting: 'hello' }))
    registerAppDictionaryLoader(loader)
    registerModules([{ translations: { en: { module: { title: 'Module' } } } }] as any)

    const first = await loadDictionary('en')
    const second = await loadDictionary('en')

    expect(first).toBe(second)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(first).toEqual({ greeting: 'hello', 'module.title': 'Module' })
  })

  it('caches each locale independently', async () => {
    const loader = jest.fn(async (locale: Locale) => ({ greeting: locale }))
    registerAppDictionaryLoader(loader)
    registerModules([] as any)

    const en = await loadDictionary('en')
    const pl = await loadDictionary('pl')
    await loadDictionary('en')

    expect(en).not.toBe(pl)
    expect(en).toEqual({ greeting: 'en' })
    expect(pl).toEqual({ greeting: 'pl' })
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('rebuilds after modules are re-registered', async () => {
    registerAppDictionaryLoader(async () => ({}))
    registerModules([{ translations: { en: { a: 'one' } } }] as any)
    const before = await loadDictionary('en')
    expect(before).toEqual({ a: 'one' })

    registerModules([{ translations: { en: { b: 'two' } } }] as any)
    const after = await loadDictionary('en')

    expect(after).not.toBe(before)
    expect(after).toEqual({ b: 'two' })
  })

  it('rebuilds after the app dictionary loader is re-registered', async () => {
    registerModules([] as any)
    registerAppDictionaryLoader(async () => ({ greeting: 'old' }))
    const before = await loadDictionary('en')
    expect(before).toEqual({ greeting: 'old' })

    registerAppDictionaryLoader(async () => ({ greeting: 'new' }))
    const after = await loadDictionary('en')

    expect(after).not.toBe(before)
    expect(after).toEqual({ greeting: 'new' })
  })

  it('rebuilds after explicit cache invalidation', async () => {
    const loader = jest.fn(async () => ({ greeting: 'hello' }))
    registerAppDictionaryLoader(loader)
    registerModules([] as any)

    await loadDictionary('en')
    expect(loader).toHaveBeenCalledTimes(1)

    invalidateDictionaryCache()
    await loadDictionary('en')
    expect(loader).toHaveBeenCalledTimes(2)
  })
})
