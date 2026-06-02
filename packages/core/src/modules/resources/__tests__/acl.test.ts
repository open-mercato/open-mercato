import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as resourcesFeatures } from '../acl'

const resourcesDescriptors: FeatureDescriptor[] = resourcesFeatures

const resourcesOwnIds = resourcesDescriptors.map((feature) => feature.id)

describe('resources acl dependency declarations', () => {
  it('declares dependsOn only against features registered in the catalog', () => {
    const granted = resourcesOwnIds
    const diagnostics = resolveAclDependencyDiagnostics(granted, resourcesDescriptors)
    const ownUnknown = diagnostics.unknownReferences.filter((ref) =>
      ref.feature.startsWith('resources.'),
    )
    expect(ownUnknown).toEqual([])
  })

  it('resolves cleanly with no missing deps when every feature and its deps are granted', () => {
    const granted = resourcesOwnIds
    const diagnostics = resolveAclDependencyDiagnostics(granted, resourcesDescriptors)
    const ownMissing = diagnostics.missingDependencies.filter((dep) =>
      dep.feature.startsWith('resources.'),
    )
    expect(ownMissing).toEqual([])
  })

  it('flags resources.view as a missing dep of manage_resources when only manage is granted', () => {
    const diagnostics = resolveAclDependencyDiagnostics(
      ['resources.manage_resources'],
      resourcesDescriptors,
    )
    expect(diagnostics.unknownReferences).toEqual([])
    const manage = diagnostics.missingDependencies.find(
      (dep) => dep.feature === 'resources.manage_resources',
    )
    expect(manage?.missing).toEqual(['resources.view'])
  })

  it('keeps every internal resources dependency target within the resources feature set', () => {
    const resourcesIds = new Set(resourcesOwnIds)
    const internalDeps = resourcesDescriptors.flatMap((feature) =>
      (feature.dependsOn ?? []).filter((dep) => dep.startsWith('resources.')),
    )
    for (const dep of internalDeps) {
      expect(resourcesIds.has(dep)).toBe(true)
    }
  })
})
