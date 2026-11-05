import { resolveLegacyTodoDetails } from '../todoCompatibility'
import { WORKFLOW_TASK_TODO_SOURCE } from '../workflowTaskLink'
import type { CustomerTodoLink } from '../../data/entities'

/**
 * #6062: a workflow-created customer task rendered as "Untitled task".
 *
 * `resolveLegacyTodoDetails` hands `todoSource` straight to the query engine as
 * an entity id, so the link has to carry `workflows:user_task` rather than the
 * bare module name, and the title has to be read off `task_name` — the column
 * `user_tasks` actually stores the step's task name in.
 */

const TENANT_ID = '00000000-0000-0000-0000-0000000000t1'
const ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000o1'
const TASK_ID = '11111111-1111-1111-1111-111111111111'

function workflowTaskLink(): CustomerTodoLink {
  return {
    id: 'link-1',
    todoId: TASK_ID,
    todoSource: WORKFLOW_TASK_TODO_SOURCE,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  } as unknown as CustomerTodoLink
}

describe('resolveLegacyTodoDetails for workflow user tasks', () => {
  it('queries the user_task entity and reads the title from task_name', async () => {
    const queried: Array<{ entity: string; filters: unknown }> = []
    const queryEngine = {
      query: async (entity: string, options: { filters: unknown }) => {
        queried.push({ entity, filters: options.filters })
        return {
          items: [{ id: TASK_ID, task_name: 'Approve the renewal quote' }],
          total: 1,
        }
      },
    }

    const details = await resolveLegacyTodoDetails(
      queryEngine as never,
      [workflowTaskLink()],
      TENANT_ID,
      [ORGANIZATION_ID],
    )

    expect(queried).toHaveLength(1)
    expect(queried[0].entity).toBe('workflows:user_task')
    expect(details.get(`${WORKFLOW_TASK_TODO_SOURCE}:${TASK_ID}`)?.title).toBe('Approve the renewal quote')
  })

  it('keeps an explicit title ahead of task_name when a source supplies both', async () => {
    const queryEngine = {
      query: async () => ({
        items: [{ id: TASK_ID, title: 'Explicit title', task_name: 'Fallback name' }],
        total: 1,
      }),
    }

    const details = await resolveLegacyTodoDetails(
      queryEngine as never,
      [workflowTaskLink()],
      TENANT_ID,
      [ORGANIZATION_ID],
    )

    expect(details.get(`${WORKFLOW_TASK_TODO_SOURCE}:${TASK_ID}`)?.title).toBe('Explicit title')
  })
})
