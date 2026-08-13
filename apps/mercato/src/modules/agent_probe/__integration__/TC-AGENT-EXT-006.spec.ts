import { expect, test } from '@playwright/test'
import {
  advanceQueue,
  PROBE_EXPIRING_AGENT_ID,
  PROBE_UNAVAILABLE_REASON,
  probeConnectorAvailable,
  probeCallbackUrl,
  postSignedCallback,
  readExternalRun,
  readRun,
  startProbeRun,
  superadminScope,
  type Scoped,
} from './helpers/externalAgentFixtures'

/**
 * TC-AGENT-EXT-006: the deadline sweep frees a run nobody answered.
 *
 * "A call nobody answers must never park a workflow forever" (design risk R2) is
 * the guarantee the whole suspend-and-resume design rests on, and it is the one
 * that only shows up in production if it is broken. The probe agent
 * `probe.echo_expiring` declares a one-second callback deadline, so the delayed
 * sweep job this test drains is the same job a half-hour voice call would fire.
 *
 * Verified-against-source contract: the sweep claims with `status: 'expired'`
 * through the SAME single-shot claim a callback uses, fails the run and resumes
 * down the `error` handle; a genuine late answer arriving afterwards is then
 * DROPPED with a 200, because recording it would contradict the row's terminal
 * status and the workflow has already branched.
 */

const SWEEP_QUEUE = 'agent-orchestrator-external-run-sweep'

test.describe('TC-AGENT-EXT-006: deadline sweep expires an unanswered external run', () => {
  test.setTimeout(120_000)

  let scope: Scoped
  let available = false

  test.beforeAll(async ({ request }) => {
    scope = await superadminScope(request)
    available = await probeConnectorAvailable(request, scope.token)
  })

  test('expires the correlation row, fails the run, and drops a late answer', async ({ request }) => {
    test.skip(!available, PROBE_UNAVAILABLE_REASON)

    const started = await startProbeRun(request, scope, {
      agentId: PROBE_EXPIRING_AGENT_ID,
      brief: 'nobody will answer this',
    })
    const callbackUrl = await probeCallbackUrl(request, scope, started.externalRunId)

    const pending = await readExternalRun(request, scope, started.runId)
    expect(pending.externalRun?.status).toBe('pending')
    expect(pending.externalRun?.expiresAt, 'a deadline is mandatory for an external agent').toBeTruthy()

    const expired = await poll(async () => {
      await advanceQueue(SWEEP_QUEUE)
      const view = await readExternalRun(request, scope, started.runId)
      return view.externalRun?.status === 'expired' ? view : null
    })

    expect(
      expired,
      'the delayed sweep job must reach the row after its deadline; a run nobody answers cannot stay pending',
    ).not.toBeNull()

    const run = await readRun(request, scope, started.runId)
    expect(run.run.status, 'the sweep settles the run as failed, not as quietly finished').toBe('error')
    expect(run.run.errorMessage, 'the reason must be readable by an operator').toBeTruthy()

    const late = await postSignedCallback(request, callbackUrl, {
      body: { answer: 'sorry, I was on the other line' },
      signWithOrganizationId: scope.organizationId,
    })
    expect(late.status(), 'a late but genuine callback is accepted transport-wise').toBe(200)
    expect(
      await late.json(),
      'the claim is spent, so a late answer changes nothing — it is dropped, deliberately',
    ).toMatchObject({ ok: true, status: 'already_settled' })
    expect((await readExternalRun(request, scope, started.runId)).externalRun?.status).toBe('expired')
  })
})

async function poll<T>(read: () => Promise<T | null>, timeoutMs = 60_000, intervalMs = 2_000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return null
}
