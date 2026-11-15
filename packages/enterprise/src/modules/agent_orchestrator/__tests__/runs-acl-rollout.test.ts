import { matchFeature } from '@open-mercato/shared/lib/auth/featureMatch'
import { setup } from '../setup'

// Rollout invariant for the tightened GET /api/agent_orchestrator/runs gate
// (PR #3532 moved it from agents.view → trace.view). Existing tenants only had
// agents.view, so they 403 on the run list until `yarn mercato auth sync-role-acls`
// re-applies defaultRoleFeatures. This test encodes the precondition that makes
// that sync deterministic: any role granted agents.view is ALSO granted
// trace.view (wildcard-aware), so the sync restores run-list access for every
// persona that previously had it.
describe('agent_orchestrator runs ACL rollout invariant', () => {
  const roleGrants = setup.defaultRoleFeatures ?? {}

  const agentsView = 'agent_orchestrator.agents.view'
  const traceView = 'agent_orchestrator.trace.view'

  const grantsFeature = (grants: readonly string[], featureId: string): boolean =>
    grants.some((granted) => matchFeature(featureId, granted))

  it('grants trace.view to every role that can see agents (sync-role-acls restores run-list access)', () => {
    const regressedRoles = Object.entries(roleGrants)
      .filter(([, grants]) => grantsFeature(grants ?? [], agentsView))
      .filter(([, grants]) => !grantsFeature(grants ?? [], traceView))
      .map(([role]) => role)
    expect(regressedRoles).toEqual([])
  })
})
