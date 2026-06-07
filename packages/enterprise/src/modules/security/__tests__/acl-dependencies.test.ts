/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import { hasFeature } from '@open-mercato/shared/security/features'
import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as securityFeatures } from '../acl'
import { setup } from '../setup'
import { features as authFeatures } from '@open-mercato/core/modules/auth/acl'

// The security dependency table (spec §6.33) references `auth.users.list` from
// the auth module, so the catalog the resolver checks against must include it.
const combinedCatalog: FeatureDescriptor[] = [
  ...(securityFeatures as FeatureDescriptor[]),
  ...(authFeatures as FeatureDescriptor[]),
]

describe('security ACL dependency declarations', () => {
  test('every security dependency resolves to a known feature (no unknown references)', () => {
    const diagnostics = resolveAclDependencyDiagnostics(
      combinedCatalog.map((feature) => feature.id),
      combinedCatalog,
    )
    const securityUnknown = diagnostics.unknownReferences.filter((entry) =>
      entry.feature.startsWith('security.'),
    )
    expect(securityUnknown).toEqual([])
  })

  test('granting security.admin.manage alone surfaces the missing read dependencies', () => {
    const diagnostics = resolveAclDependencyDiagnostics(['security.admin.manage'], combinedCatalog)
    const adminEntry = diagnostics.missingDependencies.find(
      (entry) => entry.feature === 'security.admin.manage',
    )
    expect(adminEntry).toBeDefined()
    expect([...(adminEntry?.missing ?? [])].sort()).toEqual(
      ['auth.users.list', 'security.profile.view'].sort(),
    )
  })

  test('profile and sudo manage features depend on their view feature', () => {
    const find = (id: string) =>
      (securityFeatures as FeatureDescriptor[]).find((feature) => feature.id === id)

    expect(find('security.profile.password')?.dependsOn).toContain('security.profile.view')
    expect(find('security.profile.manage')?.dependsOn).toContain('security.profile.view')
    expect(find('security.mfa.manage')?.dependsOn).toContain('security.profile.view')
    expect(find('security.sudo.manage')?.dependsOn).toContain('security.sudo.view')
  })

  test('view-grained features declare no dependencies', () => {
    const find = (id: string) =>
      (securityFeatures as FeatureDescriptor[]).find((feature) => feature.id === id)

    expect(find('security.profile.view')?.dependsOn).toBeUndefined()
    expect(find('security.sudo.view')?.dependsOn).toBeUndefined()
  })

  test('default role features cover the security view dependencies', () => {
    const adminFeatures = (setup.defaultRoleFeatures?.admin ?? []) as string[]
    const employeeFeatures = (setup.defaultRoleFeatures?.employee ?? []) as string[]

    // admin keeps the security.* wildcard, which already covers every view feature
    expect(hasFeature(adminFeatures, 'security.profile.view')).toBe(true)
    expect(hasFeature(adminFeatures, 'security.sudo.view')).toBe(true)

    // employee is an explicit allowlist; it grants profile.view so the
    // password/manage dependencies stay satisfied for the self-service page
    expect(hasFeature(employeeFeatures, 'security.profile.view')).toBe(true)
  })
})
