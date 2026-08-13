import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  PROBE_AGENT_ID,
  PROBE_UNAVAILABLE_REASON,
  probeConnectorAvailable,
  readProbeStarts,
  scopedRequest,
  startProbeRun,
  superadminScope,
  type Scoped,
} from './helpers/externalAgentFixtures'

/**
 * TC-AGENT-EXT-007: `agent_orchestrator.external_agents.invoke` is a real gate,
 * and it is OFF by default.
 *
 * The grant is declared in `acl.ts` and then deliberately omitted from every
 * persona in `setup.ts` — the `web_search` precedent — so a tenant that has not
 * been granted it cannot place an outbound call at all. What makes that testable
 * rather than merely asserted is the SECOND half of the claim: the refusal has to
 * happen BEFORE the connector is reached, or a denied invocation would still have
 * rung somebody's phone. So the spec pins both the refusal and the fact that the
 * connector never started anything, which is a fact only the probe's own capture
 * can report.
 *
 * The role is built for exactly this: it holds `agents.run` (so the ROUTE lets the
 * request through and the refusal genuinely comes from the runner's own gate) and
 * `trace.view`, and nothing else from this module.
 */

const ALLOWED_FEATURES = ['agent_orchestrator.agents.run', 'agent_orchestrator.trace.view']

test.describe('TC-AGENT-EXT-007: external agent invocation is default-off', () => {
  test.setTimeout(120_000)

  let scope: Scoped
  let available = false
  let roleId: string | null = null
  let userId: string | null = null
  const email = `probe-noinvoke-${randomUUID().slice(0, 8)}@acme.com`
  const password = 'Sup3rSecret!probe'

  test.beforeAll(async ({ request }) => {
    scope = await superadminScope(request)
    available = await probeConnectorAvailable(request, scope.token)
  })

  test.afterAll(async ({ request }) => {
    await deleteUserIfExists(request, scope.token, userId)
    await deleteRoleIfExists(request, scope.token, roleId)
  })

  test('a caller without the invoke grant cannot place an external call, and nothing is dialled', async ({
    request,
  }) => {
    test.skip(!available, PROBE_UNAVAILABLE_REASON)

    roleId = await createRoleFixture(request, scope.token, {
      name: `probe-no-invoke-${randomUUID().slice(0, 8)}`,
      tenantId: scope.tenantId,
    })
    await setRoleAclFeatures(request, scope.token, {
      roleId,
      features: ALLOWED_FEATURES,
      organizations: [scope.organizationId],
    })
    userId = await createUserFixture(request, scope.token, {
      email,
      password,
      organizationId: scope.organizationId,
      roles: [roleId],
    })

    const restrictedToken = await getAuthToken(request, email, password)
    const restricted: Scoped = { ...scope, token: restrictedToken }

    const before = await readProbeStarts(request, scope)

    const refused = await scopedRequest(
      request,
      'POST',
      `/api/agent_orchestrator/agents/${PROBE_AGENT_ID}/run`,
      restricted,
      { input: { brief: 'this must never be dialled' } },
    )
    expect(
      refused.status(),
      'without agent_orchestrator.external_agents.invoke the run must not be accepted as started (202)',
    ).not.toBe(202)
    expect(refused.status(), 'and it must not have quietly succeeded either').not.toBe(200)

    const after = await readProbeStarts(request, scope)
    expect(
      after.length,
      'the gate runs before the run row opens and long before the connector — nothing may have been dialled',
    ).toBe(before.length)

    // The positive control: the same agent, the same organization, a caller who
    // DOES hold the grant. Without it, a route that refused everything would pass.
    const allowed = await startProbeRun(request, scope, { brief: 'granted caller' })
    expect(allowed.runId).toBeTruthy()
    const afterAllowed = await readProbeStarts(request, scope, allowed.externalRunId)
    expect(afterAllowed.length, 'a granted caller does reach the connector').toBe(1)
  })
})
