/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as authFeatures } from '../../auth/acl'
import { features as deviceFeatures } from '../acl'
import { setup } from '../setup'

// `devices.admin` depends on a feature another module owns, so the catalog has to carry both —
// resolveAclDependencyDiagnostics reports an unregistered target as an unknown reference.
const descriptors: FeatureDescriptor[] = [...deviceFeatures, ...authFeatures] as FeatureDescriptor[]

function grantsFor(role: string): string[] {
  return (setup.defaultRoleFeatures?.[role] ?? []) as string[]
}

describe('devices ACL dependency declarations', () => {
  test('devices.admin depends on auth.users.list, because the admin screens name owners by person', () => {
    const admin = deviceFeatures.find((feature) => feature.id === 'devices.admin')
    expect(admin?.dependsOn).toEqual(['auth.users.list'])
  })

  test('the dependency target is a registered feature, not a typo', () => {
    const diagnostics = resolveAclDependencyDiagnostics(
      descriptors.map((feature) => feature.id),
      descriptors,
    )
    // auth declares its own cross-module targets (directory.*) that this catalog does not carry,
    // so only the devices-owned rows are this module's to answer for.
    const ownUnknown = diagnostics.unknownReferences.filter((ref) => ref.feature.startsWith('devices.'))
    expect(ownUnknown).toEqual([])
  })

  test('the own-device features carry no dependency — they never resolve another user', () => {
    for (const id of ['devices.view', 'devices.manage']) {
      expect(deviceFeatures.find((feature) => feature.id === id)?.dependsOn).toBeUndefined()
    }
  })

  test('every default role that gets devices.admin also gets its dependency', () => {
    // The owner picker rejects free-typed values, so a role granted devices.admin without
    // auth.users.list could not complete the register form at all.
    for (const role of ['superadmin', 'admin']) {
      const diagnostics = resolveAclDependencyDiagnostics(grantsFor(role), descriptors)
      expect(diagnostics.missingDependencies).toEqual([])
    }
  })

  test('the employee default stays clear of the dependency', () => {
    const employee = grantsFor('employee')
    expect(employee).not.toContain('auth.users.list')
    expect(resolveAclDependencyDiagnostics(employee, descriptors).missingDependencies).toEqual([])
  })
})
