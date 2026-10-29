import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildMinimalDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  findInstanceUserTask,
  pollWorkflowInstance,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-067: business-key starts and subject filters (#7182).
 *
 * Covers the idempotent start contract of `POST /api/workflows/instances`
 * (`businessKey` + `reusePolicy`), the database arbitration of concurrent keyed
 * starts, and the `businessKey` / subject filters on the instance and task lists.
 */

type StartBody = {
  data?: {
    created?: boolean
    instance?: { id?: string; status?: string; businessKey?: string | null }
  }
}

type ListedInstance = { id: string; businessKey?: string | null }
type ListedTask = { id: string; workflowInstanceId?: string }

const PARALLEL_STARTS = 8

function buildKeyedTaskDefinitionPayload(stamp: string) {
  return {
    workflowId: `qa-wf-bkey-task-${stamp}`,
    workflowName: `QA Business Key Task ${stamp}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'review',
          stepName: 'Review',
          stepType: 'USER_TASK',
          userTaskConfig: {
            assignedToRoles: ['admin'],
            entityBindings: [{ entityType: 'customers:person', idPath: 'context.customerId', label: 'Customer' }],
            formSchema: { fields: [{ name: 'approved', type: 'boolean' }] },
          },
        },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-review', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
        { transitionId: 'review-to-end', fromStepId: 'review', toStepId: 'end', trigger: 'manual' },
      ],
    },
    enabled: true,
  }
}

/**
 * START → gate → (boom | park | END), routed by `context.mode`: `explode` fails
 * the run on an activity that cannot succeed, `park` parks it on a signal (an
 * OPEN instance), anything else completes it.
 */
function buildReopenableDefinitionPayload(stamp: string) {
  const byMode = (mode: string) => ({ operator: 'AND', rules: [{ field: 'mode', operator: '=', value: mode }] })
  return {
    workflowId: `qa-wf-bkey-reopen-${stamp}`,
    workflowName: `QA Business Key Reopen ${stamp}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'gate', stepName: 'Gate', stepType: 'AUTOMATED' },
        {
          stepId: 'boom',
          stepName: 'Boom',
          stepType: 'AUTOMATED',
          activities: [
            {
              activityId: 'boom',
              activityName: 'Boom',
              activityType: 'EXECUTE_FUNCTION',
              config: { functionName: 'qa-nonexistent-function-do-not-register' },
            },
          ],
        },
        { stepId: 'park', stepName: 'Park', stepType: 'WAIT_FOR_SIGNAL', signalConfig: { signalName: 'qa_bkey_release' } },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-gate', fromStepId: 'start', toStepId: 'gate', trigger: 'auto' },
        { transitionId: 'gate-to-boom', fromStepId: 'gate', toStepId: 'boom', trigger: 'auto', priority: 30, condition: byMode('explode') },
        { transitionId: 'gate-to-park', fromStepId: 'gate', toStepId: 'park', trigger: 'auto', priority: 20, condition: byMode('park') },
        { transitionId: 'gate-to-end', fromStepId: 'gate', toStepId: 'end', trigger: 'auto', priority: 0 },
        { transitionId: 'boom-to-end', fromStepId: 'boom', toStepId: 'end', trigger: 'auto' },
        { transitionId: 'park-to-end', fromStepId: 'park', toStepId: 'end', trigger: 'auto' },
      ],
    },
    enabled: true,
  }
}

