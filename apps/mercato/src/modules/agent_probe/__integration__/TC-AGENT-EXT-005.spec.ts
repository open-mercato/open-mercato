import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import {
  PROBE_UNAVAILABLE_REASON,
  STATIC_CALLBACK_PATH,
  createOrganization,
  deleteOrganizationIfExists,
  probeConnectorAvailable,
  postSignedCallback,
  readExternalRun,
  readRun,
  startProbeRun,
  superadminScope,
  type Scoped,
} from './helpers/externalAgentFixtures'

/**
 * TC-AGENT-EXT-005: cross-tenant denial on the STATIC, connector-addressed
 * callback route — the mandatory case the design calls out for it.
 *
 * This route carries no token: a provider whose webhook destination is a
 * workspace setting (ElevenLabs) posts every tenant's answer to one URL, and the
 * only thing identifying the run is the provider's own id. That id is unique per
 * provider ACCOUNT, not globally, so two organizations on their own provider
 * workspaces can legitimately mint the SAME one — and the route resolves every
 * candidate and lets the SIGNATURE decide which tenant owns it, because the
 * webhook secret is per tenant.
 *
 * So: two organizations, one shared provider run id, one signature. Exactly one
 * row may settle, and it must be the one whose secret signed the body. Nothing
 * short of two real rows in two real organizations can test this, which is why it
 * is here and not in the unit suite.
 */

test.describe('TC-AGENT-EXT-005: static connector callback disambiguates tenancy by signature', () => {
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

  test('two organizations holding the same provider run id: only the correctly signed one settles', async ({
    request,
  }) => {
    test.skip(!available, PROBE_UNAVAILABLE_REASON)

    otherOrganizationId = await createOrganization(request, scope, `probe-static-${randomUUID().slice(0, 8)}`)
    const otherScope: Scoped = { ...scope, organizationId: otherOrganizationId }

    const sharedExternalRunId = `probe_shared_${randomUUID()}`
    const ours = await startProbeRun(request, scope, {
      brief: 'organization A run',
      forceExternalRunId: sharedExternalRunId,
    })
    const theirs = await startProbeRun(request, otherScope, {
      brief: 'organization B run',
      forceExternalRunId: sharedExternalRunId,
    })
    expect(ours.externalRunId).toBe(sharedExternalRunId)
    expect(theirs.externalRunId).toBe(sharedExternalRunId)

    const answer = 'organization B answered'
    const settled = await postSignedCallback(request, STATIC_CALLBACK_PATH, {
      body: { externalRunId: sharedExternalRunId, answer },
      signWithOrganizationId: otherOrganizationId,
    })
    expect(settled.status(), 'the correctly signed candidate settles').toBe(200)
    expect(await settled.json()).toMatchObject({ ok: true, status: 'completed' })

    expect(
      (await readExternalRun(request, otherScope, theirs.runId)).externalRun?.status,
      'the organization whose secret signed the body is the one that settles',
    ).toBe('completed')
    expect(
      (await readExternalRun(request, scope, ours.runId)).externalRun?.status,
      'the colliding row in the other organization must be untouched — the shared id is not a credential',
    ).toBe('pending')

    const theirRun = await readRun(request, otherScope, theirs.runId)
    expect(theirRun.run.output).toEqual({ kind: 'researcher', data: { answer } })

    // And a body nobody can sign settles neither.
    const unsigned = await postSignedCallback(request, STATIC_CALLBACK_PATH, {
      body: { externalRunId: sharedExternalRunId, answer: 'unsigned' },
      signWithOrganizationId: scope.organizationId,
      signature: 'deadbeef'.repeat(8),
    })
    expect(
      unsigned.status(),
      'zero verifying candidates is a 401 with no detail — never a hint that the id exists',
    ).toBe(401)
    expect(
      (await readExternalRun(request, scope, ours.runId)).externalRun?.status,
      'the still-pending row survives a failed verification',
    ).toBe('pending')
  })
})
