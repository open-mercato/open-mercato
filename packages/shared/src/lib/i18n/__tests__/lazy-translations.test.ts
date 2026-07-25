import {
  loadDictionary,
  registerModules,
  registerAppDictionaryLoader,
  invalidateDictionaryCache,
} from '../server'
import type { Module } from '../../../modules/registry'
import { createLogger } from '../../logger'

jest.mock('../../logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})
const loggerWarn = createLogger('shared').warn as jest.Mock

describe('i18n lazy module translation loaders', () => {
  beforeEach(() => {
    registerModules([] as any)
    registerAppDictionaryLoader(async () => ({}))
    invalidateDictionaryCache()
  })

  it('resolves dictionaries from translationsLoaders for the requested locale only', async () => {
    const enLoader = jest.fn(async () => ({ module: { title: 'Module' } }) as any)
    const plLoader = jest.fn(async () => ({ module: { title: 'Moduł' } }) as any)
    registerModules([
      { id: 'demo', translationsLoaders: { en: enLoader, pl: plLoader } },
    ] as unknown as Module[])

    const dict = await loadDictionary('en')

    expect(dict).toEqual({ 'module.title': 'Module' })
    expect(enLoader).toHaveBeenCalledTimes(1)
    expect(plLoader).not.toHaveBeenCalled()
  })

  it('hydrates translations so repeat loads skip the loader', async () => {
    const enLoader = jest.fn(async () => ({ a: 'one' }) as any)
    const modules = [{ id: 'demo', translationsLoaders: { en: enLoader } }] as unknown as Module[]
    registerModules(modules)

    await loadDictionary('en')
    expect(modules[0].translations?.en).toEqual({ a: 'one' })

    invalidateDictionaryCache()
    const second = await loadDictionary('en')
    expect(second).toEqual({ a: 'one' })
    expect(enLoader).toHaveBeenCalledTimes(1)
  })

  it('prefers an eager translations entry over the loader', async () => {
    const enLoader = jest.fn(async () => ({ a: 'lazy' }) as any)
    registerModules([
      { id: 'demo', translations: { en: { a: 'eager' } }, translationsLoaders: { en: enLoader } },
    ] as unknown as Module[])

    const dict = await loadDictionary('en')

    expect(dict).toEqual({ a: 'eager' })
    expect(enLoader).not.toHaveBeenCalled()
  })

  it('degrades gracefully when a loader rejects', async () => {
    registerModules([
      { id: 'broken', translationsLoaders: { en: async () => { throw new Error('boom') } } },
      { id: 'ok', translations: { en: { b: 'two' } } },
    ] as unknown as Module[])

    const dict = await loadDictionary('en')

    expect(dict).toEqual({ b: 'two' })
    expect(loggerWarn).toHaveBeenCalled()
  })
})
