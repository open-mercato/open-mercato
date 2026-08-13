import { expect, test } from '@playwright/test'
import {
  cancelWorkflowInstanceIfExists,
  deleteWorkflowDefinitionIfExists,
  getWorkflowInstanceSnapshot,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'
import {
  ANSWER_REACHED,
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
 * TC-BRIEF-002: a redelivered post-call webhook must not double the CRM.
 *
 * Providers redeliver. ElevenLabs retries a post-call webhook, and any provider
 * will replay one after a timeout it observed but we did not. The seam's
 * single-shot claim is already proven at the run level by TC-AGENT-EXT-002;
 * what is proven HERE is the thing an operator would actually notice — that a
 * second delivery adds no second task to a customer's timeline and no second
 * "briefing completed" to the initiator's bell.
 *
 * Note what this does and does not establish. A redelivery is refused by the
 * spent claim, so `ensure_task` is not invoked twice by this path at all; the
 * command's own convergence under a genuine re-invocation (the UPDATE_ENTITY
 * activity's `retryPolicy`, whose ids are derived from
 * `(instanceId, stepId, index)`) is covered by `commands/__tests__/ensureTask.test.ts`.
 * Both halves are needed; neither substitutes for the other.
 */

test.describe('TC-BRIEF-002: a replayed callback creates no second task and no second notification', () => {
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

  test('settles once, however many times the provider delivers', async ({ request }) => {
    test.skip(!available, PROBE_UNAVAILABLE_REASON)
    assertShadowMatchesShippedDefinition()

    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const tasks = [{ title: `Chase the signed order form (${stamp})`, priority: 'urgent' as const }]

    const { parked, cleanup } = await parkBriefingAtVoiceStep(request, scope, { stamp, tasks })
    try {
      expect(parked, 'the run should be parked on the voice step').not.toBeNull()
      const run = parked as NonNullable<typeof parked>
      const body = { answer: ANSWER_REACHED }

      const first = await postSignedCallback(request, run.callbackUrl, {
        body,
        signWithOrganizationId: scope.organizationId,
      })
      expect(first.status(), 'the first delivery settles the run').toBe(200)

      const written = await poll(async () => {
        const rows = await listBriefTasks(request, scope, run.companyEntityId)
        return rows.length >= tasks.length ? rows : null
      }, 90_000)
      expect(written, 'the first delivery should have produced the CRM task').not.toBeNull()
      const announced = await poll(async () => {
        const rows = await listBriefNotifications(request, scope, run.companyEntityId)
        return rows.length > 0 ? rows : null
      }, 60_000)
      expect(announced, 'the first delivery should have raised the notification').not.toBeNull()

      const replay = await postSignedCallback(request, run.callbackUrl, {
        body,
        signWithOrganizationId: scope.organizationId,
      })
      expect(
        replay.status(),
        'a redelivery is a normal provider behaviour and must be acknowledged, not 500ed into another retry',
      ).toBe(200)

      // The replay is refused synchronously by the claim, but the completion
      // path is asynchronous, so give a second settlement a real chance to land
      // before declaring that it did not.
      await new Promise((resolve) => setTimeout(resolve, 8_000))

      expect(
        (await listBriefTasks(request, scope, run.companyEntityId)).length,
        'a redelivered webhook must never add a second row to a customer timeline',
      ).toBe(written?.length)
      expect(
        (await listBriefNotifications(request, scope, run.companyEntityId)).length,
        'nor a second notification to the person who asked for the briefing',
      ).toBe(announced?.length)

      const snapshot = await getWorkflowInstanceSnapshot(request, scope.token, run.instanceId)
      expect(snapshot?.currentStepId, 'the run stays where the first delivery left it').toBe('brief_delivered')
    } finally {
      await cancelWorkflowInstanceIfExists(request, scope.token, cleanup.instanceId).catch(() => undefined)
      await deleteWorkflowDefinitionIfExists(request, scope.token, cleanup.definitionId).catch(() => undefined)
      await deleteCompanyIfExists(request, scope, cleanup.companyEntityId)
    }
  })
})
