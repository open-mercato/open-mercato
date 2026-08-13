/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import { hasFeature } from '@open-mercato/shared/security/features'
import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as authFeatures } from '../acl'
import { setup } from '../setup'

// The auth dependency table (spec §6.4) is self-referencing: every declared
// dependency points at another auth feature, so the module's own catalog is
// sufficient to validate the declarations.
const catalog = authFeatures as FeatureDescriptor[]
const authFeatureIds = catalog.map((f) => f.id)

describe('auth ACL dependency declarations', () => {
  test('every auth dependency resolves to a known feature (no unknown references)', () => {
    const diagnostics = resolveAclDependencyDiagnostics(authFeatureIds, catalog)
    const authUnknown = diagnostics.unknownReferences.filter((entry) =>
      entry.feature.startsWith('auth.'),
    )
    expect(authUnknown).toEqual([])
  })

  test('granting the whole auth catalog produces no missing dependencies', () => {
    const diagnostics = resolveAclDependencyDiagnostics(authFeatureIds, catalog)
    expect(diagnostics.missingDependencies).toEqual([])
  })

  test('user write features depend on the users list feature', () => {
    for (const id of ['auth.users.create', 'auth.users.edit', 'auth.users.delete']) {
      expect(catalog.find((f) => f.id === id)?.dependsOn).toContain('auth.users.list')
    }
  })

  test('auth.roles.manage depends on the roles list feature', () => {
    expect(catalog.find((f) => f.id === 'auth.roles.manage')?.dependsOn).toContain('auth.roles.list')
  })

  test('auth.acl.manage depends on both list features it reads', () => {
    const aclManage = catalog.find((f) => f.id === 'auth.acl.manage')
    expect([...(aclManage?.dependsOn ?? [])].sort()).toEqual(['auth.roles.list', 'auth.users.list'])
  })

  test('list features and the self-contained sidebar feature declare no dependencies', () => {
    for (const id of ['auth.users.list', 'auth.roles.list', 'auth.sidebar.manage']) {
      expect(catalog.find((f) => f.id === id)?.dependsOn ?? []).toEqual([])
    }
  })

  test('granting auth.acl.manage alone surfaces both missing read dependencies', () => {
    const diagnostics = resolveAclDependencyDiagnostics(['auth.acl.manage'], catalog)
    const entry = diagnostics.missingDependencies.find((item) => item.feature === 'auth.acl.manage')
    expect(entry).toBeDefined()
    expect([...(entry?.missing ?? [])]).toEqual(['auth.roles.list', 'auth.users.list'])
  })

  test('deselecting auth.users.list reports the dependents left behind', () => {
    const granted = authFeatureIds.filter((id) => id !== 'auth.users.list')
    const diagnostics = resolveAclDependencyDiagnostics(granted, catalog)
    const orphaned = diagnostics.orphanedDependents.find(
      (entry) => entry.dependency === 'auth.users.list',
    )
    expect(orphaned).toBeDefined()
    expect([...(orphaned?.dependents ?? [])]).toEqual([
      'auth.acl.manage',
      'auth.users.create',
      'auth.users.delete',
      'auth.users.edit',
    ])
  })

  test('the admin wildcard grant satisfies every declared dependency', () => {
    const adminFeatures = (setup.defaultRoleFeatures?.admin ?? []) as string[]
    for (const id of authFeatureIds) {
      expect(hasFeature(adminFeatures, id)).toBe(true)
    }
    const diagnostics = resolveAclDependencyDiagnostics(adminFeatures, catalog)
    expect(diagnostics.missingDependencies).toEqual([])
  })
})
