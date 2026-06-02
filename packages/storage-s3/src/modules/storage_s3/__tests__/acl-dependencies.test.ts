import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as storageS3Features } from '../acl'

const catalog: FeatureDescriptor[] = storageS3Features
const ownIds = new Set(catalog.map((feature) => feature.id))

describe('storage_s3 acl dependency declarations', () => {
  it('declares dependsOn only against features registered in the catalog', () => {
    const granted = catalog.map((feature) => feature.id)
    const diagnostics = resolveAclDependencyDiagnostics(granted, catalog)
    const ownUnknown = diagnostics.unknownReferences.filter((ref) => ownIds.has(ref.feature))
    expect(ownUnknown).toEqual([])
  })

  it('resolves cleanly with no missing deps when every feature is granted', () => {
    const granted = catalog.map((feature) => feature.id)
    const diagnostics = resolveAclDependencyDiagnostics(granted, catalog)
    const ownMissing = diagnostics.missingDependencies.filter((dep) => ownIds.has(dep.feature))
    expect(ownMissing).toEqual([])
    expect(diagnostics.unknownReferences).toEqual([])
  })

  it('keeps every internal dependency target within the module feature set', () => {
    const internalDeps = catalog.flatMap((feature) =>
      (feature.dependsOn ?? []).filter((dep) => ownIds.has(dep) || dep.startsWith('storage_providers.')),
    )
    for (const dep of internalDeps) {
      expect(ownIds.has(dep)).toBe(true)
    }
  })
})
