import { invalidateDictionaryCache, loadDictionary, registerModules, resolveTranslations } from '../server'
import type { Module } from '../../../modules/registry'

const REGISTRY_GLOBAL_KEY = '__openMercatoModulesRegistry__'

describe('loadDictionary without a bootstrapped module registry', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>)[REGISTRY_GLOBAL_KEY]
    invalidateDictionaryCache()
  })

  it('resolves the app dictionary instead of throwing a bootstrap error', async () => {
    await expect(loadDictionary('en')).resolves.toEqual(expect.any(Object))
  })

  it('lets a route handler translate its response before bootstrap runs', async () => {
    const { translate } = await resolveTranslations()

    expect(translate('storage_s3.upload.errors.unsupported', 'Unsupported file type')).toBe('Unsupported file type')
  })

  it('picks up module translations once bootstrap registers them', async () => {
    await loadDictionary('en')

    registerModules([{ id: 'demo', translations: { en: { 'demo.hello': 'Hello' } } }] satisfies Module[])

    await expect(loadDictionary('en')).resolves.toMatchObject({ 'demo.hello': 'Hello' })
  })
})
