import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as progressFeatures } from '../acl'

const progressDescriptors: FeatureDescriptor[] = progressFeatures

const progressOwnIds = progressDescriptors.map((feature) => feature.id)

describe('progress acl dependency declarations', () => {
  it('declares dependsOn only against features registered in the catalog', () => {
    const granted = progressDescriptors.map((feature) => feature.id)
    const diagnostics = resolveAclDependencyDiagnostics(granted, progressDescriptors)
    const ownUnknown = diagnostics.unknownReferences.filter((ref) =>
      ref.feature.startsWith('progress.'),
    )
    expect(ownUnknown).toEqual([])
  })

  it('resolves cleanly with no missing deps when every feature and its deps are granted', () => {
    const granted = progressDescriptors.map((feature) => feature.id)
    const diagnostics = resolveAclDependencyDiagnostics(granted, progressDescriptors)
    const ownMissing = diagnostics.missingDependencies.filter((dep) =>
      dep.feature.startsWith('progress.'),
    )
    expect(ownMissing).toEqual([])
  })

  it('flags the action features as missing progress.view when only they are granted', () => {
    const granted = ['progress.create', 'progress.update', 'progress.cancel', 'progress.manage']
    const diagnostics = resolveAclDependencyDiagnostics(granted, progressDescriptors)
    expect(diagnostics.unknownReferences).toEqual([])
    for (const id of granted) {
      const missing = diagnostics.missingDependencies.find((dep) => dep.feature === id)
      expect(missing?.missing).toEqual(['progress.view'])
    }
  })

  it('keeps every internal progress dependency target within the progress feature set', () => {
    const progressIds = new Set(progressOwnIds)
    const internalDeps = progressDescriptors.flatMap((feature) =>
      (feature.dependsOn ?? []).filter((dep) => dep.startsWith('progress.')),
    )
    for (const dep of internalDeps) {
      expect(progressIds.has(dep)).toBe(true)
    }
  })
})
