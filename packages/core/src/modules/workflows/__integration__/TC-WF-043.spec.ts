import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  buildInspectorUserTaskDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  findInstanceUserTask,
  pollWorkInbox,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-043 [P1]: Entity bindings — record context on the task, and the task on the record
 *
 * Surfaces under test:
 * - GET /api/workflows/tasks        (resolved `entityBindings`)
 * - GET /api/workflows/work-inbox   (`entityType` filter over the bindings)
 * - GET /api/customers/todos        (the `CustomerTodoLink` the customers module writes)
 *
 * Real-behavior notes (verified against lib/task-resolution.ts + customers/subscribers):
 * - A binding is authored as `{ entityType, idPath }`; the id is resolved from the RUN
 *   CONTEXT once, at task creation, and stored on the task's own `entity_bindings` column.
 *   Resolving later would let a definition edit retro-change what a running task is about.
 * - A binding whose id does not resolve is DROPPED, not carried as a dangling reference: an
 *   absent record is an ordinary outcome, and a task about "order #undefined" is worse than
 *   a task about nothing. The fixture authors one resolvable and one unresolvable binding to
 *   pin exactly that.
 * - Direction matters for the reverse link: workflows only ANNOUNCES the task and the
 *   records it is about (`workflows.task.assigned`); the customers module owns
 *   `CustomerTodoLink` and is the module that writes it, with `todoSource: 'workflows'`.
 *   Workflows never touches a customers table and a deployment without the customers module
 *   simply has no subscriber.
 * - The subscriber is registered `persistent: true`. With the platform default (single
 *   delivery off) a persistent emit still runs subscribers inline, so the link is written
 *   during workflow execution — which is asynchronous relative to the instance-start
 *   response, hence the poll.
 * - Precondition: the `customers.interactions.unified` flag is OFF (its default), so
 *   `GET /api/customers/todos` merges legacy `CustomerTodoLink` rows into the response. With
 *   the unified flag on, that endpoint serves canonical rows only and this link surfaces
 *   through the record-page widget instead.
 */
type TodoListBody = {
  items?: Array<{ todoId?: string; todoSource?: string }>
}

test.describe('TC-WF-043: task entity bindings and record-side linkage', () => {
  test('resolves bindings from run context and links the task onto the bound customer', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    let personId: string | null = null
    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'QAWorkInbox',
        lastName: `Person${timestamp}`,
        displayName: `QA Work Inbox Person ${timestamp}`,
      })

      const defPayload = buildInspectorUserTaskDefinitionPayload(timestamp, {
        suffix: '-bindings',
        stepName: `Call ${timestamp}`,
        postTaskTrigger: 'manual',
        userTaskConfig: {
          assignedToRoles: ['admin'],
          entityBindings: [
            { entityType: 'customers:person', idPath: 'context.customerId', label: 'The customer' },
            // Never resolves — proves an unresolved binding is dropped, not carried.
            { entityType: 'customers:person', idPath: 'context.missingCustomerId' },
          ],
          formSchema: { properties: { outcome: { type: 'string' } } },
        },
      })

      definitionId = await createWorkflowDefinitionFixture(request, token, defPayload)
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: defPayload.workflowId,
        initialContext: { customerId: personId },
      })

      const task = await findInstanceUserTask(request, token, instanceId, { statuses: ['PENDING'] })
      expect(task?.id, 'the instance should park on a task').toBeTruthy()
      const taskId = task!.id!

      expect(task?.entityBindings, 'only the resolvable binding is stored').toEqual([
        { entityType: 'customers:person', entityId: personId, label: 'The customer' },
      ])

      // The inbox projects the bound types so a caller can filter on them in SQL.
      const scoped = `?workflowInstanceId=${encodeURIComponent(instanceId)}`
      const boundRows = await pollWorkInbox(
        request,
        token,
        `${scoped}&entityType=customers%3Aperson`,
        (body) => (body.data ?? []).length === 1,
      )
      expect((boundRows?.data ?? []).map((row) => row.id), 'the entityType filter finds the task').toEqual([taskId])
      expect(boundRows?.data?.[0]?.entityTypes).toEqual(['customers:person'])
      expect(boundRows?.data?.[0]?.entityBindings?.[0]?.entityId).toBe(personId)

      const unboundRows = await pollWorkInbox(
        request,
        token,
        `${scoped}&entityType=sales%3Aorder`,
        () => true,
      )
      expect((unboundRows?.data ?? []).length, 'a type the task is not bound to matches nothing').toBe(0)

      // Reverse direction: the customers module surfaces the task on the customer record.
      const deadline = Date.now() + 10_000
      let linked = false
      for (;;) {
        const response = await apiRequest(
          request,
          'GET',
          `/api/customers/todos?entityId=${encodeURIComponent(personId)}&page=1&pageSize=100`,
          { token },
        )
        expect(response.status(), 'GET /api/customers/todos should return 200').toBe(200)
        const body = await readJsonSafe<TodoListBody>(response)
        linked = (body?.items ?? []).some(
          (item) => item.todoId === taskId && item.todoSource === 'workflows',
        )
        if (linked || Date.now() >= deadline) break
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      expect(linked, 'the customers subscriber wrote a workflows-sourced todo link').toBe(true)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
