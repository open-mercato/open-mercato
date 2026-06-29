/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import { hasFeature } from '@open-mercato/shared/security/features'
import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as recordLocksFeatures } from '../acl'
import { setup } from '../setup'

// Every record_locks dependency references a feature inside the same module,
// so the catalog the resolver checks against is just this module's own list.
const catalog: FeatureDescriptor[] = recordLocksFeatures as FeatureDescriptor[]
const featureById = (id: string) => catalog.find((f) => f.id === id)

describe('record_locks ACL dependency declarations', () => {
  test('every record_locks dependency resolves to a known feature (no unknown references)', () => {
    const diagnostics = resolveAclDependencyDiagnostics(
      catalog.map((f) => f.id),
      catalog,
    )
    const recordLocksUnknown = diagnostics.unknownReferences.filter((entry) =>
      entry.feature.startsWith('record_locks.'),
    )
    expect(recordLocksUnknown).toEqual([])
  })

  test('manage / force_release / override_incoming depend on record_locks.view', () => {
    expect(featureById('record_locks.manage')?.dependsOn).toEqual(['record_locks.view'])
    expect(featureById('record_locks.force_release')?.dependsOn).toEqual(['record_locks.view'])
    expect(featureById('record_locks.override_incoming')?.dependsOn).toEqual(['record_locks.view'])
  })

  test('record_locks.view is a root feature with no dependencies', () => {
    expect(featureById('record_locks.view')?.dependsOn).toBeUndefined()
  })

  test('granting an action feature alone surfaces the missing view dependency', () => {
    const diagnostics = resolveAclDependencyDiagnostics(['record_locks.force_release'], catalog)
    const entry = diagnostics.missingDependencies.find(
      (item) => item.feature === 'record_locks.force_release',
    )
    expect(entry).toBeDefined()
    expect([...(entry?.missing ?? [])]).toEqual(['record_locks.view'])
  })

  test('default role features satisfy every declared dependency', () => {
    const adminFeatures = (setup.defaultRoleFeatures?.admin ?? []) as string[]
    const employeeFeatures = (setup.defaultRoleFeatures?.employee ?? []) as string[]

    // admin keeps the record_locks.* wildcard, which already covers view
    expect(hasFeature(adminFeatures, 'record_locks.view')).toBe(true)
    expect(hasFeature(adminFeatures, 'record_locks.manage')).toBe(true)

    // employee only holds record_locks.view, so it never trips a dependency warning
    const employeeDiagnostics = resolveAclDependencyDiagnostics(employeeFeatures, catalog)
    const employeeMissing = employeeDiagnostics.missingDependencies.filter((entry) =>
      entry.feature.startsWith('record_locks.'),
    )
    expect(employeeMissing).toEqual([])
  })
})
