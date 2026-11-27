/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as authFeatures } from '../../auth/acl'
import { features as perspectivesFeatures } from '../acl'
import { setup } from '../setup'

const perspectivesCatalog: FeatureDescriptor[] = [...perspectivesFeatures] as FeatureDescriptor[]
const catalog: FeatureDescriptor[] = [...perspectivesCatalog, ...(authFeatures as FeatureDescriptor[])]
const perspectivesFeatureIds = perspectivesCatalog.map((feature) => feature.id)

function grantsFor(role: string): string[] {
  return (setup.defaultRoleFeatures?.[role] ?? []) as string[]
}

describe('perspectives ACL dependency declarations', () => {
  test('every dependency resolves to a known feature (no unknown references)', () => {
    const diagnostics = resolveAclDependencyDiagnostics(perspectivesFeatureIds, catalog)
    const ownUnknown = diagnostics.unknownReferences.filter((entry) =>
      entry.feature.startsWith('perspectives.'),
    )
    expect(ownUnknown).toEqual([])
  })

  test('declares the dependency table from spec §6.17', () => {
    const dependsOnById = new Map(
      perspectivesCatalog.map((feature) => [feature.id, [...(feature.dependsOn ?? [])].sort()]),
    )
    expect(dependsOnById.get('perspectives.use')).toEqual([])
    expect(dependsOnById.get('perspectives.role_defaults')).toEqual(['auth.roles.list', 'perspectives.use'])
  })

  test('granting role_defaults alone surfaces its prerequisites as missing', () => {
    const diagnostics = resolveAclDependencyDiagnostics(['perspectives.role_defaults'], catalog)
    expect(diagnostics.unknownReferences).toEqual([])
    const roleDefaults = diagnostics.missingDependencies.find(
      (entry) => entry.feature === 'perspectives.role_defaults',
    )
    expect([...(roleDefaults?.missing ?? [])].sort()).toEqual(['auth.roles.list', 'perspectives.use'])
  })

  test('employee default grants resolve without missing perspectives dependencies', () => {
    const diagnostics = resolveAclDependencyDiagnostics(grantsFor('employee'), catalog)
    const ownMissing = diagnostics.missingDependencies.filter((entry) =>
      entry.feature.startsWith('perspectives.'),
    )
    expect(ownMissing).toEqual([])
  })

  test('admin default grants resolve once the auth module grants are merged in', () => {
    const adminGrants = [...grantsFor('admin'), 'auth.roles.list']
    const diagnostics = resolveAclDependencyDiagnostics(adminGrants, catalog)
    const ownMissing = diagnostics.missingDependencies.filter((entry) =>
      entry.feature.startsWith('perspectives.'),
    )
    expect(ownMissing).toEqual([])
  })
})
