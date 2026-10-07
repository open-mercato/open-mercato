/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { matchFeature } from '@open-mercato/shared/security/features'
import { features as workflowsFeatures } from '../acl'
import { setup as workflowsSetup } from '../setup'

/** Spec §6.4 administration — read others' work, move it, administer it. */
const TASK_ADMINISTRATION_FEATURES = [
  'workflows.tasks.view_all',
  'workflows.tasks.reassign',
  'workflows.tasks.manage',
] as const

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
    expect(dependsOnById.get('workflows.definitions.test_run')).toEqual(['workflows.definitions.edit'])
    expect(dependsOnById.get('workflows.definitions.publish')).toEqual(['workflows.definitions.edit'])
    expect(dependsOnById.get('workflows.instances.view')).toEqual(['workflows.view'])
    expect(dependsOnById.get('workflows.instances.create')).toEqual([
      'workflows.definitions.view',
      'workflows.instances.view',
    ])
    expect(dependsOnById.get('workflows.instances.cancel')).toEqual(['workflows.instances.view'])
    expect(dependsOnById.get('workflows.instances.retry')).toEqual(['workflows.instances.view'])
    expect(dependsOnById.get('workflows.instances.signal')).toEqual(['workflows.instances.view'])
    expect(dependsOnById.get('workflows.instances.update_context')).toEqual(['workflows.instances.view'])
    // Spec §8.4 recovery. Both are strictly broader than the single-instance
    // actions they build on, so neither is an implication of `retry`/`cancel`:
    // a rerun replays a step with possibly EDITED context, and a bulk op
    // applies an action to a whole page at once.
    expect(dependsOnById.get('workflows.instances.rerun_step')).toEqual([
      'workflows.instances.retry',
      'workflows.instances.update_context',
    ])
    expect(dependsOnById.get('workflows.instances.bulk_ops')).toEqual([
      'workflows.instances.cancel',
      'workflows.instances.retry',
    ])
    expect(dependsOnById.get('workflows.tasks.view')).toEqual(['workflows.view'])
    expect(dependsOnById.get('workflows.tasks.claim')).toEqual(['workflows.tasks.view'])
    expect(dependsOnById.get('workflows.tasks.complete')).toEqual(['workflows.tasks.view'])
    expect(dependsOnById.get('workflows.tasks.view_all')).toEqual(['workflows.tasks.view'])
    expect(dependsOnById.get('workflows.tasks.reassign')).toEqual(['workflows.tasks.view_all'])
    expect(dependsOnById.get('workflows.tasks.manage')).toEqual(['workflows.tasks.view_all'])
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

  test('defaultRoleFeatures grants are dependency-closed for every seeded role', () => {
    const roleGrants = workflowsSetup.defaultRoleFeatures ?? {}
    expect(Object.keys(roleGrants).length).toBeGreaterThan(0)
    for (const [roleName, granted] of Object.entries(roleGrants)) {
      const diagnostics = resolveAclDependencyDiagnostics(granted, workflowsCatalog)
      expect({ role: roleName, missing: diagnostics.missingDependencies }).toEqual({
        role: roleName,
        missing: [],
      })
    }
  })

  test('employee defaults grant the task-inbox surface (#4231)', () => {
    const employeeGrants = workflowsSetup.defaultRoleFeatures?.employee ?? []
    expect(employeeGrants).toEqual(
      expect.arrayContaining([
        'workflows.view',
        'workflows.view_tasks',
        'workflows.tasks.view',
        'workflows.tasks.claim',
        'workflows.tasks.complete',
        'workflows.instances.view',
      ]),
    )
  })

  test('admin defaults cover the context-write feature through the module wildcard', () => {
    const adminGrants = workflowsSetup.defaultRoleFeatures?.admin ?? []
    expect(adminGrants).toContain('workflows.*')
    expect(workflowsFeatureIds).toContain('workflows.instances.update_context')
  })

  test('employee defaults withhold the context-write feature', () => {
    const employeeGrants = workflowsSetup.defaultRoleFeatures?.employee ?? []
    expect(employeeGrants).not.toContain('workflows.instances.update_context')
    // Recovery is admin/dev territory (spec §8.4 ACL appendix); an employee
    // must never inherit it through the plain instance-view grant.
    expect(employeeGrants).not.toContain('workflows.instances.rerun_step')
    expect(employeeGrants).not.toContain('workflows.instances.bulk_ops')
    expect(employeeGrants).not.toContain('workflows.*')
  })

  test('every task administration feature is declared and roots at workflows.tasks.view', () => {
    const dependsOnById = new Map(
      workflowsCatalog.map((feature) => [feature.id, feature.dependsOn ?? []]),
    )
    const transitiveDependencies = (featureId: string): Set<string> => {
      const collected = new Set<string>()
      const pending = [...(dependsOnById.get(featureId) ?? [])]
      while (pending.length > 0) {
        const next = pending.pop() as string
        if (collected.has(next)) continue
        collected.add(next)
        pending.push(...(dependsOnById.get(next) ?? []))
      }
      return collected
    }
    for (const featureId of TASK_ADMINISTRATION_FEATURES) {
      expect(workflowsFeatureIds).toContain(featureId)
      const diagnostics = resolveAclDependencyDiagnostics([featureId], workflowsCatalog)
      expect(diagnostics.unknownReferences).toEqual([])
      // The closure pulls in the older read grant, which is what keeps
      // `workflows.tasks.view` load-bearing instead of a dead stored grant.
      expect([...transitiveDependencies(featureId)]).toEqual(
        expect.arrayContaining(['workflows.tasks.view', 'workflows.view']),
      )
    }
    expect(dependsOnById.get('workflows.tasks.view')).toEqual(['workflows.view'])
  })

  // Design §9 item 15: nobody loses access on upgrade. `admin: ['workflows.*']`
  // must match the new ids through the real matcher, not by inspection.
  test('the admin workflows wildcard matches every new administration feature', () => {
    const adminGrants = workflowsSetup.defaultRoleFeatures?.admin ?? []
    expect(adminGrants).toContain('workflows.*')
    for (const featureId of TASK_ADMINISTRATION_FEATURES) {
      expect(matchFeature(featureId, 'workflows.*')).toBe(true)
      expect(matchFeature(featureId, '*')).toBe(true)
    }
  })

  test('employee defaults withhold task administration', () => {
    const employeeGrants = workflowsSetup.defaultRoleFeatures?.employee ?? []
    for (const featureId of TASK_ADMINISTRATION_FEATURES) {
      expect(employeeGrants).not.toContain(featureId)
      expect(employeeGrants.some((grant) => matchFeature(featureId, grant))).toBe(false)
    }
  })

  test('keeps every dependency target within the workflows feature set', () => {
    const ids = new Set(workflowsFeatureIds)
    const deps = workflowsCatalog.flatMap((feature) => feature.dependsOn ?? [])
    for (const dep of deps) {
      expect(ids.has(dep)).toBe(true)
    }
  })
})
