import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as directoryFeatures } from '../acl'

const directoryDescriptors: FeatureDescriptor[] = directoryFeatures

const directoryOwnIds = directoryDescriptors.map((feature) => feature.id)

describe('directory acl dependency declarations', () => {
  it('declares dependsOn only against features registered in the catalog', () => {
    const diagnostics = resolveAclDependencyDiagnostics(directoryOwnIds, directoryDescriptors)
    const ownUnknown = diagnostics.unknownReferences.filter((ref) =>
      ref.feature.startsWith('directory.'),
    )
    expect(ownUnknown).toEqual([])
  })

  it('resolves cleanly with no missing deps when every feature is granted', () => {
    const diagnostics = resolveAclDependencyDiagnostics(directoryOwnIds, directoryDescriptors)
    const ownMissing = diagnostics.missingDependencies.filter((dep) =>
      dep.feature.startsWith('directory.'),
    )
    expect(ownMissing).toEqual([])
  })

  it('flags the matching view feature as missing when only a manage feature is granted', () => {
    const diagnostics = resolveAclDependencyDiagnostics(
      ['directory.tenants.manage'],
      directoryDescriptors,
    )
    const tenantsManage = diagnostics.missingDependencies.find(
      (dep) => dep.feature === 'directory.tenants.manage',
    )
    expect(tenantsManage?.missing).toEqual(['directory.tenants.view'])
  })

  it('keeps every internal directory dependency target within the directory feature set', () => {
    const directoryIds = new Set(directoryOwnIds)
    const internalDeps = directoryDescriptors.flatMap((feature) =>
      (feature.dependsOn ?? []).filter((dep) => dep.startsWith('directory.')),
    )
    for (const dep of internalDeps) {
      expect(directoryIds.has(dep)).toBe(true)
    }
  })
})
