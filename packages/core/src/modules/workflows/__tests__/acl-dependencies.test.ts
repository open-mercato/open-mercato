/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as workflowsFeatures } from '../acl'

// All workflows dependencies are intra-module (spec §6.10), so the resolver
// catalog is just the module's own feature set.
const workflowsCatalog: FeatureDescriptor[] = workflowsFeatures as FeatureDescriptor[]
const workflowsFeatureIds = workflowsCatalog.map((feature) => feature.id)

describe('workflows ACL dependency declarations', () => {
  test('every dependency resolves to a workflows feature (no unknown references)', () => {
    const diagnostics = resolveAclDependencyDiagnostics(workflowsFeatureIds, workflowsCatalog)
    const ownUnknown = diagnostics.unknownReferences.filter((entry) =>
      entry.feature.startsWith('workflows.'),
    )
    expect(ownUnknown).toEqual([])
  })

  test('resolves cleanly with no missing deps when every feature is granted', () => {
    const diagnostics = resolveAclDependencyDiagnostics(workflowsFeatureIds, workflowsCatalog)
    const ownMissing = diagnostics.missingDependencies.filter((entry) =>
      entry.feature.startsWith('workflows.'),
    )
    expect(ownMissing).toEqual([])
  })

  test('declares the dependency table from spec §6.10', () => {
    const dependsOnById = new Map(
      workflowsCatalog.map((feature) => [feature.id, [...(feature.dependsOn ?? [])].sort()]),
    )
    expect(dependsOnById.get('workflows.view')).toEqual([])
    expect(dependsOnById.get('workflows.manage')).toEqual(['workflows.view'])
    expect(dependsOnById.get('workflows.view_logs')).toEqual(['workflows.view'])
    expect(dependsOnById.get('workflows.view_tasks')).toEqual(['workflows.view'])
    expect(dependsOnById.get('workflows.definitions.view')).toEqual(['workflows.view'])
    expect(dependsOnById.get('workflows.definitions.create')).toEqual(['workflows.definitions.view'])
    expect(dependsOnById.get('workflows.definitions.edit')).toEqual(['workflows.definitions.view'])
    expect(dependsOnById.get('workflows.definitions.delete')).toEqual(['workflows.definitions.view'])
    expect(dependsOnById.get('workflows.instances.view')).toEqual(['workflows.view'])
    expect(dependsOnById.get('workflows.instances.create')).toEqual([
      'workflows.definitions.view',
      'workflows.instances.view',
    ])
    expect(dependsOnById.get('workflows.instances.cancel')).toEqual(['workflows.instances.view'])
    expect(dependsOnById.get('workflows.instances.retry')).toEqual(['workflows.instances.view'])
    expect(dependsOnById.get('workflows.instances.signal')).toEqual(['workflows.instances.view'])
    expect(dependsOnById.get('workflows.tasks.view')).toEqual(['workflows.view'])
    expect(dependsOnById.get('workflows.tasks.claim')).toEqual(['workflows.tasks.view'])
    expect(dependsOnById.get('workflows.tasks.complete')).toEqual(['workflows.tasks.view'])
    expect(dependsOnById.get('workflows.signals.send')).toEqual(['workflows.view'])
    expect(dependsOnById.get('workflows.events.view')).toEqual(['workflows.view'])
  })

  test('granting only a write feature surfaces its read dependency as missing', () => {
    const diagnostics = resolveAclDependencyDiagnostics(
      ['workflows.definitions.edit'],
      workflowsCatalog,
    )
    expect(diagnostics.unknownReferences).toEqual([])
    const definitionsEdit = diagnostics.missingDependencies.find(
      (entry) => entry.feature === 'workflows.definitions.edit',
    )
    expect(definitionsEdit?.missing).toEqual(['workflows.definitions.view'])
  })

  test('keeps every dependency target within the workflows feature set', () => {
    const ids = new Set(workflowsFeatureIds)
    const deps = workflowsCatalog.flatMap((feature) => feature.dependsOn ?? [])
    for (const dep of deps) {
      expect(ids.has(dep)).toBe(true)
    }
  })
})
