import { resolveLegacyTodoDetails } from '../todoCompatibility'
import type { CustomerTodoLink } from '../../data/entities'

/**
 * #6140: a `customer_todo_links` row with a colon-less legacy `todoSource`
 * (e.g. a bare module name such as `"workflows"`, written before the value
 * was required to be a `module:entity` id) made the query engine guess a
 * pluralized table name that does not exist, throwing a raw DB error
 * ("relation ... does not exist") that surfaced dashboard-wide as a
 * "Database schema mismatch" banner. `resolveLegacyTodoDetails` must skip a
 * malformed source instead of querying it.
 */

const TENANT_ID = '00000000-0000-0000-0000-0000000000t1'
const ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000o1'
const TASK_ID = '11111111-1111-1111-1111-111111111111'
const OTHER_TASK_ID = '22222222-2222-2222-2222-222222222222'

function todoLink(overrides: Partial<CustomerTodoLink>): CustomerTodoLink {
  return {
    id: 'link-1',
    todoId: TASK_ID,
    todoSource: 'workflows',
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  } as unknown as CustomerTodoLink
}

describe('resolveLegacyTodoDetails with a malformed legacy source', () => {
  it('skips a bare module-name source without querying the query engine', async () => {
    const query = jest.fn(async () => ({ items: [], total: 0 }))
    const queryEngine = { query }

    const details = await resolveLegacyTodoDetails(
      queryEngine as never,
      [todoLink({})],
      TENANT_ID,
      [ORGANIZATION_ID],
    )

    expect(query).not.toHaveBeenCalled()
    expect(details.size).toBe(0)
  })

  it('does not let a malformed source abort resolution for well-formed sources', async () => {
    const query = jest.fn(async (entity: string) => {
      if (entity === 'workflows:user_task') {
        return { items: [{ id: OTHER_TASK_ID, title: 'Approve the renewal quote' }], total: 1 }
      }
      return { items: [], total: 0 }
    })
    const queryEngine = { query }

    const details = await resolveLegacyTodoDetails(
      queryEngine as never,
      [
        todoLink({ id: 'link-1', todoId: TASK_ID, todoSource: 'workflows' }),
        todoLink({ id: 'link-2', todoId: OTHER_TASK_ID, todoSource: 'workflows:user_task' }),
      ],
      TENANT_ID,
      [ORGANIZATION_ID],
    )

    expect(query).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledWith('workflows:user_task', expect.anything())
    expect(details.get(`workflows:${TASK_ID}`)).toBeUndefined()
    expect(details.get(`workflows:user_task:${OTHER_TASK_ID}`)?.title).toBe('Approve the renewal quote')
  })

  it('still catches a query-engine failure for a well-formed source without throwing', async () => {
    const query = jest.fn(async () => {
      throw new Error('relation "user_tasks" does not exist')
    })
    const queryEngine = { query }

    const details = await resolveLegacyTodoDetails(
      queryEngine as never,
      [todoLink({ todoSource: 'workflows:user_task' })],
      TENANT_ID,
      [ORGANIZATION_ID],
    )

    expect(query).toHaveBeenCalledTimes(1)
    expect(details.size).toBe(0)
  })
})
