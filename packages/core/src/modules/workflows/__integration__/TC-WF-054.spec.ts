import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildAgentReviewDeadlineDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  findInstanceUserTask,
  getUserTaskDetail,
  getWorkflowInstanceSnapshot,
  listWorkflowInstanceEvents,
  startWorkflowInstanceFixture,
  type UserTaskDetail,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-054 [P0] (API): a breached deadline on an agent disposition review
 * ESCALATES — and provably does not route.
 *
 * Spec `.ai/specs/2026-07-26-workflows-ux-redesign.md` §7.5 asks for
 * "deadline/breach-edge mechanics" on the agent node's review task. The
 * maintainer decision of 2026-07-29 settled what those mechanics ARE, and the
 * ABSENCE is the feature (`workflows/AGENTS.md` → Agent Disposition Review &
 * SLAs): `agentReviewOnBreachSchema` has no `route` action and no verdict arm,
 * because routing a run past a proposal nobody answered silently drops the
 * proposed mutation — a rejection in everything but name — and only a human may
 * reach a verdict. So this spec asserts the escalation AND the refusal to route.
 * The second half is the one that would regress silently: the mechanism is a
 * branch taken from the step's SHAPE, which no author-visible surface reveals.
 *
 * WHY THE STEP IS A USER_TASK CARRYING AN INVOKE_AGENT ACTIVITY. The production
 * disposition row is written by `agent_orchestrator`'s `dispositionService` (an
 * OPTIONAL enterprise peer) after a real model round trip, so a fixture that
 * raised one would only ever run where enterprise AND an AI provider key are
 * present. The engine does not care: `applyBreachHandling` picks its vocabulary
 * STRUCTURALLY from the compiled step — `isInvokeAgentStepDef` asks only whether
 * the step declares an `INVOKE_AGENT` activity — and reads nothing else off the
 * task row. A USER_TASK step that declares one therefore presents the breach
 * path with exactly the input production presents, on the real code path, with a
 * real `UserTask`, a real deadline and the real SLA queue job.
 * `handleUserTaskStep` reads `userTaskConfig` only, so the declared activity
 * never executes and the absent peer is never reached. The same substitution,
 * for the same reason, is what TC-WF-051 does with `WAIT_FOR_SIGNAL`.
 *
 * Surfaces under test:
 * - GET /api/workflows/tasks?workflowInstanceId= and /api/workflows/tasks/[id]
 * - GET /api/workflows/instances/[id]/events
 * - GET /api/workflows/instances/[id]
 * - GET /api/workflows/instances?attention=true
 */

/** Short enough to breach inside a test, long enough to observe the task first. */
const DEADLINE = '5s'
/** The breach is a DELAYED job on `workflow-activities`, picked up by the worker. */
const BREACH_TIMEOUT_MS = 120_000
const BREACH_POLL_INTERVALS = [500, 1_000, 2_000]

async function pollTaskField(
  fetchTask: () => Promise<UserTaskDetail | null>,
  field: 'escalatedAt' | 'reassignedAt',
): Promise<void> {
  await expect
    .poll(async () => (await fetchTask())?.[field] ?? null, {
      timeout: BREACH_TIMEOUT_MS,
      intervals: BREACH_POLL_INTERVALS,
      message: `the SLA breach job should set ${field} on the review task`,
    })
    .not.toBeNull()
}

/** Did the run follow the wired breach route? A followed route logs its transition. */
async function breachRouteWasFollowed(
  request: Parameters<typeof listWorkflowInstanceEvents>[0],
  token: string,
  instanceId: string,
): Promise<boolean> {
  const executed = await listWorkflowInstanceEvents(request, token, instanceId, {
    eventType: 'TRANSITION_EXECUTED',
  })
  return executed.some((event) => event.eventData?.transitionId === 'review-breach')
}

