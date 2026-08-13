import { expect, test } from '@playwright/test'
import {
  cancelWorkflowInstanceIfExists,
  deleteWorkflowDefinitionIfExists,
  getWorkflowInstanceSnapshot,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'
import {
  ANSWER_NOT_REACHED,
  BRIEF_FAILED_EVENT_ID,
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
 * TC-BRIEF-003: nobody picked up.
 *
 * A dialled-but-unanswered call, a voicemail box and a call that never
 * initiated all settle as a perfectly VALID researcher outcome — the agent
 * answered, and what it answered is "reached: false". That is the trap this
 * spec exists for: without the `check_reached` branch the run would take the
 * success route, write zero tasks, and tell the operator "the call about ACME
 * produced 0 follow-up tasks", which reads as a chief of sales who wanted
 * nothing rather than a phone that rang out.
 *
 * So the assertion is not merely "zero tasks" — a broken build would also
 * produce zero tasks. It is that the run ends at the FAILURE end step and the
 * notification is the `brief.failed` one, with the ensure-task command ENABLED
 * for the tenant throughout, so an empty CRM is a routing fact and not a
 * side-effect of the operator gate.
 */

test.describe('TC-BRIEF-003: an unanswered call routes to the failure branch, not to a success with no tasks', () => {
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
    previousCommandIds = await setCommandEnabled(request, scope, ENSURE_TASK_COMMAND_ID, true)
  })

  test.afterAll(async ({ request }) => {
    if (!available || previousCommandIds === null) return
    await writeCommandSettings(request, scope, previousCommandIds).catch(() => undefined)
  })

  test('ends at brief_failed, writes nothing to the CRM, and says the call was not reached', async ({
    request,
  }) => {
    test.skip(!available, PROBE_UNAVAILABLE_REASON)
    assertShadowMatchesShippedDefinition()

    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const tasks = [{ title: `Never write this task (${stamp})` }]

    const { parked, cleanup } = await parkBriefingAtVoiceStep(request, scope, { stamp, tasks })
    try {
      expect(parked, 'the run should be parked on the voice step').not.toBeNull()
      const run = parked as NonNullable<typeof parked>

      const settled = await postSignedCallback(request, run.callbackUrl, {
        body: { answer: ANSWER_NOT_REACHED },
        signWithOrganizationId: scope.organizationId,
      })
      expect(settled.status(), 'an unanswered call is still a settled run, not a rejected callback').toBe(200)

      const finished = await poll(async () => {
        const snapshot = await getWorkflowInstanceSnapshot(request, scope.token, run.instanceId)
        return snapshot && snapshot.status !== 'PAUSED' && snapshot.currentStepId !== 'call_chief'
          ? snapshot
          : null
      })
      expect(finished, 'the callback should have woken the parked step').not.toBeNull()
      expect(
        finished?.currentStepId,
        'a call nobody answered must take the failure route — the success END would announce a briefing that never happened',
      ).toBe('brief_failed')

      const announced = await poll(async () => {
        const rows = await listBriefNotifications(request, scope, run.companyEntityId)
        return rows.length > 0 ? rows : null
      }, 60_000)
      expect(announced, 'the initiator must be told the briefing did not complete').not.toBeNull()
      expect((announced ?? []).map((row) => row.type)).toEqual([BRIEF_FAILED_EVENT_ID])

      expect(
        (await listBriefTasks(request, scope, run.companyEntityId)).length,
        'the extracted-task list must never reach the CRM when the chief of sales was never spoken to',
      ).toBe(0)
    } finally {
      await cancelWorkflowInstanceIfExists(request, scope.token, cleanup.instanceId).catch(() => undefined)
      await deleteWorkflowDefinitionIfExists(request, scope.token, cleanup.definitionId).catch(() => undefined)
      await deleteCompanyIfExists(request, scope, cleanup.companyEntityId)
    }
  })
})
