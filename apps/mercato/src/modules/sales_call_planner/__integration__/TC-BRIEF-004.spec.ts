import { expect, test } from '@playwright/test'
import {
  cancelWorkflowInstanceIfExists,
  deleteWorkflowDefinitionIfExists,
  getWorkflowInstanceSnapshot,
  listWorkflowInstanceEvents,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'
import {
  ANSWER_REACHED,
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
 * TC-BRIEF-004: operator gate #1 — the tenant never ticked
 * `sales_call_planner.ensure_task` in Settings → Workflows → Commands.
 *
 * This is the DEFAULT state of every tenant. The command deliberately ships
 * without `defaultEnabled`, because that flag is a grandfather clause for
 * commands that were reachable before the enablement gate existed, and a new
 * module handing itself one would be taking a decision that belongs to the
 * tenant. The cost of that correctness is that a freshly installed feature
 * silently does nothing at its last step unless somebody is told — so the
 * question this spec answers is not "does it fail" but "does the operator find
 * out, and can they act on what they are told".
 *
 * Three things have to be true for that to hold, and all three are asserted:
 * the call still happens and still settles (so nobody's time was wasted twice),
 * the run ends at the VISIBLE failure END rather than dying mid-transition, and
 * the instance event log names the actual cause in words an administrator can
 * search for — "UPDATE_ENTITY command is not enabled for this tenant".
 */

const NOT_ENABLED_MESSAGE = 'UPDATE_ENTITY command is not enabled for this tenant'

test.describe('TC-BRIEF-004: with the ensure-task command not enabled, the run fails loudly and says why', () => {
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
    previousCommandIds = await setCommandEnabled(request, scope, ENSURE_TASK_COMMAND_ID, false)
  })

  test.afterAll(async ({ request }) => {
    if (!available || previousCommandIds === null) return
    await writeCommandSettings(request, scope, previousCommandIds).catch(() => undefined)
  })

  test('routes to brief_failed, writes no CRM rows, and records a cause an administrator can act on', async ({
    request,
  }) => {
    test.skip(!available, PROBE_UNAVAILABLE_REASON)
    assertShadowMatchesShippedDefinition()

    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const tasks = [{ title: `Blocked by the tenant command gate (${stamp})` }]

    const { parked, cleanup } = await parkBriefingAtVoiceStep(request, scope, { stamp, tasks })
    try {
      expect(parked, 'the gate is on the LAST step — the call itself still happens').not.toBeNull()
      const run = parked as NonNullable<typeof parked>

      const settled = await postSignedCallback(request, run.callbackUrl, {
        body: { answer: ANSWER_REACHED },
        signWithOrganizationId: scope.organizationId,
      })
      expect(settled.status(), 'the call settles normally; only the CRM write is gated').toBe(200)

      const finished = await poll(async () => {
        const snapshot = await getWorkflowInstanceSnapshot(request, scope.token, run.instanceId)
        return snapshot && snapshot.status !== 'PAUSED' && snapshot.currentStepId !== 'call_chief'
          ? snapshot
          : null
      })
      expect(finished, 'the run must not park forever on a gate an operator can fix').not.toBeNull()
      expect(
        finished?.currentStepId,
        'a blocked CRM write takes the wired error route to the visible failure END',
      ).toBe('brief_failed')

      expect(
        (await listBriefTasks(request, scope, run.companyEntityId)).length,
        'nothing partial reaches the CRM when the command is switched off',
      ).toBe(0)

      const announced = await poll(async () => {
        const rows = await listBriefNotifications(request, scope, run.companyEntityId)
        return rows.length > 0 ? rows : null
      }, 60_000)
      expect(
        announced,
        'the person who pressed the button is told the briefing failed — an operator gate must not be a silent no-op',
      ).not.toBeNull()
      expect((announced ?? []).map((row) => row.type)).toEqual([BRIEF_FAILED_EVENT_ID])

      const events = await listWorkflowInstanceEvents(request, scope.token, run.instanceId, { limit: 200 })
      const diagnosis = JSON.stringify(events)
      expect(
        diagnosis.includes(NOT_ENABLED_MESSAGE),
        `the instance event log should name the cause verbatim ("${NOT_ENABLED_MESSAGE}") — a run that dies with an opaque error is a support ticket`,
      ).toBe(true)
    } finally {
      await cancelWorkflowInstanceIfExists(request, scope.token, cleanup.instanceId).catch(() => undefined)
      await deleteWorkflowDefinitionIfExists(request, scope.token, cleanup.definitionId).catch(() => undefined)
      await deleteCompanyIfExists(request, scope, cleanup.companyEntityId)
    }
  })
})