async function startInstance(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<{ status: number; body: StartBody | null }> {
  const response = await apiRequest(request, 'POST', '/api/workflows/instances', { token, data })
  return { status: response.status(), body: await readJsonSafe<StartBody>(response) }
}

async function listRows<T>(request: APIRequestContext, token: string, path: string): Promise<T[]> {
  const response = await apiRequest(request, 'GET', path, { token })
  const body = await readJsonSafe<{ data?: T[] }>(response)
  expect(response.status(), `GET ${path} should return 200 (got ${response.status()}: ${JSON.stringify(body)})`).toBe(200)
  return body?.data ?? []
}

function instancesByKey(workflowId: string, businessKey: string): string {
  return `/api/workflows/instances?workflowId=${encodeURIComponent(workflowId)}&businessKey=${encodeURIComponent(businessKey)}&limit=100`
}

test.describe('TC-WF-067: workflow instance business key and subject filters', () => {
  test('keyed starts are idempotent, honour the reuse policy and filter by key and subject', async ({ request }) => {
    test.setTimeout(120_000)
    const stamp = `${Date.now()}`
    const token = await getAuthToken(request, 'admin')
    const definitionIds: string[] = []
    const instanceIds = new Set<string>()
    const remember = (result: { body: StartBody | null }) => {
      const id = result.body?.data?.instance?.id
      if (id) instanceIds.add(id)
      return id ?? null
    }

    try {
      const fastPayload = buildMinimalDefinitionPayload(Date.now(), '-bkey')
      const taskPayload = buildKeyedTaskDefinitionPayload(stamp)
      definitionIds.push(await createWorkflowDefinitionFixture(request, token, fastPayload))
      definitionIds.push(await createWorkflowDefinitionFixture(request, token, taskPayload))
      const fastId = fastPayload.workflowId
      const taskId = taskPayload.workflowId

      const personId = randomUUID()
      const orderId = `so-${stamp}`
      const openKey = `order:${stamp}:open`
      const first = await startInstance(request, token, {
        workflowId: taskId,
        businessKey: `  ${openKey}  `,
        initialContext: { customerId: personId },
        metadata: { entityType: 'sales:sales_order', entityId: orderId },
      })
      const openInstanceId = remember(first)
      expect(first.status, JSON.stringify(first.body)).toBe(201)
      expect(first.body?.data?.created).toBe(true)
      expect(first.body?.data?.instance?.businessKey).toBe(openKey)
      expect(openInstanceId).toBeTruthy()
      await pollWorkflowInstance(request, token, openInstanceId!, (instance) => instance.status === 'PAUSED')

      const repeat = await startInstance(request, token, {
        workflowId: taskId,
        businessKey: openKey,
        initialContext: { customerId: randomUUID() },
      })
      expect(repeat.status, JSON.stringify(repeat.body)).toBe(200)
      expect(repeat.body?.data?.created).toBe(false)
      expect(repeat.body?.data?.instance?.id).toBe(openInstanceId)

      const byKey = await listRows<ListedInstance>(request, token, instancesByKey(taskId, openKey))
      expect(byKey.map((row) => row.id)).toEqual([openInstanceId])
      expect(byKey[0]?.businessKey).toBe(openKey)

      const bySubject = await listRows<ListedInstance>(
        request,
        token,
        `/api/workflows/instances?entityType=sales:sales_order&entityId=${encodeURIComponent(orderId)}&limit=100`,
      )
      expect(bySubject.map((row) => row.id)).toEqual([openInstanceId])
      const mismatchedSubject = await listRows<ListedInstance>(
        request,
        token,
        `/api/workflows/instances?entityType=customers:person&entityId=${encodeURIComponent(orderId)}&limit=100`,
      )
      expect(mismatchedSubject).toHaveLength(0)

      const task = await findInstanceUserTask(request, token, openInstanceId!)
      expect(task?.id, 'the parked run should have raised its user task').toBeTruthy()
      const taskSubjectPath = (entityType: string, entityId: string) =>
        `/api/workflows/tasks?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`
      const tasksBySubject = await listRows<ListedTask>(request, token, taskSubjectPath('customers:person', personId))
      expect(tasksBySubject.map((row) => row.workflowInstanceId)).toEqual([openInstanceId])
      const tasksByAlias = await listRows<ListedTask>(request, token, taskSubjectPath('customers.person', personId))
      expect(tasksByAlias.map((row) => row.id)).toEqual([task!.id])
      const tasksForUnknownRecord = await listRows<ListedTask>(request, token, taskSubjectPath('customers:person', randomUUID()))
      expect(tasksForUnknownRecord).toHaveLength(0)

      const completedKey = `order:${stamp}:completed`
      const completedRun = await startInstance(request, token, { workflowId: fastId, businessKey: completedKey })
      const completedId = remember(completedRun)
      expect(completedRun.status, JSON.stringify(completedRun.body)).toBe(201)
      await pollWorkflowInstance(request, token, completedId!, (instance) => instance.status === 'COMPLETED')

      const rejected = await startInstance(request, token, {
        workflowId: fastId,
        businessKey: completedKey,
        reusePolicy: 'reject_duplicate',
      })
      expect(rejected.status, JSON.stringify(rejected.body)).toBe(200)
      expect(rejected.body?.data?.created).toBe(false)
      expect(rejected.body?.data?.instance?.id).toBe(completedId)

      const allowed = await startInstance(request, token, {
        workflowId: fastId,
        businessKey: completedKey,
        reusePolicy: 'allow_duplicate',
      })
      const allowedId = remember(allowed)
      expect(allowed.status, JSON.stringify(allowed.body)).toBe(201)
      expect(allowed.body?.data?.created).toBe(true)
      expect(allowedId).not.toBe(completedId)

      const cancelledKey = `order:${stamp}:cancelled`
      const toCancel = await startInstance(request, token, {
        workflowId: taskId,
        businessKey: cancelledKey,
        initialContext: { customerId: randomUUID() },
      })
      const cancelledId = remember(toCancel)
      expect(toCancel.status, JSON.stringify(toCancel.body)).toBe(201)
      await pollWorkflowInstance(request, token, cancelledId!, (instance) => instance.status === 'PAUSED')
      const cancelResponse = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(cancelledId!)}/cancel`,
        { token },
      )
      expect(cancelResponse.status()).toBe(200)
      await pollWorkflowInstance(request, token, cancelledId!, (instance) => instance.status === 'CANCELLED')

      const afterCancel = await startInstance(request, token, {
        workflowId: taskId,
        businessKey: cancelledKey,
        reusePolicy: 'allow_duplicate_failed_only',
        initialContext: { customerId: randomUUID() },
      })
      const afterCancelId = remember(afterCancel)
      expect(afterCancel.status, JSON.stringify(afterCancel.body)).toBe(201)
      expect(afterCancelId).not.toBe(cancelledId)

      const parallelKey = `order:${stamp}:parallel`
      const parallel = await Promise.all(
        Array.from({ length: PARALLEL_STARTS }, () =>
          startInstance(request, token, {
            workflowId: taskId,
            businessKey: parallelKey,
            initialContext: { customerId: randomUUID() },
          }),
        ),
      )
      parallel.forEach(remember)
      const parallelStatuses = parallel.map((result) => result.status)
      expect(parallelStatuses.filter((status) => status === 201), JSON.stringify(parallelStatuses)).toHaveLength(1)
      expect(parallelStatuses.filter((status) => status === 200)).toHaveLength(PARALLEL_STARTS - 1)
      expect(new Set(parallel.map((result) => result.body?.data?.instance?.id)).size).toBe(1)
      const parallelRows = await listRows<ListedInstance>(request, token, instancesByKey(taskId, parallelKey))
      expect(parallelRows).toHaveLength(1)

      const dryRun = await startInstance(request, token, {
        workflowId: fastId,
        businessKey: `order:${stamp}:dry`,
        dryRun: true,
      })
      remember(dryRun)
      expect(dryRun.status, JSON.stringify(dryRun.body)).toBe(400)
    } finally {
      for (const instanceId of instanceIds) {
        await cancelWorkflowInstanceIfExists(request, token, instanceId)
      }
      for (const definitionId of definitionIds) {
        await deleteWorkflowDefinitionIfExists(request, token, definitionId)
      }
    }
  })

  test('a recovered older run owns its key again after a newer run reused it and completed', async ({ request }) => {
    test.setTimeout(120_000)
    const stamp = `${Date.now()}`
    const token = await getAuthToken(request, 'admin')
    const payload = buildReopenableDefinitionPayload(stamp)
    const workflowId = payload.workflowId
    const businessKey = `order:${stamp}:reopen`
    const instanceIds = new Set<string>()
    let definitionId: string | null = null

    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)

      const runA = await startInstance(request, token, { workflowId, businessKey, initialContext: { mode: 'explode' } })
      const runAId = runA.body?.data?.instance?.id
      expect(runA.status, JSON.stringify(runA.body)).toBe(201)
      instanceIds.add(runAId!)
      await pollWorkflowInstance(request, token, runAId!, (instance) => instance.status === 'FAILED')

      const runB = await startInstance(request, token, {
        workflowId,
        businessKey,
        reusePolicy: 'allow_duplicate_failed_only',
        initialContext: { mode: 'complete' },
      })
      const runBId = runB.body?.data?.instance?.id
      expect(runB.status, JSON.stringify(runB.body)).toBe(201)
      expect(runBId).not.toBe(runAId)
      instanceIds.add(runBId!)
      await pollWorkflowInstance(request, token, runBId!, (instance) => instance.status === 'COMPLETED')

      const recover = await apiRequest(
        request,
        'POST',
        `/api/workflows/instances/${encodeURIComponent(runAId!)}/rerun-step`,
        { token, data: { stepId: 'gate', contextPatch: { mode: 'park' } } },
      )
      expect(recover.status(), JSON.stringify(await readJsonSafe(recover))).toBe(200)
      await pollWorkflowInstance(request, token, runAId!, (instance) => instance.status === 'PAUSED')

      for (const reusePolicy of ['reject_duplicate', 'allow_duplicate', 'allow_duplicate_failed_only'] as const) {
        const keyed = await startInstance(request, token, {
          workflowId,
          businessKey,
          reusePolicy,
          initialContext: { mode: 'complete' },
        })
        const keyedId = keyed.body?.data?.instance?.id
        if (keyedId) instanceIds.add(keyedId)
        expect(keyed.status, `${reusePolicy}: ${JSON.stringify(keyed.body)}`).toBe(200)
        expect(keyed.body?.data?.created, reusePolicy).toBe(false)
        expect(keyedId, `${reusePolicy} returns the open A, not the newer finished B`).toBe(runAId)
      }

      const rows = await listRows<ListedInstance>(request, token, instancesByKey(workflowId, businessKey))
      expect(rows.map((row) => row.id).sort()).toEqual([runAId, runBId].sort())
    } finally {
      for (const instanceId of instanceIds) {
        await cancelWorkflowInstanceIfExists(request, token, instanceId)
      }
      if (definitionId) await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
