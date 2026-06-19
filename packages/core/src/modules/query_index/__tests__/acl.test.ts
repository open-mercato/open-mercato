import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as queryIndexFeatures } from '../acl'

const queryIndexDescriptors: FeatureDescriptor[] = queryIndexFeatures
const queryIndexOwnIds = queryIndexDescriptors.map((feature) => feature.id)

describe('query_index acl dependency declarations', () => {
  it('declares dependsOn only against features registered in the catalog', () => {
    const granted = queryIndexDescriptors.map((feature) => feature.id)
    const diagnostics = resolveAclDependencyDiagnostics(granted, queryIndexDescriptors)
    const ownUnknown = diagnostics.unknownReferences.filter((ref) =>
      ref.feature.startsWith('query_index.'),
    )
    expect(ownUnknown).toEqual([])
  })

  it('resolves cleanly with no missing deps when every feature and its deps are granted', () => {
    const granted = queryIndexDescriptors.map((feature) => feature.id)
    const diagnostics = resolveAclDependencyDiagnostics(granted, queryIndexDescriptors)
    const ownMissing = diagnostics.missingDependencies.filter((dep) =>
      dep.feature.startsWith('query_index.'),
    )
    expect(ownMissing).toEqual([])
  })

  it('flags reindex and purge as missing their view dep when only those are granted', () => {
    const diagnostics = resolveAclDependencyDiagnostics(
      ['query_index.reindex', 'query_index.purge'],
      queryIndexDescriptors,
    )
    expect(diagnostics.unknownReferences).toEqual([])
    const reindex = diagnostics.missingDependencies.find(
      (dep) => dep.feature === 'query_index.reindex',
    )
    const purge = diagnostics.missingDependencies.find(
      (dep) => dep.feature === 'query_index.purge',
    )
    expect(reindex?.missing).toEqual(['query_index.status.view'])
    expect(purge?.missing).toEqual(['query_index.status.view'])
  })

  it('keeps every internal query_index dependency target within the feature set', () => {
    const ids = new Set(queryIndexOwnIds)
    const internalDeps = queryIndexDescriptors.flatMap((feature) =>
      (feature.dependsOn ?? []).filter((dep) => dep.startsWith('query_index.')),
    )
    for (const dep of internalDeps) {
      expect(ids.has(dep)).toBe(true)
    }
  })
})
