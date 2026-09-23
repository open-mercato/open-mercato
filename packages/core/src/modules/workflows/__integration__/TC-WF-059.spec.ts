import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  getCapturedOmEvents,
  installOmEventCollector,
} from '@open-mercato/core/helpers/integration/sseEventCollector'
import {
  buildSignalDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-059 [P0] (UI): a live SSE lifecycle event updates an open run view.
 *
 * Spec `.ai/specs/2026-07-26-workflows-ux-redesign.md` §8.3: *"**Live:**
 * `workflows.instance.*` lifecycle events gain `clientBroadcast: true`; run views
 * subscribe via the DOM Event Bridge."*
 *
 * The claim is specifically that the view updates WITHOUT a reload, so a test
 * that navigated or refreshed would pass against a broken bridge. Three things
 * are therefore asserted together:
 *
 * 1. the lifecycle event actually reaches the browser, carrying THIS instance's
 *    id (`clientBroadcast` on the declaration is not proof that an emit site
 *    exists — `workflows.instance.paused`/`resumed` are declared and never
 *    emitted);
 * 2. the run view repaints — the status badge and the canvas both move on — from
 *    a mutation made entirely out of band, by an API call this page never made;
 * 3. the document was never reloaded, proven with a page-scoped sentinel that a
 *    navigation would destroy.
 *
 * `useLiveRunUpdates` REFETCHES rather than patching from the payload (the bridge
 * is best-effort and caps a payload at 4KB) and throttles the burst a step
 * advance produces, hence the generous assertion timeouts.
 *
 * Surfaces under test:
 * - /backend/instances/[id] (Flow tab + status badge)
 * - POST /api/workflows/instances/[id]/signal
 * - the DOM Event Bridge (`om:event` on `window`)
 */

const SIGNAL_NAME = 'approval'
const SENTINEL = '__tcWf059NoReload'

test.describe('TC-WF-059: live SSE updates a run view', () => {
  test('a signal sent out of band moves the open run view without a reload', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now() + randomInt(1_000)

    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      const payload = buildSignalDefinitionPayload(stamp, SIGNAL_NAME, '-live')
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)

      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: payload.workflowId,
        initialContext: { probe: stamp },
      })
      const parked = await pollWorkflowInstance(
        request,
        token,
        instanceId,
        (instance) => instance.status === 'PAUSED' && instance.currentStepId === 'wait',
        { timeoutMs: 40_000 },
      )
      expect(parked?.currentStepId, 'the run parks on its signal, so the view has somewhere to go').toBe(
        'wait',
      )

      await login(page, 'admin')
      await page.goto(`/backend/instances/${encodeURIComponent(instanceId)}`)

      // The paused state is on screen before anything is signalled.
      await expect(page.getByText('Paused', { exact: true }).first()).toBeVisible({ timeout: 30_000 })

      // A sentinel on the window: any navigation or reload destroys it, so its
      // survival is what makes "live" an assertion rather than a hope.
      await page.evaluate((key) => {
        ;(window as unknown as Record<string, unknown>)[key] = true
      }, SENTINEL)

      await installOmEventCollector(page)
      // The bridge connects asynchronously and the server does not replay: an
      // event emitted before the EventSource handshake is silently dropped.
      await page.waitForFunction(
        () => (window as unknown as { __omEventBridgeReady?: boolean }).__omEventBridgeReady === true,
        undefined,
        { timeout: 30_000 },
      )

      const signal = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/signal`,
        { token, data: { signalName: SIGNAL_NAME, payload: { approved: true } } },
      )
      expect(signal.status(), 'the signal is accepted').toBe(200)

      // (1) The lifecycle event reached the browser, for THIS instance.
      await expect
        .poll(
          async () => {
            const events = await getCapturedOmEvents(page)
            return events.some(
              (event) =>
                typeof event.id === 'string' &&
                event.id.startsWith('workflows.instance.') &&
                event.payload?.id === instanceId,
            )
          },
          { timeout: 45_000, intervals: [500, 1_000, 2_000] },
        )
        .toBe(true)

      const captured = await getCapturedOmEvents(page)
      const forThisRun = captured.filter((event) => event.payload?.id === instanceId)
      expect(
        forThisRun.map((event) => event.id),
        'the terminal transition is broadcast',
      ).toContain('workflows.instance.completed')
      // The payload is identity and state only — never authored content or run
      // context, because the bridge forwards it to every backoffice connection in
      // the tenant + organization WITHOUT evaluating ACL features.
      const completedPayload = forThisRun.find(
        (event) => event.id === 'workflows.instance.completed',
      )?.payload
      expect(completedPayload?.status).toBe('COMPLETED')
      expect(completedPayload, 'the broadcast carries no run context').not.toHaveProperty('context')

      // (2) The view moved on, from a mutation it never made itself.
      await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible({
        timeout: 45_000,
      })

      // (3) …and it never reloaded to find out.
      const survived = await page.evaluate(
        (key) => (window as unknown as Record<string, unknown>)[key] === true,
        SENTINEL,
      )
      expect(survived, 'the run view updated live rather than by navigating').toBe(true)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
