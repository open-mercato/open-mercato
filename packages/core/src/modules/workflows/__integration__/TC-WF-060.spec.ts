import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildFailingStepDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  listWorkflowInstanceEvents,
  listWorkflowInstanceSteps,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-060 [P0] (API): rerun-from-step — ACL-gated, and audited.
 *
 * Spec `.ai/specs/2026-07-26-workflows-ux-redesign.md` §8.4: *"**Rerun from
 * failed step**, optionally with edited context — audited as
 * `STEP_RERUN { editedContextDiff, by }`, gated by its own ACL feature"*.
 *
 * All three clauses are asserted, and none through a proxy:
 * - the replay itself (the cursor moves, the patched context is what the replay
 *   runs with, and a FRESH `StepInstance` appears while the superseded one keeps
 *   its terminal status — §8.4's "does NOT change the step state machine");
 * - the audit event, read off the instance event log with its `editedContextDiff`
 *   and its `by` compared against the CALLER's real user id, not merely present;
 * - the refusal, from a principal that holds `workflows.instances.view` but not
 *   `workflows.instances.rerun_step`, on a real rerunnable instance — so the 403
 *   is the feature gate and not a 404 wearing its clothes.
 *
 * Surfaces under test:
 * - POST /api/workflows/instances/[id]/rerun-step
 * - GET  /api/workflows/instances/[id]/events?eventType=STEP_RERUN
 * - GET  /api/workflows/instances/[id]/steps
 */

type RerunResponse = {
  data?: {
    instance?: { status?: string; currentStepId?: string; context?: Record<string, unknown> }
    editedContextDiff?: Record<string, { from?: unknown; to?: unknown }>
  }
  error?: string
  code?: string
}

test.describe('TC-WF-060: rerun from step', () => {
  test('a replay with edited context runs, moves the cursor and is audited', async ({ request }) => {
    test.setTimeout(180_000)

    const token = await getAuthToken(request, 'admin')
    const callerUserId = getTokenScope(token).userId
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`

    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      const payload = buildFailingStepDefinitionPayload(stamp)
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)

      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: payload.workflowId,
        initialContext: { attempt: 'first' },
      })

      const failed = await pollWorkflowInstance(
        request,
        token,
        instanceId,
        (instance) => instance.status === 'FAILED',
        { timeoutMs: 40_000 },
      )
      expect(failed?.status, 'the fixture run fails, which is what makes it rerunnable').toBe('FAILED')

      const before = await listWorkflowInstanceSteps(request, token, instanceId)
      const midBefore = before.filter((step) => step.stepId === 'mid')
      expect(midBefore, 'the step being replayed executed once before the replay').toHaveLength(1)
      expect(midBefore[0]?.status, 'and its attempt is terminal').toBe('COMPLETED')
      const supersededId = midBefore[0]?.id

      const response = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/rerun-step`,
        { token, data: { stepId: 'mid', contextPatch: { attempt: 'second', extra: 7 } } },
      )
      const body = await readJsonSafe<RerunResponse>(response)
      expect(
        response.status(),
        `the rerun is accepted (got ${response.status()}: ${JSON.stringify(body)})`,
      ).toBe(200)

      // The EDITED context is what the replay ran with — a rerun that ignored the
      // patch would still answer 200.
      expect(body?.data?.instance?.context).toMatchObject({ attempt: 'second', extra: 7 })
      expect(body?.data?.editedContextDiff).toMatchObject({
        attempt: { from: 'first', to: 'second' },
        extra: { from: null, to: 7 },
      })

      const replayed = await pollWorkflowInstance(
        request,
        token,
        instanceId,
        (instance) => (instance.retryCount ?? 0) > (failed?.retryCount ?? 0),
        { timeoutMs: 40_000 },
      )
      expect(replayed?.retryCount, 'the replay counts as an attempt on the instance').toBeGreaterThan(
        failed?.retryCount ?? 0,
      )
      expect(replayed?.context, 'the persisted context carries the edit').toMatchObject({
        attempt: 'second',
        extra: 7,
      })

      // §8.4: the previous attempt is NEVER revived. It keeps its terminal row and
      // the replay gets a new one, so no step status is ever set out of order.
      const after = await listWorkflowInstanceSteps(request, token, instanceId)
      const midAfter = after.filter((step) => step.stepId === 'mid')
      expect(midAfter.length, 'the replay created a SECOND attempt row').toBeGreaterThan(midBefore.length)
      const superseded = midAfter.find((step) => step.id === supersededId)
      expect(superseded?.status, 'the superseded attempt keeps its terminal status').toBe('COMPLETED')

      // The audit event — the only record linking the two attempts.
      const events = await listWorkflowInstanceEvents(request, token, instanceId, {
        eventType: 'STEP_RERUN',
      })
      expect(events, 'the rerun is audited as STEP_RERUN').toHaveLength(1)
      const audit = events[0]
      expect(audit.eventData?.stepId).toBe('mid')
      expect(audit.eventData?.by, 'the audit names the principal that asked for it').toBe(callerUserId)
      expect(audit.eventData?.editedContextDiff).toMatchObject({
        attempt: { from: 'first', to: 'second' },
        extra: { from: null, to: 7 },
      })
      expect(audit.eventData?.supersededStepInstanceId).toBe(supersededId)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('a principal without the rerun feature is refused, and nothing is replayed', async ({ request }) => {
    test.setTimeout(180_000)

    const adminToken = await getAuthToken(request, 'admin')
    // `employee` is granted `workflows.instances.view` by `setup.ts` but NOT
    // `workflows.instances.rerun_step`, which §8.4's ACL appendix reserves for
    // admins/devs. That makes it the honest negative principal: it can READ the
    // run it is refused permission to replay.
    const employeeToken = await getAuthToken(request, 'employee')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`

    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      const payload = buildFailingStepDefinitionPayload(stamp, { suffix: '-acl' })
      definitionId = await createWorkflowDefinitionFixture(request, adminToken, payload)

      instanceId = await startWorkflowInstanceFixture(request, adminToken, {
        workflowId: payload.workflowId,
        initialContext: { attempt: 'first' },
      })
      const failed = await pollWorkflowInstance(
        request,
        adminToken,
        instanceId,
        (instance) => instance.status === 'FAILED',
        { timeoutMs: 40_000 },
      )
      expect(failed?.status).toBe('FAILED')

      // The same principal CAN read the run: the refusal below is therefore the
      // feature gate, not a scoping 404.
      const readable = await apiRequest(
        request,
        'GET',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}`,
        { token: employeeToken },
      )
      expect(readable.status(), 'the refused principal can still read the run').toBe(200)

      const refused = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/rerun-step`,
        { token: employeeToken, data: { stepId: 'mid', contextPatch: { attempt: 'sneaky' } } },
      )
      expect(refused.status(), 'rerun-from-step is refused without its own feature').toBe(403)
      const refusedBody = await readJsonSafe<{ requiredFeatures?: string[] }>(refused)
      expect(
        refusedBody?.requiredFeatures ?? [],
        'and the refusal names the feature that was missing',
      ).toContain('workflows.instances.rerun_step')

      // A refusal must not have replayed anything: no audit row, no extra attempt,
      // and the context is untouched.
      const events = await listWorkflowInstanceEvents(request, adminToken, instanceId, {
        eventType: 'STEP_RERUN',
      })
      expect(events, 'a refused rerun leaves no audit row').toHaveLength(0)
      const stillFailed = await apiRequest(
        request,
        'GET',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}`,
        { token: adminToken },
      )
      const stillBody = await readJsonSafe<{
        data?: { retryCount?: number; context?: Record<string, unknown> }
      }>(stillFailed)
      expect(stillBody?.data?.retryCount ?? 0).toBe(failed?.retryCount ?? 0)
      expect(stillBody?.data?.context).toMatchObject({ attempt: 'first' })
    } finally {
      await cancelWorkflowInstanceIfExists(request, adminToken, instanceId)
      await deleteWorkflowDefinitionIfExists(request, adminToken, definitionId)
    }
  })

  /**
   * The engine now writes a TERMINAL row for a synchronously-failed AUTOMATED
   * step (the returned-error path marks it FAILED, matching the thrown-error
   * path), so `resolveRerunEligibility` reads a terminal latest attempt and the
   * step is rerunnable like any other.
   *
   * This test was previously INVERTED, asserting the defect: the row stayed
   * `ACTIVE` for ever, no `STEP_FAILED` event was logged, and the rerun was
   * refused `WORKFLOW_STEP_STILL_PARKED` — a refusal written for a step with a
   * live queue job or a pending proposal, neither of which exists here. It is
   * kept, the right way round, as the regression that the terminal row is
   * written: replaying the step that failed is the whole point of the surface.
   */
  test('the step that failed is itself rerunnable, because its row is terminal', async ({ request }) => {
    test.setTimeout(180_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`

    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      const payload = buildFailingStepDefinitionPayload(stamp, { suffix: '-defect' })
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)

      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: payload.workflowId,
      })
      const failed = await pollWorkflowInstance(
        request,
        token,
        instanceId,
        (instance) => instance.status === 'FAILED',
        { timeoutMs: 40_000 },
      )

      const steps = await listWorkflowInstanceSteps(request, token, instanceId)
      const boom = steps.find((step) => step.stepId === 'boom')
      expect(boom, 'the failing step has a row').toBeTruthy()
      expect(
        boom?.status,
        'a synchronously-failed AUTOMATED step is left terminal, like the thrown-error path',
      ).toBe('FAILED')

      const response = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}/rerun-step`,
        { token, data: { stepId: 'boom' } },
      )
      const body = await readJsonSafe<RerunResponse>(response)
      expect(
        response.status(),
        `rerunning the failed step is accepted (got ${response.status()}: ${JSON.stringify(body)})`,
      ).toBe(200)

      // A replay is an attempt: the instance counts it, which is what separates
      // an accepted rerun from a 200 that did nothing.
      const replayed = await pollWorkflowInstance(
        request,
        token,
        instanceId,
        (instance) => (instance.retryCount ?? 0) > (failed?.retryCount ?? 0),
        { timeoutMs: 40_000 },
      )
      expect(
        replayed?.retryCount ?? 0,
        'the replay counts as an attempt on the instance',
      ).toBeGreaterThan(failed?.retryCount ?? 0)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
