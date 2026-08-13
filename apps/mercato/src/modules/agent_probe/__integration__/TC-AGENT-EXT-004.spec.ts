import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import {
  PROBE_UNAVAILABLE_REASON,
  createOrganization,
  deleteOrganizationIfExists,
  probeCallbackUrl,
  probeConnectorAvailable,
  postSignedCallback,
  readExternalRun,
  readRun,
  startProbeRun,
  superadminScope,
  type Scoped,
} from './helpers/externalAgentFixtures'

/**
 * TC-AGENT-EXT-004: cross-tenant denial on the PER-RUN TOKEN callback route.
 *
 * Design risk R3 is a forged settlement: a fabricated "the owner approved"
 * transcript settled against somebody else's workflow. Two independent properties
 * defend it, and this spec pins both at the HTTP boundary:
 *
 *   1. the verifier is chosen from the ROW, and the secret it checks is the ROW's
 *      OWN organization's — so a caller holding another organization's signing
 *      secret is refused (401) even with a valid token;
 *   2. the tenancy that authorises the settlement is the row's, never the request's
 *      — so a body loudly claiming another organization's ids settles under the
 *      row's organization and touches nothing in the organization it named.
 *
 * The second is the one no unit test with a mocked container can establish: it
 * needs two real organizations and a real row.
 */

test.describe('TC-AGENT-EXT-004: cross-tenant denial on the token callback route', () => {
  test.setTimeout(120_000)

  let scope: Scoped
  let available = false
  let otherOrganizationId: string | null = null

  test.beforeAll(async ({ request }) => {
    scope = await superadminScope(request)
    available = await probeConnectorAvailable(request, scope.token)
  })

  test.afterAll(async ({ request }) => {
    if (otherOrganizationId) await deleteOrganizationIfExists(request, scope, otherOrganizationId)
  })

  test('another organization’s signature cannot settle this row, and a body claiming another organization is ignored', async ({
    request,
  }) => {
    test.skip(!available, PROBE_UNAVAILABLE_REASON)

    otherOrganizationId = await createOrganization(request, scope, `probe-xtenant-${randomUUID().slice(0, 8)}`)
    const otherScope: Scoped = { ...scope, organizationId: otherOrganizationId }

    const ours = await startProbeRun(request, scope, { brief: 'row owned by organization A' })
    const theirs = await startProbeRun(request, otherScope, { brief: 'row owned by organization B' })
    const ourCallbackUrl = await probeCallbackUrl(request, scope, ours.externalRunId)

    // 1. The other organization's secret over our token.
    const foreignSignature = await postSignedCallback(request, ourCallbackUrl, {
      body: { answer: 'settled by the wrong tenant' },
      signWithOrganizationId: otherOrganizationId,
    })
    expect(
      foreignSignature.status(),
      'the verifier checks the ROW’s organization secret, so another organization’s signature must fail',
    ).toBe(401)
    expect((await readExternalRun(request, scope, ours.runId)).externalRun?.status).toBe('pending')
    expect((await readExternalRun(request, otherScope, theirs.runId)).externalRun?.status).toBe('pending')

    // 2. A correctly signed body that LIES about its tenancy.
    const lying = await postSignedCallback(request, ourCallbackUrl, {
      body: {
        answer: 'correctly signed, wrongly addressed',
        tenant_id: scope.tenantId,
        organization_id: otherOrganizationId,
        organizationId: otherOrganizationId,
      },
      signWithOrganizationId: scope.organizationId,
    })
    expect(lying.status(), 'the body is not a credential; the row already established the scope').toBe(200)

    const settledOurs = await readExternalRun(request, scope, ours.runId)
    const untouchedTheirs = await readExternalRun(request, otherScope, theirs.runId)
    expect(settledOurs.externalRun?.status, 'the settlement lands on the row the token addressed').toBe('completed')
    expect(
      untouchedTheirs.externalRun?.status,
      'the organization the body named must be entirely unaffected',
    ).toBe('pending')

    const ourRun = await readRun(request, scope, ours.runId)
    expect(ourRun.run.output).toEqual({
      kind: 'researcher',
      data: { answer: 'correctly signed, wrongly addressed' },
    })
  })
})
