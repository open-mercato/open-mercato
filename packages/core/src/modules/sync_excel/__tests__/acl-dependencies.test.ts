/** @jest-environment node */

import { describe, it, expect } from '@jest/globals'
import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as syncExcelFeatures } from '../acl'

const descriptors: FeatureDescriptor[] = syncExcelFeatures as FeatureDescriptor[]
const ownIds = descriptors.map((feature) => feature.id)

describe('sync_excel acl dependency declarations', () => {
  it('declares dependsOn only against features registered in the module catalog', () => {
    const diagnostics = resolveAclDependencyDiagnostics(ownIds, descriptors)
    const ownUnknown = diagnostics.unknownReferences.filter((ref) =>
      ref.feature.startsWith('sync_excel.'),
    )
    expect(ownUnknown).toEqual([])
  })

  it('resolves cleanly with no missing deps when every feature is granted', () => {
    const diagnostics = resolveAclDependencyDiagnostics(ownIds, descriptors)
    const ownMissing = diagnostics.missingDependencies.filter((dep) =>
      dep.feature.startsWith('sync_excel.'),
    )
    expect(ownMissing).toEqual([])
  })

  it('flags sync_excel.view as missing when only sync_excel.run is granted', () => {
    const diagnostics = resolveAclDependencyDiagnostics(['sync_excel.run'], descriptors)
    const runEntry = diagnostics.missingDependencies.find(
      (dep) => dep.feature === 'sync_excel.run',
    )
    expect(runEntry?.missing).toEqual(['sync_excel.view'])
  })

  it('keeps every internal dependency target within the sync_excel feature set', () => {
    const ids = new Set(ownIds)
    const internalDeps = descriptors.flatMap((feature) =>
      (feature.dependsOn ?? []).filter((dep) => dep.startsWith('sync_excel.')),
    )
    for (const dep of internalDeps) {
      expect(ids.has(dep)).toBe(true)
    }
    expect(internalDeps).toContain('sync_excel.view')
  })
})
