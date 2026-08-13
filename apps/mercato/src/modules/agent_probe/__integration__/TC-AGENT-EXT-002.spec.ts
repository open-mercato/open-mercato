import { expect, test } from '@playwright/test'
import {
  PROBE_UNAVAILABLE_REASON,
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
 * TC-AGENT-EXT-002: a redelivered callback is idempotent — it answers 200 and
 * settles NOTHING a second time.
 *
 * Redelivery is ordinary provider behaviour, so the response has to be 2xx or the
 * provider retries forever. That makes the status code a weak assertion on its
 * own: a route that re-ran the whole settlement would also answer 200. The real
 * claim is that the run advanced EXACTLY ONCE, so this spec pins the observable
 * consequences instead — the correlation row's `updated_at` and the run's
 * `completed_at` and `output` must all be byte-identical across the redelivery,
 * and the second response must name itself `already_settled`.
 *
 * Verified-against-source contract: the single-shot claim is a conditional SQL
 * UPDATE (`external_runs.claim`), so the loser of a race — a redelivery included —
 * reports `already_settled` and returns without resuming
 * (`lib/runtime/completeExternalRun.ts`).
 */

test.describe('TC-AGENT-EXT-002: redelivered external callback is idempotent', () => {
  test.setTimeout(90_000)

  let scope: Scoped
  let available = false

  test.beforeAll(async ({ request }) => {
    scope = await superadminScope(request)
    available = await probeConnectorAvailable(request, scope.token)
  })

  test('answers 200 without settling or resuming a second time', async ({ request }) => {
    test.skip(!available, PROBE_UNAVAILABLE_REASON)

    const started = await startProbeRun(request, scope, { brief: 'idempotency probe' })
    const callbackUrl = await probeCallbackUrl(request, scope, started.externalRunId)
    const body = { answer: 'settled once' }

    const first = await postSignedCallback(request, callbackUrl, {
      body,
      signWithOrganizationId: scope.organizationId,
    })
    expect(first.status()).toBe(200)
    expect(await first.json()).toMatchObject({ ok: true, status: 'completed' })

    const afterFirst = await readExternalRun(request, scope, started.runId)
    const runAfterFirst = await readRun(request, scope, started.runId)
    expect(afterFirst.externalRun?.status).toBe('completed')
    expect(runAfterFirst.run.status).toBe('ok')

    const second = await postSignedCallback(request, callbackUrl, {
      body,
      signWithOrganizationId: scope.organizationId,
    })
    expect(second.status(), 'redelivery must be 2xx or the provider retries forever').toBe(200)
    expect(
      await second.json(),
      'the second delivery must report that it changed nothing, not that it completed the run again',
    ).toMatchObject({ ok: true, status: 'already_settled' })

    const afterSecond = await readExternalRun(request, scope, started.runId)
    const runAfterSecond = await readRun(request, scope, started.runId)
    expect(
      afterSecond.externalRun?.updatedAt,
      'a second settlement would have moved the correlation row',
    ).toBe(afterFirst.externalRun?.updatedAt)
    expect(
      runAfterSecond.run.completedAt,
      'a second settlement would have re-stamped the run',
    ).toBe(runAfterFirst.run.completedAt)
    expect(runAfterSecond.run.output).toEqual(runAfterFirst.run.output)
  })
})
