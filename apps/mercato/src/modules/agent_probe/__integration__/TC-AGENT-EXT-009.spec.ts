import { expect, test } from '@playwright/test'
import {
  PROBE_UNAVAILABLE_REASON,
  probeConnectorAvailable,
  readProbeStarts,
  scopedRequest,
  startProbeRun,
  superadminScope,
  type Scoped,
} from './helpers/externalAgentFixtures'

/**
 * TC-AGENT-EXT-009: re-running an external run is gated behind an explicit
 * confirmation (428), and both the Playground and a confirmed rerun answer 202.
 *
 * A rerun of a native agent costs tokens. A rerun of an EXTERNAL agent performs
 * the provider's real-world action again — it phones somebody a second time — so
 * the route refuses until the caller says so in the body. The status is 428
 * rather than 409 deliberately: 409 is this codebase's optimistic-lock status and
 * the client conflict helpers key off it, so reusing it would surface a "record
 * changed" bar for something that is not a concurrency problem.
 *
 * The 202 halves matter for the same reason in the other direction: an external
 * run has not finished when the request returns, and a 200 would reach the page's
 * success path and render a blank result while a phone was still ringing.
 *
 * This spec also proves the gate is a REFUSAL and not merely a different status:
 * the probe's own capture must show that the unconfirmed attempt started nothing.
 */

test.describe('TC-AGENT-EXT-009: rerun confirmation gate and the 202 arms', () => {
  test.setTimeout(120_000)

  let scope: Scoped
  let available = false

  test.beforeAll(async ({ request }) => {
    scope = await superadminScope(request)
    available = await probeConnectorAvailable(request, scope.token)
  })

  test('an unconfirmed rerun is 428 and starts nothing; a confirmed one is 202', async ({ request }) => {
    test.skip(!available, PROBE_UNAVAILABLE_REASON)

    // The Playground arm: 202 with the run id, never 200 with an empty result.
    const started = await startProbeRun(request, scope, { brief: 'rerun gate probe' })

    const before = await readProbeStarts(request, scope)

    const unconfirmed = await scopedRequest(
      request,
      'POST',
      `/api/agent_orchestrator/runs/${started.runId}/rerun`,
      scope,
      {},
    )
    expect(
      unconfirmed.status(),
      'an external rerun repeats a real-world action, so it must be refused until confirmed — and with 428, not the optimistic-lock 409',
    ).toBe(428)
    const refusal = (await unconfirmed.json()) as { code?: string; runtime?: string; agentId?: string }
    expect(refusal.code).toBe('external_call_confirmation_required')
    expect(refusal.runtime).toBe('external')

    const afterRefusal = await readProbeStarts(request, scope)
    expect(
      afterRefusal.length,
      'the gate runs before the mutation guard and before the runtime — nothing may have been started',
    ).toBe(before.length)

    const confirmed = await scopedRequest(
      request,
      'POST',
      `/api/agent_orchestrator/runs/${started.runId}/rerun`,
      scope,
      { confirmExternalCall: true },
    )
    expect(
      confirmed.status(),
      'a confirmed external rerun is ACCEPTED, not finished — the second call is now in flight',
    ).toBe(202)
    const rerun = (await confirmed.json()) as { runId: string | null; status: string; externalRunId: string | null }
    expect(rerun.status).toBe('suspended')
    expect(rerun.runId).toBeTruthy()
    expect(rerun.runId).not.toBe(started.runId)

    const afterConfirmation = await readProbeStarts(request, scope)
    expect(
      afterConfirmation.length,
      'the confirmed rerun genuinely started a second external run',
    ).toBe(before.length + 1)
  })
})
