/** @jest-environment node */
import { authorizeProcessWorkflowGrant } from '../lib/processes/workflowGrant'

/**
 * A process's execution grant is a PRIVILEGE decision
 * (`.ai/specs/enterprise/agent-orchestrator/2026-09-06-business-process-workflow-unification.md` §2).
 *
 * `grantedFeatures` on a process definition becomes the bound workflow's, and
 * core mints a least-privilege principal from it. Core gates its own definitions
 * API on `workflows.definitions.grant_features` PLUS a subset check against the
 * saving user's own features. Routing a grant through this module without the
 * same gates would let anyone holding `processes.manage` mint a principal
 * carrying features they do not themselves have — which is why these tests exist
 * at all: the first cut of this route passed the grant straight through.
 */

function makeCtx(input: {
  userId?: string | null
  /** Features the saving user actually holds; every `userHasAllFeatures` ask is checked against it. */
  held?: string[]
  rbacAvailable?: boolean
}) {
  const held = new Set(input.held ?? [])
  return {
    auth: input.userId === null ? null : { sub: input.userId ?? 'user-1', tenantId: 'tenant-1', orgId: 'org-1' },
    selectedOrganizationId: 'org-1',
    container: {
      resolve: (token: string) => {
        if (token !== 'rbacService') throw new Error(`unexpected resolve(${token})`)
        if (input.rbacAvailable === false) throw new Error('[internal] rbacService not registered')
        return {
          userHasAllFeatures: async (_userId: string, features: string[]) =>
            features.every((feature) => held.has(feature)),
          getGrantedFeatures: async () => [...held],
        }
      },
    },
  } as never
}

const GRANT_FEATURE = 'workflows.definitions.grant_features'

describe('authorizeProcessWorkflowGrant', () => {
  it('refuses a grant from an author who lacks the grant feature itself', async () => {
    const failure = await authorizeProcessWorkflowGrant(
      makeCtx({ held: ['workflows.instances.view'] }),
      { requested: ['workflows.instances.view'], current: [] },
    )
    expect(failure).not.toBeNull()
    expect(failure?.status).toBe(403)
  })

  it('refuses a grant wider than what the author holds — no privilege escalation', async () => {
    const failure = await authorizeProcessWorkflowGrant(
      makeCtx({ held: [GRANT_FEATURE, 'workflows.instances.view'] }),
      { requested: ['workflows.instances.view', 'auth.users.manage'], current: [] },
    )
    expect(failure).not.toBeNull()
    expect(failure?.status).toBe(403)
  })

  it('allows a grant the author both may make and already holds', async () => {
    const failure = await authorizeProcessWorkflowGrant(
      makeCtx({ held: [GRANT_FEATURE, 'workflows.instances.view', 'workflows.instances.create'] }),
      { requested: ['workflows.instances.view', 'workflows.instances.create'], current: [] },
    )
    expect(failure).toBeNull()
  })

  it('treats a NO-OP change as no privilege change, so an ordinary save is never gated', async () => {
    // Otherwise every metadata edit of a granted definition would demand the
    // grant feature — including edits by someone who may not make grants.
    const failure = await authorizeProcessWorkflowGrant(
      makeCtx({ held: [] }),
      { requested: ['workflows.instances.view'], current: ['workflows.instances.view'] },
    )
    expect(failure).toBeNull()
  })

  it('ignores ordering and duplicates when deciding whether the grant changed', async () => {
    const failure = await authorizeProcessWorkflowGrant(
      makeCtx({ held: [] }),
      { requested: ['b', 'a', 'a'], current: ['a', 'b'] },
    )
    expect(failure).toBeNull()
  })

  it('refuses when there is no authenticated author to check', async () => {
    const failure = await authorizeProcessWorkflowGrant(
      makeCtx({ userId: null }),
      { requested: ['workflows.instances.view'], current: [] },
    )
    expect(failure?.status).toBe(403)
  })

  it('FAILS CLOSED when the check cannot run — an unrunnable check is not a passed one', async () => {
    const failure = await authorizeProcessWorkflowGrant(
      makeCtx({ rbacAvailable: false }),
      { requested: ['workflows.instances.view'], current: [] },
    )
    expect(failure?.status).toBe(503)
  })

  it('still lets a no-op through when the peer is unavailable — nothing new was asked for', async () => {
    const failure = await authorizeProcessWorkflowGrant(
      makeCtx({ rbacAvailable: false }),
      { requested: ['workflows.instances.view'], current: ['workflows.instances.view'] },
    )
    expect(failure).toBeNull()
  })
})
