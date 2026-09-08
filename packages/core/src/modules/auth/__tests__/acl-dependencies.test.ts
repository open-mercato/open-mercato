/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import { hasFeature } from '@open-mercato/shared/security/features'
import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as authFeatures } from '../acl'
import { setup } from '../setup'
import { features as directoryFeatures } from '@open-mercato/core/modules/directory/acl'
import { setup as directorySetup } from '@open-mercato/core/modules/directory/setup'

// The auth dependency table (spec §6.4) is self-referencing except for the one
// cross-module edge `auth.users.create → directory.organizations.view`, so the
// catalog under test is auth plus directory. The runtime catalog behind the ACL
// editor is the full cross-module feature list served by /api/auth/features.
const catalog = [...authFeatures, ...directoryFeatures] as FeatureDescriptor[]
const authFeatureIds = (authFeatures as FeatureDescriptor[]).map((f) => f.id)
const catalogFeatureIds = catalog.map((f) => f.id)

describe('auth ACL dependency declarations', () => {
  test('every auth dependency resolves to a known feature (no unknown references)', () => {
    const diagnostics = resolveAclDependencyDiagnostics(catalogFeatureIds, catalog)
    const authUnknown = diagnostics.unknownReferences.filter((entry) =>
      entry.feature.startsWith('auth.'),
    )
    expect(authUnknown).toEqual([])
  })

  test('the auth catalog alone leaves exactly the cross-module directory read missing', () => {
    const diagnostics = resolveAclDependencyDiagnostics(authFeatureIds, catalog)
    expect(diagnostics.missingDependencies).toEqual([
      { feature: 'auth.users.create', missing: ['directory.organizations.view'] },
    ])
  })

  test('granting the auth catalog plus the directory read produces no missing dependencies', () => {
    const diagnostics = resolveAclDependencyDiagnostics(
      [...authFeatureIds, 'directory.organizations.view'],
      catalog,
    )
    expect(diagnostics.missingDependencies).toEqual([])
  })

  test('user write features depend on the users list feature', () => {
    for (const id of ['auth.users.create', 'auth.users.edit', 'auth.users.delete']) {
      expect(catalog.find((f) => f.id === id)?.dependsOn).toContain('auth.users.list')
    }
  })

  test('user create and edit also depend on the roles list feeding their Roles field', () => {
    for (const id of ['auth.users.create', 'auth.users.edit']) {
      expect(catalog.find((f) => f.id === id)?.dependsOn).toContain('auth.roles.list')
    }
    expect([...(catalog.find((f) => f.id === 'auth.users.edit')?.dependsOn ?? [])].sort()).toEqual([
      'auth.roles.list',
      'auth.users.list',
    ])
    expect(catalog.find((f) => f.id === 'auth.users.delete')?.dependsOn).toEqual(['auth.users.list'])
  })

  test('user create additionally depends on the directory read feeding its required Organization field', () => {
    expect([...(catalog.find((f) => f.id === 'auth.users.create')?.dependsOn ?? [])].sort()).toEqual(
      ['auth.roles.list', 'auth.users.list', 'directory.organizations.view'],
    )
    expect(catalog.find((f) => f.id === 'auth.users.edit')?.dependsOn).not.toContain(
      'directory.organizations.view',
    )
    expect(catalog.find((f) => f.id === 'auth.users.list')?.dependsOn ?? []).toEqual([])
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

  test('granting auth.users.create alone surfaces all three missing read dependencies', () => {
    const diagnostics = resolveAclDependencyDiagnostics(['auth.users.create'], catalog)
    const entry = diagnostics.missingDependencies.find((item) => item.feature === 'auth.users.create')
    expect(entry).toBeDefined()
    expect([...(entry?.missing ?? [])]).toEqual([
      'auth.roles.list',
      'auth.users.list',
      'directory.organizations.view',
    ])
  })

  test('deselecting auth.roles.list reports the dependents left behind', () => {
    const granted = authFeatureIds.filter((id) => id !== 'auth.roles.list')
    const diagnostics = resolveAclDependencyDiagnostics(granted, catalog)
    const orphaned = diagnostics.orphanedDependents.find(
      (entry) => entry.dependency === 'auth.roles.list',
    )
    expect(orphaned).toBeDefined()
    expect([...(orphaned?.dependents ?? [])]).toEqual([
      'auth.acl.manage',
      'auth.roles.manage',
      'auth.users.create',
      'auth.users.edit',
    ])
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

  test('deselecting directory.organizations.view reports auth.users.create as orphaned', () => {
    const granted = catalogFeatureIds.filter((id) => id !== 'directory.organizations.view')
    const diagnostics = resolveAclDependencyDiagnostics(granted, catalog)
    const orphaned = diagnostics.orphanedDependents.find(
      (entry) => entry.dependency === 'directory.organizations.view',
    )
    expect(orphaned).toBeDefined()
    expect([...(orphaned?.dependents ?? [])]).toEqual([
      'auth.users.create',
      'directory.organizations.manage',
    ])
  })

  test('the default admin role grants satisfy every declared dependency', () => {
    const adminFeatures = [
      ...((setup.defaultRoleFeatures?.admin ?? []) as string[]),
      ...((directorySetup.defaultRoleFeatures?.admin ?? []) as string[]),
    ]
    for (const id of authFeatureIds) {
      expect(hasFeature(adminFeatures, id)).toBe(true)
    }
    const diagnostics = resolveAclDependencyDiagnostics(adminFeatures, catalog)
    expect(diagnostics.missingDependencies).toEqual([])
  })

  test('the auth wildcard grant alone does not satisfy the cross-module directory read', () => {
    const authOnlyAdmin = (setup.defaultRoleFeatures?.admin ?? []) as string[]
    const diagnostics = resolveAclDependencyDiagnostics(authOnlyAdmin, catalog)
    expect(diagnostics.missingDependencies).toEqual([
      { feature: 'auth.users.create', missing: ['directory.organizations.view'] },
    ])
  })
})