test.describe('TC-WF-054: a breached disposition deadline escalates', () => {
  test('the attention arm marks the run and leaves the proposal for a human', async ({ request }) => {
    test.setTimeout(240_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`

    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      const payload = buildAgentReviewDeadlineDefinitionPayload(stamp, {
        suffix: '-attention',
        deadlineDuration: DEADLINE,
        onBreach: { action: 'attention' },
      })
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)

      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: payload.workflowId,
        correlationKey: `qa-disposition-sla-${stamp}`,
      })

      const task = await findInstanceUserTask(request, token, instanceId, { timeoutMs: 30_000 })
      expect(task?.id, 'the review task exists').toBeTruthy()
      const taskId = task!.id!
      const created = await getUserTaskDetail(request, token, taskId)
      expect(created?.dueDate, 'and it carries the authored deadline').toBeTruthy()
      expect(created?.escalatedAt ?? null, 'which has not breached yet').toBeNull()

      const parkedBefore = await getWorkflowInstanceSnapshot(request, token, instanceId)
      expect(parkedBefore?.currentStepId, 'the run waits on the review').toBe('agent_review')

      await pollTaskField(() => getUserTaskDetail(request, token, taskId), 'escalatedAt')

      // (1) The escalation is recorded on the task.
      const breached = await getUserTaskDetail(request, token, taskId)
      expect(breached?.escalatedAt, 'the breach is stamped on the row').toBeTruthy()

      // (2) The event names WHICH vocabulary answered. `attention` exists ONLY in
      //     the agent-review vocabulary, so this is what proves the step's shape
      //     — not the config the author wrote — selected the escalate-only
      //     resolver.
      const events = await listWorkflowInstanceEvents(request, token, instanceId, {
        eventType: 'USER_TASK_DEADLINE_BREACHED',
      })
      expect(events, 'the breach is audited exactly once').toHaveLength(1)
      expect(events[0]?.eventData?.taskId).toBe(taskId)
      expect(
        events[0]?.eventData?.onBreach,
        'the agent-review vocabulary answered, not the USER_TASK one',
      ).toBe('attention')

      // (3) The marker, and nothing else. §7.5: "no status write, no
      //     `errorMessage`: the run is already parked and a late reviewer is not
      //     a failed run".
      const detail = await apiRequest(
        request,
        'GET',
        `/api/workflows/instances/${encodeURIComponent(instanceId)}`,
        { token },
      )
      const detailBody = await readJsonSafe<{
        data?: {
          status?: string
          currentStepId?: string
          errorMessage?: string | null
          metadata?: { attention?: { reason?: string; stepId?: string } | null } | null
        }
      }>(detail)
      expect(detailBody?.data?.metadata?.attention?.reason).toBe('DISPOSITION_SLA_BREACH')
      expect(detailBody?.data?.metadata?.attention?.stepId).toBe('agent_review')
      expect(detailBody?.data?.errorMessage ?? null, 'a late reviewer is not a failure').toBeNull()
      expect(detailBody?.data?.status, 'the breach writes no status').toBe(parkedBefore?.status)

      // (4) THE REFUSAL TO ROUTE. The definition asked for it twice — a wired
      //     `kind: 'slaBreach'` transition to `escalate`, and
      //     `userTaskConfig.onBreach = { action: 'route' }` — and neither may be
      //     honoured, because the step is agent-shaped.
      expect(detailBody?.data?.currentStepId, 'the run did NOT move off the review step').toBe(
        'agent_review',
      )
      expect(
        await breachRouteWasFollowed(request, token, instanceId),
        'the wired slaBreach route was not followed',
      ).toBe(false)
      expect(
        breached?.status,
        'the task stays actionable; ESCALATED is what the route arm would have written',
      ).toMatch(/^(PENDING|IN_PROGRESS)$/)

      // (5) The marker is what an operator finds the run by.
      const attentionList = await apiRequest(
        request,
        'GET',
        '/api/workflows/instances?attention=true&limit=100',
        { token },
      )
      expect(attentionList.status()).toBe(200)
      const attentionBody = await readJsonSafe<{ data?: Array<{ id?: string }> }>(attentionList)
      expect(
        (attentionBody?.data ?? []).map((row) => row.id),
        'the escalated run is listed as needing attention',
      ).toContain(instanceId)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('the reassign arm hands the review to another queue without deciding it', async ({ request }) => {
    test.setTimeout(240_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    // Not a uuid, so `resolveBreachReassignTarget` reads it as a ROLE queue. It
    // is read UNINTERPOLATED from the definition, so it must be a literal.
    const escalationRole = 'admin'

    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      const payload = buildAgentReviewDeadlineDefinitionPayload(stamp, {
        suffix: '-reassign',
        deadlineDuration: DEADLINE,
        onBreach: { action: 'reassign', reassignTo: escalationRole },
        assignedToRoles: ['employee'],
      })
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)

      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: payload.workflowId,
        correlationKey: `qa-disposition-reassign-${stamp}`,
      })

      const task = await findInstanceUserTask(request, token, instanceId, { timeoutMs: 30_000 })
      expect(task?.id).toBeTruthy()
      const taskId = task!.id!
      expect(task?.assignedToRoles ?? [], 'the review starts on the authored queue').toContain(
        'employee',
      )

      await pollTaskField(() => getUserTaskDetail(request, token, taskId), 'reassignedAt')

      const reassigned = await getUserTaskDetail(request, token, taskId)
      expect(
        reassigned?.assignedToRoles ?? [],
        'the review moved to the escalation queue',
      ).toContain(escalationRole)
      expect(reassigned?.reassignReason).toBe('sla_breach')
      expect(reassigned?.escalatedAt).toBeTruthy()
      expect(reassigned?.escalatedTo).toBe(escalationRole)
      expect(reassigned?.status, 'a reassigned review is offered again, never resolved').toBe(
        'PENDING',
      )
      expect(
        reassigned?.claimedBy ?? null,
        'and it is unclaimed so the new queue can take it',
      ).toBeNull()

      const events = await listWorkflowInstanceEvents(request, token, instanceId, {
        eventType: 'USER_TASK_DEADLINE_BREACHED',
      })
      expect(events).toHaveLength(1)
      expect(events[0]?.eventData?.onBreach).toBe('reassigned')

      // Same refusal: escalating is not advancing.
      const snapshot = await getWorkflowInstanceSnapshot(request, token, instanceId)
      expect(snapshot?.currentStepId, 'the run still waits on the review').toBe('agent_review')
      expect(snapshot?.status, 'and it is neither completed nor failed').not.toBe('COMPLETED')
      expect(snapshot?.status).not.toBe('FAILED')
      expect(
        await breachRouteWasFollowed(request, token, instanceId),
        'the wired slaBreach route was not followed',
      ).toBe(false)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
