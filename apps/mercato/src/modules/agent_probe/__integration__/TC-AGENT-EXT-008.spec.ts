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
  PROBE_CONNECTOR_ID,
  PROBE_UNAVAILABLE_REASON,
  createOrganization,
  deleteOrganizationIfExists,
  probeConnectorAvailable,
  scopedRequest,
  startProbeRun,
  superadminScope,
  type Scoped,
} from './helpers/externalAgentFixtures'

/**
 * TC-AGENT-EXT-008: the two new read routes — `GET /runs/:id/external` and
 * `GET /runs/:id/recording` — are organization-scoped and feature-gated.
 *
 * They are the operator's only window onto a parked call, which makes them the
 * two endpoints most worth getting the tenancy wrong on. Both look the RUN up
 * under the caller's organization first, so a run id belonging to another
 * organization must 404 before its correlation row is touched, and the 404 must
 * be indistinguishable from an unknown id.
 *
 * The recording arm also pins a capability claim the cockpit depends on: a
 * connector that does not implement `fetchRecording` — the probe, like the
 * generic HTTP connector — reports `supportsRecording: false`, and the route
 * answers 404 rather than rendering a control that cannot work.
 */

const READ_ONLY_FEATURES = ['agent_orchestrator.agents.run']

test.describe('TC-AGENT-EXT-008: external read routes are org-scoped and feature-gated', () => {
  test.setTimeout(120_000)

  let scope: Scoped
  let available = false
  let otherOrganizationId: string | null = null
  let roleId: string | null = null
  let userId: string | null = null
  const email = `probe-notrace-${randomUUID().slice(0, 8)}@acme.com`
  const password = 'Sup3rSecret!probe'

  test.beforeAll(async ({ request }) => {
    scope = await superadminScope(request)
    available = await probeConnectorAvailable(request, scope.token)
  })

  test.afterAll(async ({ request }) => {
    await deleteUserIfExists(request, scope.token, userId)
    await deleteRoleIfExists(request, scope.token, roleId)
    if (otherOrganizationId) await deleteOrganizationIfExists(request, scope, otherOrganizationId)
  })

  test('unauthenticated 401, missing trace.view 403, another organization 404, and the capability flag is honest', async ({
    request,
  }) => {
    test.skip(!available, PROBE_UNAVAILABLE_REASON)

    const started = await startProbeRun(request, scope, { brief: 'read route probe' })

    const anonymous = await request.fetch(
      `${process.env.BASE_URL?.trim() || 'http://localhost:3000'}/api/agent_orchestrator/runs/${started.runId}/external`,
      { method: 'GET', timeout: 30_000 },
    )
    expect(anonymous.status(), 'the read routes require a session').toBe(401)

    roleId = await createRoleFixture(request, scope.token, {
      name: `probe-no-trace-${randomUUID().slice(0, 8)}`,
      tenantId: scope.tenantId,
    })
    await setRoleAclFeatures(request, scope.token, {
      roleId,
      features: READ_ONLY_FEATURES,
      organizations: [scope.organizationId],
    })
    userId = await createUserFixture(request, scope.token, {
      email,
      password,
      organizationId: scope.organizationId,
      roles: [roleId],
    })
    const ungrantedToken = await getAuthToken(request, email, password)
    const ungranted: Scoped = { ...scope, token: ungrantedToken }

    for (const suffix of ['external', 'recording']) {
      const res = await scopedRequest(
        request,
        'GET',
        `/api/agent_orchestrator/runs/${started.runId}/${suffix}`,
        ungranted,
      )
      expect(res.status(), `GET /runs/:id/${suffix} must require agent_orchestrator.trace.view`).toBe(403)
    }

    otherOrganizationId = await createOrganization(request, scope, `probe-read-${randomUUID().slice(0, 8)}`)
    const otherScope: Scoped = { ...scope, organizationId: otherOrganizationId }

    for (const suffix of ['external', 'recording']) {
      const res = await scopedRequest(
        request,
        'GET',
        `/api/agent_orchestrator/runs/${started.runId}/${suffix}`,
        otherScope,
      )
      expect(
        res.status(),
        `a run in another organization must 404 on /${suffix} before its correlation row is touched`,
      ).toBe(404)
    }

    const unknown = await scopedRequest(
      request,
      'GET',
      `/api/agent_orchestrator/runs/${randomUUID()}/external`,
      scope,
    )
    expect(
      unknown.status(),
      'an unknown id and a cross-organization id must be indistinguishable',
    ).toBe(404)

    const mine = await scopedRequest(
      request,
      'GET',
      `/api/agent_orchestrator/runs/${started.runId}/external`,
      scope,
    )
    expect(mine.status()).toBe(200)
    const body = (await mine.json()) as {
      externalRun: { connectorId: string; status: string; externalRunId: string | null } | null
      connector: { id: string; registered: boolean; supportsRecording: boolean } | null
    }
    expect(body.externalRun?.connectorId).toBe(PROBE_CONNECTOR_ID)
    expect(body.externalRun?.status).toBe('pending')
    expect(body.externalRun?.externalRunId).toBe(started.externalRunId)
    expect(body.connector).toMatchObject({ id: PROBE_CONNECTOR_ID, registered: true })
    expect(
      body.connector?.supportsRecording,
      'the probe implements no fetchRecording, so no unusable control may be advertised',
    ).toBe(false)

    const recording = await scopedRequest(
      request,
      'GET',
      `/api/agent_orchestrator/runs/${started.runId}/recording`,
      scope,
    )
    expect(
      recording.status(),
      'a connector with no recording concept answers "nothing to play", not a server error',
    ).toBe(404)
  })
})
