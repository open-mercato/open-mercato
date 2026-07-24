import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import type { Module } from '@open-mercato/shared/modules/registry'

const loadI18nModulesMock = jest.fn<Promise<Module[]>, [string]>()
const registerModulesMock = jest.fn()
const loadBaseDictionaryMock = jest.fn<Promise<Record<string, unknown>>, [Locale]>()
let createAppDictionaryLoader: typeof import('../register-dictionary-loader').createAppDictionaryLoader

describe('register-dictionary-loader', () => {
  beforeEach(async () => {
    jest.resetModules()
    registerModulesMock.mockReset()
    loadI18nModulesMock.mockReset()
    loadBaseDictionaryMock.mockReset()
    loadBaseDictionaryMock.mockImplementation(async (locale) => ({ locale }))
    delete (globalThis as Record<string, unknown>).__openMercatoLoadedI18nModules__

    jest.doMock('@open-mercato/shared/lib/i18n/server', () => ({
      registerAppDictionaryLoader: jest.fn(),
    }))

    ;({ createAppDictionaryLoader } = await import('../register-dictionary-loader'))
  })

  function testLoader() {
    return createAppDictionaryLoader({
      loadLocaleModules: loadI18nModulesMock,
      loadBaseDictionary: loadBaseDictionaryMock,
      registerLocaleModules: registerModulesMock,
    })
  }

  it('loads only the requested locale shard and registers its module translations', async () => {
    loadI18nModulesMock.mockResolvedValueOnce([
      { id: 'first', translations: { pl: { addTitle: 'Pierwszy', nested: { first: 'jeden' } } } },
      { id: 'second', translations: { pl: { addTitle: 'Drugi', nested: { second: 'dwa' } } } },
    ] as Module[])

    loadBaseDictionaryMock.mockResolvedValueOnce({ addTitle: 'Add', 'api.errors.notFound': 'Nie znaleziono' })
    const dictionary = await testLoader()('pl')

    expect(loadI18nModulesMock).toHaveBeenCalledWith('pl')
    expect(loadI18nModulesMock).toHaveBeenCalledTimes(1)
    expect(dictionary.addTitle).toBe('Add')
    expect(dictionary['api.errors.notFound']).toBe('Nie znaleziono')
    expect(registerModulesMock).toHaveBeenCalledWith([
      { id: 'first', translations: { pl: { addTitle: 'Pierwszy', nested: { first: 'jeden' } } } },
      { id: 'second', translations: { pl: { addTitle: 'Drugi', nested: { second: 'dwa' } } } },
    ])
  })

  it('keeps previously loaded locales registered when another locale is requested', async () => {
    loadI18nModulesMock
      .mockResolvedValueOnce([
        { id: 'customers', translations: { pl: { customers: { title: 'Klienci' } } } },
      ] as Module[])
      .mockResolvedValueOnce([
        { id: 'customers', translations: { en: { customers: { title: 'Customers' } } } },
      ] as Module[])

    const loader = testLoader()
    await loader('pl')
    await loader('en')

    expect(registerModulesMock).toHaveBeenLastCalledWith([
      {
        id: 'customers',
        translations: {
          pl: { customers: { title: 'Klienci' } },
          en: { customers: { title: 'Customers' } },
        },
      },
    ])
  })

  it('does not replace the runtime module registry when a locale has no module translations', async () => {
    loadI18nModulesMock.mockResolvedValueOnce([])

    loadBaseDictionaryMock.mockResolvedValueOnce({ 'api.errors.notFound': 'Nicht gefunden' })
    const dictionary = await testLoader()('de')

    expect(dictionary['api.errors.notFound']).toBe('Nicht gefunden')
    expect(registerModulesMock).not.toHaveBeenCalled()
  })
})
