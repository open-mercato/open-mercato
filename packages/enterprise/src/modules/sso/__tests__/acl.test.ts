/** @jest-environment node */

import { describe, it, expect } from '@jest/globals'
import { hasFeature } from '@open-mercato/shared/security/features'
import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as ssoFeatures } from '../acl'
import { setup } from '../setup'

// The sso dependency table (spec §6.35) only references sibling sso features,
// so the resolved catalog is the module's own feature set.
const ssoDescriptors: FeatureDescriptor[] = ssoFeatures
const ssoOwnIds = ssoDescriptors.map((feature) => feature.id)

describe('sso acl dependency declarations', () => {
  it('declares dependsOn only against features registered in the catalog', () => {
    const diagnostics = resolveAclDependencyDiagnostics(ssoOwnIds, ssoDescriptors)
    const ownUnknown = diagnostics.unknownReferences.filter((ref) =>
      ref.feature.startsWith('sso.'),
    )
    expect(ownUnknown).toEqual([])
  })

  it('resolves cleanly with no missing deps when every feature is granted', () => {
    const diagnostics = resolveAclDependencyDiagnostics(ssoOwnIds, ssoDescriptors)
    const ownMissing = diagnostics.missingDependencies.filter((dep) =>
      dep.feature.startsWith('sso.'),
    )
    expect(ownMissing).toEqual([])
  })

  it('surfaces the missing read dependency when only sso.config.manage is granted', () => {
    const diagnostics = resolveAclDependencyDiagnostics(['sso.config.manage'], ssoDescriptors)
    const manageEntry = diagnostics.missingDependencies.find(
      (dep) => dep.feature === 'sso.config.manage',
    )
    expect(manageEntry?.missing).toEqual(['sso.config.view'])
  })

  it('surfaces the management dependency when only sso.scim.manage is granted', () => {
    const diagnostics = resolveAclDependencyDiagnostics(['sso.scim.manage'], ssoDescriptors)
    const scimEntry = diagnostics.missingDependencies.find(
      (dep) => dep.feature === 'sso.scim.manage',
    )
    expect(scimEntry?.missing).toEqual(['sso.config.manage'])
  })

  it('keeps every dependency target within the sso feature set', () => {
    const ssoIds = new Set(ssoOwnIds)
    const deps = ssoDescriptors.flatMap((feature) => feature.dependsOn ?? [])
    for (const dep of deps) {
      expect(ssoIds.has(dep)).toBe(true)
    }
  })

  it('default role grants cover every declared sso feature', () => {
    const superadminFeatures = (setup.defaultRoleFeatures?.superadmin ?? []) as string[]
    const adminFeatures = (setup.defaultRoleFeatures?.admin ?? []) as string[]

    for (const id of ssoOwnIds) {
      expect(hasFeature(superadminFeatures, id)).toBe(true)
      expect(hasFeature(adminFeatures, id)).toBe(true)
    }
  })
})
