import { expect, test } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import {
  PROBE_UNAVAILABLE_REASON,
  STATIC_CALLBACK_PATH,
  probeCallbackUrl,
  probeConnectorAvailable,
  postSignedCallback,
  readExternalRun,
  startProbeRun,
  superadminScope,
  type Scoped,
} from './helpers/externalAgentFixtures'

/**
 * TC-AGENT-EXT-003: the two rejection arms of the callback surface — the ONE
 * publicly reachable, unauthenticated write in the module.
 *
 * An unknown token must be a 404 that discloses nothing (whether a tenant, a run
 * or an agent exists is not a caller's business), and a body that is signed
 * wrongly must be a 401 that changes nothing. The positive control is in the same
 * spec on purpose: without it, a route that 404s everything would pass.
 *
 * Verified-against-source contract: `NOT_FOUND_BODY` is a single `{ error: 'Not
 * found' }` for every miss — unknown, malformed and out-of-scope alike — and the
 * failed-verification arm returns 401 while leaving the row `pending` so a
 * correctly signed redelivery still settles.
 */

test.describe('TC-AGENT-EXT-003: unknown token 404, bad signature 401', () => {
  test.setTimeout(90_000)

  let scope: Scoped
  let available = false

  test.beforeAll(async ({ request }) => {
    scope = await superadminScope(request)
    available = await probeConnectorAvailable(request, scope.token)
  })

  test('an unknown token is a bare 404 and a bad signature is a 401 that settles nothing', async ({ request }) => {
    test.skip(!available, PROBE_UNAVAILABLE_REASON)

    const unknownToken = `xrun_${randomBytes(32).toString('hex')}`
    const unknown = await postSignedCallback(
      request,
      `/api/agent_orchestrator/external-runs/${unknownToken}/callback`,
      { body: { answer: 'nobody asked' }, signWithOrganizationId: scope.organizationId },
    )
    expect(unknown.status(), 'an unknown token must not be distinguishable from any other miss').toBe(404)
    expect(
      await unknown.json(),
      'the 404 body must name nothing — not the tenant, not the run, not the agent',
    ).toEqual({ error: 'Not found' })

    const started = await startProbeRun(request, scope, { brief: 'signature probe' })
    const callbackUrl = await probeCallbackUrl(request, scope, started.externalRunId)

    const forged = await postSignedCallback(request, callbackUrl, {
      body: { answer: 'forged' },
      signWithOrganizationId: scope.organizationId,
      signature: randomBytes(32).toString('hex'),
    })
    expect(forged.status(), 'a wrong signature over the right token must be refused').toBe(401)

    const stillPending = await readExternalRun(request, scope, started.runId)
    expect(
      stillPending.externalRun?.status,
      'a refused callback must leave the row settleable, so a correct redelivery still works',
    ).toBe('pending')

    const accepted = await postSignedCallback(request, callbackUrl, {
      body: { answer: 'genuine' },
      signWithOrganizationId: scope.organizationId,
    })
    expect(accepted.status(), 'the positive control: the same row settles once correctly signed').toBe(200)
    expect(await accepted.json()).toMatchObject({ ok: true, status: 'completed' })
  })

  test('the static connector route answers 404 for an unknown connector and 400 for an unaddressable body', async ({
    request,
  }) => {
    test.skip(!available, PROBE_UNAVAILABLE_REASON)

    const unknownConnector = await postSignedCallback(
      request,
      '/api/agent_orchestrator/external-runs/connectors/probe.no_such_connector/callback',
      { body: { externalRunId: 'whatever' }, signWithOrganizationId: scope.organizationId },
    )
    expect(
      unknownConnector.status(),
      'an unknown connector answers 404, deliberately not 503 — the route must not be a probe for which packages a deployment runs',
    ).toBe(404)

    const unaddressable = await postSignedCallback(request, STATIC_CALLBACK_PATH, {
      body: { answer: 'no external run id here' },
      signWithOrganizationId: scope.organizationId,
    })
    expect(
      unaddressable.status(),
      'a payload the connector cannot self-address is a 400 — there is no run to refuse access to',
    ).toBe(400)
  })
})
