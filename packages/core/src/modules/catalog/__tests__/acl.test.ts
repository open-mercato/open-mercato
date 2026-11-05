import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as catalogFeatures } from '../acl'
import { features as currenciesFeatures } from '../../currencies/acl'
import { features as dictionariesFeatures } from '../../dictionaries/acl'

const catalogDescriptors: FeatureDescriptor[] = catalogFeatures

// The catalog dependency declarations reference cross-module view features
// (`currencies.view`, `dictionaries.view`). The resolved catalog must therefore
// include those modules' features so the references resolve to registered ids.
const resolvedCatalog: FeatureDescriptor[] = [
  ...catalogDescriptors,
  ...currenciesFeatures,
  ...dictionariesFeatures,
]

const catalogOwnIds = catalogDescriptors.map((feature) => feature.id)

describe('catalog acl dependency declarations', () => {
  it('declares dependsOn only against features registered in the resolved catalog', () => {
    const granted = resolvedCatalog.map((feature) => feature.id)
    const diagnostics = resolveAclDependencyDiagnostics(granted, resolvedCatalog)
    const ownUnknown = diagnostics.unknownReferences.filter((ref) =>
      ref.feature.startsWith('catalog.'),
    )
    expect(ownUnknown).toEqual([])
  })

  it('resolves cleanly with no missing deps when every feature and its deps are granted', () => {
    const granted = resolvedCatalog.map((feature) => feature.id)
    const diagnostics = resolveAclDependencyDiagnostics(granted, resolvedCatalog)
    const ownMissing = diagnostics.missingDependencies.filter((dep) =>
      dep.feature.startsWith('catalog.'),
    )
    expect(ownMissing).toEqual([])
  })

  it('flags cross-module deps as missing (not unknown) when only catalog features are granted', () => {
    const diagnostics = resolveAclDependencyDiagnostics(catalogOwnIds, resolvedCatalog)
    expect(diagnostics.unknownReferences).toEqual([])
    const productsView = diagnostics.missingDependencies.find(
      (dep) => dep.feature === 'catalog.products.view',
    )
    expect(productsView?.missing).toEqual(['currencies.view', 'dictionaries.view'])
  })

  it('keeps every internal catalog dependency target within the catalog feature set', () => {
    const catalogIds = new Set(catalogOwnIds)
    const internalDeps = catalogDescriptors.flatMap((feature) =>
      (feature.dependsOn ?? []).filter((dep) => dep.startsWith('catalog.')),
    )
    for (const dep of internalDeps) {
      expect(catalogIds.has(dep)).toBe(true)
    }
  })
})
