import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildInspectorUserTaskDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  deleteTaskBindingEntityTypeIfExists,
  findInstanceUserTask,
  pollWorkInbox,
  registerTaskBindingEntityType,
  startWorkflowInstanceFixture,
  type WorkInboxRowSnapshot,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-040 [P0]: Claim-next loop over the work inbox
 *
 * Surfaces under test:
 * - POST /api/workflows/work-inbox/next
 * - GET  /api/workflows/work-inbox (candidate ordering the loop walks)
 *
 * Real-behavior notes (verified against api/work-inbox/next/route.ts + task-handler.ts):
 * - The candidate list is a plain read and is EXPECTED to be stale. The claim itself is
 *   `taskHandler.claimUserTask`, a conditional `UPDATE … WHERE status = 'PENDING' AND
 *   claimed_by IS NULL`, so two operators pressing the button at the same instant see the
 *   same candidates and the loser's update affects zero rows. The handler then walks on to
 *   the next candidate instead of failing — which is why two concurrent calls return two
 *   DIFFERENT items rather than one item and one error.
 * - Nothing is claimable-by-guess: only `PENDING`, unassigned, unclaimed rows with a
 *   non-empty role queue are candidates (`listClaimableWorkInbox`).
 * - Phase 1 claims workflow tasks only — the endpoint pins `kind=user_task` because
 *   `taskHandler` is the claim seam for that kind. Other providers stay claimable through
 *   the endpoints their rows advertise in `actions`.
 * - Exhaustion is a 200 with `data: null`, not a 404: "nothing to do right now" is an
 *   ordinary answer for a queue.
 * - The endpoint parses the same query string the list does, so `?entityType=` narrows the
 *   candidate set. The tests rely on that to stay deterministic against a shared database —
 *   without it the loop would happily claim an unrelated suite's task. The `entityType` is
 *   REGISTERED as a tenant custom entity first: spec §6.4's entity clause fails closed on an
 *   unresolvable type, so an invented one makes the bound task invisible AND unclaimable
 *   (`actable` requires the entity clause too). See `registerTaskBindingEntityType`.
 */
type ClaimNextBody = { data?: WorkInboxRowSnapshot | null; message?: string }

test.describe('TC-WF-040: work inbox claim-next loop', () => {
  test('claims the queue in order, survives a concurrent claimer, and reports exhaustion', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const userId = getTokenScope(token).userId
    const timestamp = Date.now()
    const entityType = `qa:claim_next_${timestamp}`
    const scoped = `?entityType=${encodeURIComponent(entityType)}`

    const buildPayload = (suffix: string, priority: 'extreme' | 'high' | 'low') =>
      buildInspectorUserTaskDefinitionPayload(timestamp, {
        suffix,
        stepName: `Claim next ${priority} ${timestamp}`,
        postTaskTrigger: 'manual',
        userTaskConfig: {
          assignedToRoles: ['admin'],
          priority,
          entityBindings: [{ entityType, idPath: 'context.recordId' }],
          formSchema: { properties: { approved: { type: 'boolean' } } },
        },
      })

    const payloads = [
      buildPayload('-next-a', 'extreme'),
      buildPayload('-next-b', 'high'),
      buildPayload('-next-c', 'low'),
    ]
    const definitionIds: Array<string | null> = [null, null, null]
    const instanceIds: Array<string | null> = [null, null, null]

    const claimNext = async (): Promise<ClaimNextBody | null> => {
      const response = await apiRequest(request, 'POST', `/api/workflows/work-inbox/next${scoped}`, { token })
      expect(response.status(), 'claim-next should return 200 whether or not it claimed').toBe(200)
      return readJsonSafe<ClaimNextBody>(response)
    }

    try {
      await registerTaskBindingEntityType(request, token, entityType, `QA Claim Next ${timestamp}`)
      for (let index = 0; index < payloads.length; index += 1) {
        definitionIds[index] = await createWorkflowDefinitionFixture(request, token, payloads[index])
        instanceIds[index] = await startWorkflowInstanceFixture(request, token, {
          workflowId: payloads[index].workflowId,
          initialContext: { recordId: `qa-record-${timestamp}-${index}` },
        })
      }

      const taskIds: string[] = []
      for (const instanceId of instanceIds) {
        const task = await findInstanceUserTask(request, token, instanceId!, { statuses: ['PENDING'] })
        expect(task?.id, 'each fixture instance should park on a PENDING task').toBeTruthy()
        taskIds.push(task!.id!)
      }
      const [extremeTaskId, highTaskId, lowTaskId] = taskIds

      // The loop walks the inbox order, so the first claim takes the highest priority.
      await pollWorkInbox(request, token, scoped, (body) => (body.data ?? []).length === 3)
      const first = await claimNext()
      expect(first?.data?.id, 'claim-next takes the top of the queue').toBe(extremeTaskId)
      expect(first?.data?.status, 'the claimed row comes back already claimed').toBe('IN_PROGRESS')
      expect(first?.data?.claimedBy, 'and attributed to the caller').toBe(userId)

      // Two concurrent claimers: the CAS lets exactly one win each row, and the loser walks
      // on to the next candidate rather than erroring.
      const [secondBody, thirdBody] = await Promise.all([claimNext(), claimNext()])
      const concurrentIds = [secondBody?.data?.id, thirdBody?.data?.id]
      expect(
        concurrentIds.filter((id): id is string => typeof id === 'string').sort(),
        'concurrent claimers each get their own item, never the same one twice',
      ).toEqual([highTaskId, lowTaskId].sort())

      // Queue exhausted: a 200 with no item, not an error.
      const exhausted = await claimNext()
      expect(exhausted?.data ?? null, 'nothing left to claim').toBeNull()
      expect(exhausted?.message).toBe('No claimable work available')

      // An already-claimed task is no longer a candidate for anyone.
      const afterClaims = await pollWorkInbox(
        request,
        token,
        `${scoped}&status=IN_PROGRESS`,
        (body) => (body.data ?? []).length === 3,
      )
      expect(
        (afterClaims?.data ?? []).every((row) => row.claimedBy === userId),
        'every fixture row ended up claimed by the caller',
      ).toBe(true)
    } finally {
      for (const instanceId of instanceIds) {
        await cancelWorkflowInstanceIfExists(request, token, instanceId)
      }
      for (const definitionId of definitionIds) {
        await deleteWorkflowDefinitionIfExists(request, token, definitionId)
      }
      await deleteTaskBindingEntityTypeIfExists(request, token, entityType)
    }
  })
})
