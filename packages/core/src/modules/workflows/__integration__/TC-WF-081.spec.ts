import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  buildMinimalDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  listWorkflowInstanceTasks,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-081: the workflow instance list and the user task list return every
 * row exactly once when walked page by page, even when rows share createdAt.
 *
 * Postgres sorts each limit/offset page on its own, so rows tied on the only
 * sort key come back in a different relative order per page unless the query
 * adds a unique tiebreak. The fixtures are created through the API; only their
 * created_at is set to one shared value so the tie is deterministic.
 */

const ROW_COUNT = 12
const PAGE_SIZE = 2

type ListBody = {
  data?: Array<{ id?: string }>
  pagination?: { total?: number }
}

async function walkPages(request: APIRequestContext, token: string, basePath: string): Promise<string[]> {
  const ids: string[] = []
  for (let offset = 0; offset < ROW_COUNT; offset += PAGE_SIZE) {
    const response = await apiRequest(request, 'GET', `${basePath}&limit=${PAGE_SIZE}&offset=${offset}`, { token })
    expect(response.status()).toBe(200)
    const body = await readJsonSafe<ListBody>(response)
    expect(body?.pagination?.total).toBe(ROW_COUNT)
    for (const row of body?.data ?? []) {
      if (row.id) ids.push(row.id)
    }
  }
  return ids
}

async function tieCreatedAt(table: 'workflow_instances' | 'user_tasks', ids: string[]): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `update ${table} set created_at = (select min(created_at) from ${table} where id = any($1::uuid[])) where id = any($1::uuid[])`,
      [ids],
    )
  })
}

function buildFanOutTaskDefinitionPayload(timestamp: number, assignedTo: string) {
  const branchIds = Array.from({ length: ROW_COUNT }, (_, index) => `task_${index + 1}`)
  return {
    workflowId: `qa-wf-081-tasks-${timestamp}`,
    workflowName: `QA TC-WF-081 tasks ${timestamp}`,
    version: 1,
    enabled: true,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'fork', stepName: 'Fork', stepType: 'PARALLEL_FORK', config: { joinStepId: 'join' } },
        ...branchIds.map((stepId) => ({
          stepId,
          stepName: stepId,
          stepType: 'USER_TASK',
          userTaskConfig: { assignedTo },
        })),
        { stepId: 'join', stepName: 'Join', stepType: 'PARALLEL_JOIN', config: { forkStepId: 'fork' } },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-fork', fromStepId: 'start', toStepId: 'fork', trigger: 'auto' },
        ...branchIds.flatMap((stepId) => [
          { transitionId: `fork-to-${stepId}`, fromStepId: 'fork', toStepId: stepId, trigger: 'auto' },
          { transitionId: `${stepId}-to-join`, fromStepId: stepId, toStepId: 'join', trigger: 'auto' },
        ]),
        { transitionId: 'join-to-end', fromStepId: 'join', toStepId: 'end', trigger: 'auto' },
      ],
    },
  }
}

test.describe('TC-WF-081: list pagination stays stable when createdAt ties', () => {
  test('instance list pages return every tied instance exactly once', async ({ request }) => {
    test.setTimeout(60_000)
    const token = await getAuthToken(request, 'admin')
    const definitionPayload = buildMinimalDefinitionPayload(Date.now(), '-081')
    const instanceIds: string[] = []
    let definitionId: string | null = null
    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, definitionPayload)
      for (let index = 0; index < ROW_COUNT; index += 1) {
        instanceIds.push(await startWorkflowInstanceFixture(request, token, {
          workflowId: definitionPayload.workflowId,
          initialContext: {},
        }))
      }
      await tieCreatedAt('workflow_instances', instanceIds)

      const basePath = `/api/workflows/instances?workflowId=${encodeURIComponent(definitionPayload.workflowId)}`
      const firstWalk = await walkPages(request, token, basePath)
      expect(new Set(firstWalk).size).toBe(ROW_COUNT)
      expect([...firstWalk].sort()).toEqual([...instanceIds].sort())
      expect(await walkPages(request, token, basePath)).toEqual(firstWalk)
    } finally {
      for (const instanceId of instanceIds) {
        await cancelWorkflowInstanceIfExists(request, token, instanceId)
      }
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('task list pages return every tied task of a fan-out step exactly once', async ({ request }) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'admin')
    const definitionPayload = buildFanOutTaskDefinitionPayload(Date.now(), getTokenScope(token).userId)
    let definitionId: string | null = null
    let instanceId: string | null = null
    try {
      definitionId = await createWorkflowDefinitionFixture(request, token, definitionPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: definitionPayload.workflowId,
        initialContext: {},
      })

      const basePath = `/api/workflows/tasks?workflowInstanceId=${encodeURIComponent(instanceId)}`
      let taskIds: string[] = []
      const deadline = Date.now() + 30_000
      while (Date.now() < deadline) {
        const response = await apiRequest(request, 'GET', `${basePath}&limit=100`, { token })
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<ListBody>(response)
        taskIds = (body?.data ?? []).flatMap((row) => (row.id ? [row.id] : []))
        if (taskIds.length >= ROW_COUNT) break
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      expect(taskIds).toHaveLength(ROW_COUNT)
      await tieCreatedAt('user_tasks', taskIds)

      const firstWalk = await walkPages(request, token, basePath)
      expect(new Set(firstWalk).size).toBe(ROW_COUNT)
      expect([...firstWalk].sort()).toEqual([...taskIds].sort())
      expect(await walkPages(request, token, basePath)).toEqual(firstWalk)

      for (const taskId of taskIds) {
        const response = await apiRequest(request, 'POST', `/api/workflows/tasks/${encodeURIComponent(taskId)}/complete`, {
          token,
          data: { formData: {} },
        })
        expect([200, 201]).toContain(response.status())
      }
      const finished = await pollWorkflowInstance(request, token, instanceId, (instance) => instance.status === 'COMPLETED', { timeoutMs: 30_000 })
      expect(finished?.status).toBe('COMPLETED')
    } finally {
      const openTasks = instanceId ? await listWorkflowInstanceTasks(request, token, instanceId).catch(() => []) : []
      for (const task of openTasks) {
        if (!task.id || (task.status !== 'PENDING' && task.status !== 'IN_PROGRESS')) continue
        await apiRequest(request, 'POST', `/api/workflows/tasks/${encodeURIComponent(task.id)}/complete`, {
          token,
          data: { formData: {} },
        }).catch(() => undefined)
      }
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
