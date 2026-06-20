/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as entitiesFeatures } from '../acl'

// The entities dependency table (spec §6.39) is self-contained: every declared
// dependency points at another entities feature, so the module's own catalog is
// sufficient to validate the declarations.
const catalog = entitiesFeatures as FeatureDescriptor[]
const entitiesFeatureIds = catalog.map((f) => f.id)

describe('entities ACL dependency declarations', () => {
  test('every entities dependency resolves to a known feature (no unknown references)', () => {
    const diagnostics = resolveAclDependencyDiagnostics(entitiesFeatureIds, catalog)
    const entitiesUnknown = diagnostics.unknownReferences.filter((entry) =>
      entry.feature.startsWith('entities.'),
    )
    expect(entitiesUnknown).toEqual([])
  })

  test('manage features depend on their matching view feature', () => {
    const definitionsManage = catalog.find((f) => f.id === 'entities.definitions.manage')
    const recordsManage = catalog.find((f) => f.id === 'entities.records.manage')
    expect(definitionsManage?.dependsOn).toContain('entities.definitions.view')
    expect(recordsManage?.dependsOn).toContain('entities.records.view')
  })

  test('view features declare no dependencies', () => {
    const definitionsView = catalog.find((f) => f.id === 'entities.definitions.view')
    const recordsView = catalog.find((f) => f.id === 'entities.records.view')
    expect(definitionsView?.dependsOn ?? []).toEqual([])
    expect(recordsView?.dependsOn ?? []).toEqual([])
  })

  test('granting a manage feature alone surfaces its missing read dependency', () => {
    const diagnostics = resolveAclDependencyDiagnostics(['entities.definitions.manage'], catalog)
    const entry = diagnostics.missingDependencies.find(
      (item) => item.feature === 'entities.definitions.manage',
    )
    expect(entry).toBeDefined()
    expect([...(entry?.missing ?? [])]).toEqual(['entities.definitions.view'])
  })
})
