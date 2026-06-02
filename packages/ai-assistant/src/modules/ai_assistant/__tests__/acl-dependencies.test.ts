/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as aiAssistantFeatures } from '../acl'
import { setup } from '../setup'

const descriptors: FeatureDescriptor[] = aiAssistantFeatures as FeatureDescriptor[]
const aiAssistantIds = descriptors.map((feature) => feature.id)

describe('ai_assistant ACL dependency declarations', () => {
  test('declares dependsOn only against features registered in the catalog (no unknown references)', () => {
    const diagnostics = resolveAclDependencyDiagnostics(aiAssistantIds, descriptors)
    const ownUnknown = diagnostics.unknownReferences.filter((ref) =>
      ref.feature.startsWith('ai_assistant.'),
    )
    expect(ownUnknown).toEqual([])
  })

  test('resolves cleanly with no missing deps when every feature is granted', () => {
    const diagnostics = resolveAclDependencyDiagnostics(aiAssistantIds, descriptors)
    const ownMissing = diagnostics.missingDependencies.filter((dep) =>
      dep.feature.startsWith('ai_assistant.'),
    )
    expect(ownMissing).toEqual([])
  })

  test('every internal dependency target stays within the ai_assistant feature set', () => {
    const knownIds = new Set(aiAssistantIds)
    const deps = descriptors.flatMap((feature) => feature.dependsOn ?? [])
    for (const dep of deps) {
      expect(knownIds.has(dep)).toBe(true)
    }
  })

  test('manage features depend on their view-grained counterpart', () => {
    const settingsManage = descriptors.find((f) => f.id === 'ai_assistant.settings.manage')
    const mcpServersManage = descriptors.find((f) => f.id === 'ai_assistant.mcp_servers.manage')
    expect(settingsManage?.dependsOn).toContain('ai_assistant.view')
    expect(mcpServersManage?.dependsOn).toContain('ai_assistant.mcp_servers.view')
  })

  test('conversations.share depends on ai_assistant.view, not conversations.manage', () => {
    // setup.ts grants employees `conversations.share` without `conversations.manage`,
    // so the share dependency must resolve against the view feature only — otherwise
    // the employee default would surface a missing-dependency warning at edit time.
    const share = descriptors.find((f) => f.id === 'ai_assistant.conversations.share')
    expect(share?.dependsOn).toEqual(['ai_assistant.view'])
  })

  test('default role grants resolve without missing dependencies', () => {
    const adminFeatures = (setup.defaultRoleFeatures?.admin ?? []) as string[]
    const employeeFeatures = (setup.defaultRoleFeatures?.employee ?? []) as string[]

    const adminDiagnostics = resolveAclDependencyDiagnostics(adminFeatures, descriptors)
    expect(adminDiagnostics.missingDependencies).toEqual([])

    const employeeDiagnostics = resolveAclDependencyDiagnostics(employeeFeatures, descriptors)
    expect(employeeDiagnostics.missingDependencies).toEqual([])
  })
})
