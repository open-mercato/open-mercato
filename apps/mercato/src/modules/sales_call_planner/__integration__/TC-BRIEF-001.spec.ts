import { expect, test } from '@playwright/test'
import {
  cancelWorkflowInstanceIfExists,
  deleteWorkflowDefinitionIfExists,
  getWorkflowInstanceSnapshot,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'
import {
  ANSWER_REACHED,
  BRIEF_COMPLETED_EVENT_ID,
  ENSURE_TASK_COMMAND_ID,
  PROBE_UNAVAILABLE_REASON,
  assertShadowMatchesShippedDefinition,
  deleteCompanyIfExists,
  listBriefNotifications,
  listBriefTasks,
  parkBriefingAtVoiceStep,
  poll,
  postSignedCallback,
  probeConnectorAvailable,
  setCommandEnabled,
  superadminScope,
  writeCommandSettings,
  type Scoped,
} from './helpers/briefingFixtures'

/**
 * TC-BRIEF-001: the flagship. Pressing "Brief chief of sales" ends with CRM
 * tasks and a notification, and the phone call in the middle is answered by a
 * signed webhook rather than a worker holding a slot for half an hour.
 *
 * This is the feature. Everything else in this folder is one edge of it.
 *
 * What it proves that no unit test can: the chain crosses four processes — the
 * web request that starts the instance, the queue worker that reaches the
 * connector, the UNAUTHENTICATED provider callback, and the transition that
 * then writes CRM rows and raises a notification. Every unit suite mocks at
 * least one of them, so only a run like this one can catch a drift between
 * them, and there are three places to drift: the park signal name, the
 * `outputMapping` the callback applies from the correlation row, and the
 * `{{context.ensure_tasks.result.ensured}}` path the completion event reads out
 * of the transition's own output.
 *
 * See `helpers/briefingFixtures.ts` for exactly which two halves of the shipped
 * graph are substituted and why (they are the LLM agents, never the seam).
 */

test.describe('TC-BRIEF-001: briefing call → parked step → signed callback → CRM tasks → notification', () => {
  test.setTimeout(240_000)

  let scope: Scoped
  let available = false
  let previousCommandIds: string[] | null = null

  test.beforeAll(async ({ request }) => {
    // The enablement settle wait below is minutes-scale; the config default is 20 s.
    test.setTimeout(180_000)
    scope = await superadminScope(request)
    available = await probeConnectorAvailable(request, scope.token)
    if (!available) return
    // Operator gate #1, made explicit. `sales_call_planner.ensure_task` ships
    // OFF for every tenant, so a suite that did not tick it would be testing
    // TC-BRIEF-004's failure path while believing it tested this one.
    previousCommandIds = await setCommandEnabled(request, scope, ENSURE_TASK_COMMAND_ID, true)
  })

  test.afterAll(async ({ request }) => {
    if (!available || previousCommandIds === null) return
    await writeCommandSettings(request, scope, previousCommandIds).catch(() => undefined)
  })

  test('parks on the voice step, resumes from a signed callback, and lands two CRM tasks plus one notification', async ({
    request,
  }) => {
    test.skip(!available, PROBE_UNAVAILABLE_REASON)
    assertShadowMatchesShippedDefinition()

    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const tasks = [
      { title: `Send the revised quote (${stamp})`, body: 'The chief asked for it before Friday.', priority: 'high' as const },
      { title: `Book a call with procurement (${stamp})`, priority: 'medium' as const },
    ]

    const { parked, cleanup } = await parkBriefingAtVoiceStep(request, scope, { stamp, tasks })
    try {
      expect(
        parked,
        'the run should be PAUSED on call_chief with the connector already started — no worker slot is held while the call is in flight',
      ).not.toBeNull()
      const run = parked as NonNullable<typeof parked>

      const settled = await postSignedCallback(request, run.callbackUrl, {
        body: { answer: ANSWER_REACHED },
        signWithOrganizationId: scope.organizationId,
      })
      expect(settled.status(), 'a correctly signed post-call callback should be accepted').toBe(200)

      const finished = await poll(async () => {
        const snapshot = await getWorkflowInstanceSnapshot(request, scope.token, run.instanceId)
        return snapshot && snapshot.status !== 'PAUSED' && snapshot.currentStepId !== 'call_chief'
          ? snapshot
          : null
      })
      expect(finished, 'the callback should have woken the parked step').not.toBeNull()
      expect(
        finished?.currentStepId,
        'a call that was answered and produced tasks must end at brief_delivered, not the failure END',
      ).toBe('brief_delivered')

      const written = await poll(async () => {
        const rows = await listBriefTasks(request, scope, run.companyEntityId)
        return rows.length >= tasks.length ? rows : null
      }, 60_000)
      expect(written, 'the ensure-task command should have written one CRM row per extracted action').not.toBeNull()
      expect(
        (written ?? []).map((row) => row.title).sort((left, right) => left.localeCompare(right)),
        'the CRM rows are the tasks the chief of sales asked for, verbatim',
      ).toEqual(tasks.map((task) => task.title).sort((left, right) => left.localeCompare(right)))
      for (const row of written ?? []) {
        expect(row.interactionType, 'a briefing task is a CustomerInteraction of type task').toBe('task')
      }

      const announced = await poll(async () => {
        const rows = await listBriefNotifications(request, scope, run.companyEntityId)
        return rows.length > 0 ? rows : null
      }, 60_000)
      expect(announced, 'the completion transition should have raised an in-app notification').not.toBeNull()
      expect(
        (announced ?? []).map((row) => row.type),
        'the initiator is told the briefing completed — not that it failed',
      ).toEqual([BRIEF_COMPLETED_EVENT_ID])
    } finally {
      await cancelWorkflowInstanceIfExists(request, scope.token, cleanup.instanceId).catch(() => undefined)
      await deleteWorkflowDefinitionIfExists(request, scope.token, cleanup.definitionId).catch(() => undefined)
      await deleteCompanyIfExists(request, scope, cleanup.companyEntityId)
    }
  })
})
