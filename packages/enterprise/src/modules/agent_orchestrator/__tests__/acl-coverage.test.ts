import { matchFeature } from '@open-mercato/shared/lib/auth/featureMatch'
import { features as aclFeatures } from '../acl'
import { setup } from '../setup'

// Every concrete feature declared in acl.ts MUST be granted to at least one role
// in setup.ts defaultRoleFeatures (wildcard-aware: `agent_orchestrator.*` and `*`
// satisfy matching concrete features). Guards against the "feature added to
// acl.ts but not defaultRoleFeatures → persona sees nothing" failure mode
// (mvp/05-seed-and-demo.md §Integration Coverage).
describe('agent_orchestrator defaultRoleFeatures ACL coverage', () => {
  const roleGrants = setup.defaultRoleFeatures ?? {}
  const allGranted = Object.values(roleGrants).flatMap((grants) => grants ?? [])

  const isCovered = (featureId: string): boolean =>
    allGranted.some((granted) => matchFeature(featureId, granted))

  it('grants every acl.ts feature to at least one role (wildcard-aware)', () => {
    const uncovered = aclFeatures
      .map((feature) => feature.id)
      .filter((id) => !isCovered(id))
    expect(uncovered).toEqual([])
  })

  it('keeps the wildcard contract for superadmin and admin', () => {
    expect(roleGrants.superadmin).toContain('agent_orchestrator.*')
    expect(roleGrants.admin).toContain('agent_orchestrator.*')
  })

  it('limits operator to the caseload persona (no playground run, no authoring)', () => {
    const operator = roleGrants.operator ?? []
    expect(operator).toContain('agent_orchestrator.proposals.dispose')
    expect(operator).not.toContain('agent_orchestrator.agents.run')
    expect(operator).not.toContain('agent_orchestrator.workflows.author')
  })

  it('limits engineer to playground + authoring (no dispose)', () => {
    const engineer = roleGrants.engineer ?? []
    expect(engineer).toContain('agent_orchestrator.agents.run')
    expect(engineer).toContain('agent_orchestrator.workflows.author')
    expect(engineer).not.toContain('agent_orchestrator.proposals.dispose')
  })
})
