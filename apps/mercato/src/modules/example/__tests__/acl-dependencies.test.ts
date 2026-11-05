import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as exampleFeatures } from '../acl'
import { features as syncFeatures } from '../../example_customers_sync/acl'
import { features as customersFeatures } from '@open-mercato/core/modules/customers/acl'

const exampleDescriptors: FeatureDescriptor[] = exampleFeatures
const syncDescriptors: FeatureDescriptor[] = syncFeatures

// The example template modules exercise the dependency convention end-to-end so
// create-app templates ship with declared deps. `example_customers_sync` references
// the cross-module `customers.people.view`, so the resolved catalog must include the
// customers features for that reference to resolve to a registered id.
const resolvedCatalog: FeatureDescriptor[] = [
  ...exampleDescriptors,
  ...syncDescriptors,
  ...customersFeatures,
]

const exampleOwnIds = exampleDescriptors.map((feature) => feature.id)
const syncOwnIds = syncDescriptors.map((feature) => feature.id)

describe('example template acl dependency declarations', () => {
  it('declares dependsOn only against features registered in the resolved catalog', () => {
    const granted = resolvedCatalog.map((feature) => feature.id)
    const diagnostics = resolveAclDependencyDiagnostics(granted, resolvedCatalog)
    const ownUnknown = diagnostics.unknownReferences.filter(
      (ref) => ref.feature.startsWith('example.') || ref.feature.startsWith('example_customers_sync.'),
    )
    expect(ownUnknown).toEqual([])
  })

  it('resolves cleanly with no missing deps when every feature and its deps are granted', () => {
    const granted = resolvedCatalog.map((feature) => feature.id)
    const diagnostics = resolveAclDependencyDiagnostics(granted, resolvedCatalog)
    const ownMissing = diagnostics.missingDependencies.filter(
      (dep) => dep.feature.startsWith('example.') || dep.feature.startsWith('example_customers_sync.'),
    )
    expect(ownMissing).toEqual([])
  })

  it('flags missing example deps (not unknown) when a dependent is granted without its owner', () => {
    const diagnostics = resolveAclDependencyDiagnostics(['example.todos.manage'], resolvedCatalog)
    expect(diagnostics.unknownReferences).toEqual([])
    const manage = diagnostics.missingDependencies.find(
      (dep) => dep.feature === 'example.todos.manage',
    )
    expect(manage?.missing).toEqual(['example.todos.view'])
  })

  it('flags the cross-module sync dep as missing (not unknown) when only sync features are granted', () => {
    const diagnostics = resolveAclDependencyDiagnostics(syncOwnIds, resolvedCatalog)
    expect(diagnostics.unknownReferences).toEqual([])
    const view = diagnostics.missingDependencies.find(
      (dep) => dep.feature === 'example_customers_sync.view',
    )
    expect(view?.missing).toEqual(['customers.people.view'])
  })

  it('keeps every internal example dependency target within the example feature set', () => {
    const exampleIds = new Set(exampleOwnIds)
    const internalDeps = exampleDescriptors.flatMap((feature) =>
      (feature.dependsOn ?? []).filter((dep) => dep.startsWith('example.')),
    )
    for (const dep of internalDeps) {
      expect(exampleIds.has(dep)).toBe(true)
    }
  })
})
