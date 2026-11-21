import { createContainer } from 'awilix'
import { getProcessDiRegistrar, runProcessActivations } from '@open-mercato/shared/lib/di/process-registrar'
import { getDataSyncAdapter, registerDataSyncAdapter } from '../modules/data_sync/lib/adapter-registry'
import { getIndexDocEnrichers, registerIndexDocEnricher, validateIndexDocEnricher } from '../modules/query_index/lib/doc-enrichers'
import { getTranslatableFields } from '@open-mercato/shared/lib/localization/translatable-fields'
import { getTranslationOverlayPlugin } from '@open-mercato/shared/lib/localization/overlay-plugin'
import { register as registerExcel } from '../modules/sync_excel/di'
import { register as registerCatalog } from '../modules/catalog/di'
import { register as registerTranslations } from '../modules/translations/di'
import { syncExcelCustomersAdapter } from '../modules/sync_excel/lib/adapters/customers'
import { catalogProductScopeKeysEnricher } from '../modules/catalog/lib/productScopeKeys'
import { applyTranslationOverlays } from '../modules/translations/lib/apply'

jest.mock('../modules/sync_excel/lib/adapters/customers', () => ({ syncExcelCustomersAdapter: { providerKey: 'excel' } }))
jest.mock('../modules/catalog/services/catalogPricingService', () => ({}))
jest.mock('../modules/catalog/services/catalogOmnibusService', () => ({}))
jest.mock('../modules/catalog/services/catalogBuyerPricingService', () => ({}))
jest.mock('../modules/catalog/services/catalogScopedProductService', () => ({}))
jest.mock('../modules/catalog/data/entities', () => ({}))
jest.mock('../modules/translations/lib/apply', () => ({ applyTranslationOverlays: jest.fn() }))
jest.mock('../modules/translations/lib/supported-locales', () => ({ resolveTenantSupportedLocales: jest.fn() }))

const registryKeys: Array<string | symbol> = [
  Symbol.for('@open-mercato/data-sync/adapter-registry'),
  '__openMercatoQueryIndexDocEnrichers__',
  '__openMercatoTranslatableFields__',
  '__openMercatoTranslationOverlay__',
]
const registryHost = globalThis as unknown as Record<string | symbol, unknown>
let previousGlobals: unknown[]

beforeEach(() => {
  previousGlobals = registryKeys.map((key) => registryHost[key])
  for (const key of registryKeys) delete registryHost[key]
})
afterEach(() => {
  registryKeys.forEach((key, index) => {
    if (previousGlobals[index] === undefined) delete registryHost[key]
    else registryHost[key] = previousGlobals[index]
  })
})

describe('module global publication', () => {
  it('retains the live data-sync adapter until the replacement root activates', () => {
    const liveAdapter = { ...syncExcelCustomersAdapter }
    registerDataSyncAdapter(liveAdapter)
    const root = createContainer()
    getProcessDiRegistrar(registerExcel)!(root)
    expect(getDataSyncAdapter('excel')).toBe(liveAdapter)
    runProcessActivations(root)
    expect(getDataSyncAdapter('excel')).toBe(syncExcelCustomersAdapter)
  })

  it('preflights a catalog collision before publishing an earlier adapter activation', () => {
    const liveAdapter = { ...syncExcelCustomersAdapter }
    registerDataSyncAdapter(liveAdapter)
    registerIndexDocEnricher({ ...catalogProductScopeKeysEnricher, id: 'custom.scope_keys' })
    const root = createContainer()
    getProcessDiRegistrar(registerExcel)!(root)
    getProcessDiRegistrar(registerCatalog)!(root)
    expect(() => runProcessActivations(root)).toThrow('already contributed')
    expect(getDataSyncAdapter('excel')).toBe(liveAdapter)
    expect(getIndexDocEnrichers(catalogProductScopeKeysEnricher.entityType).map((entry) => entry.id))
      .toEqual(['custom.scope_keys'])
  })

  it('validates catalog definitions without creating or writing the global registry', () => {
    validateIndexDocEnricher(catalogProductScopeKeysEnricher)
    expect(registryHost.__openMercatoQueryIndexDocEnrichers__).toBeUndefined()
  })

  it('registers data-sync adapters immediately through the legacy entry point', () => {
    registerExcel(createContainer())
    expect(getDataSyncAdapter('excel')).toBe(syncExcelCustomersAdapter)
  })

  it('does not replace the active catalog index enricher when a root is discarded', async () => {
    const oldEnrich = jest.fn(async () => new Map())
    registerIndexDocEnricher({ ...catalogProductScopeKeysEnricher, enrich: oldEnrich })
    const discardedRoot = createContainer()
    getProcessDiRegistrar(registerCatalog)!(discardedRoot)
    await discardedRoot.dispose()
    expect(getIndexDocEnrichers(catalogProductScopeKeysEnricher.entityType)[0].enrich).toBe(oldEnrich)
    const readyRoot = createContainer()
    getProcessDiRegistrar(registerCatalog)!(readyRoot)
    expect(readyRoot.hasRegistration('catalogPricingService')).toBe(true)
    runProcessActivations(readyRoot)
    expect(getIndexDocEnrichers(catalogProductScopeKeysEnricher.entityType)[0].enrich).toBe(catalogProductScopeKeysEnricher.enrich)
  })

  it('registers the catalog index enricher immediately in legacy mode', () => {
    registerCatalog(createContainer())
    expect(getIndexDocEnrichers(catalogProductScopeKeysEnricher.entityType)[0].enrich).toBe(catalogProductScopeKeysEnricher.enrich)
  })

  it('publishes translation fields and overlay together only on activation', () => {
    const root = createContainer()
    getProcessDiRegistrar(registerTranslations)!(root)
    expect(getTranslatableFields('catalog:catalog_product')).toBeUndefined()
    expect(getTranslationOverlayPlugin().overlay).toBeNull()
    runProcessActivations(root)
    expect(getTranslatableFields('catalog:catalog_product')).toContain('title')
    expect(getTranslationOverlayPlugin().overlay).toBe(applyTranslationOverlays)
  })

  it('publishes translations immediately in legacy mode', () => {
    registerTranslations()
    expect(getTranslatableFields('catalog:catalog_product')).toContain('title')
    expect(getTranslationOverlayPlugin().overlay).toBe(applyTranslationOverlays)
  })
})
