/**
 * Customer-bound workflow tasks surface on the customer (spec §2.3 phase-in).
 *
 * The direction of this subscriber is the point: `CustomerTodoLink` belongs to
 * the customers module, so customers writes it from the workflows event rather
 * than workflows reaching into a customers table. What is asserted below is
 * that a link is written for the bindings that genuinely address a
 * `CustomerEntity`, and for NOTHING else — a task about an order must not grow
 * a customer todo.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import handler, {
  WORKFLOW_TASK_TODO_SOURCE,
  collectCustomerEntityIds,
} from '../link-workflow-task-handler'

const TENANT = 'tenant-1'
const ORG = 'org-1'
const TASK_ID = 'task-1'
const PERSON_ID = 'person-1'

type Row = Record<string, unknown>

function makeContext(customers: Row[]) {
  const links: Row[] = []
  const findOne = jest.fn(async (entity: { name?: string }, where: Row) => {
    if (entity?.name === 'CustomerEntity') {
      return (
        customers.find(
          (customer) =>
            customer.id === where.id &&
            customer.tenantId === where.tenantId &&
            customer.organizationId === where.organizationId,
        ) ?? null
      )
    }
    if (entity?.name === 'CustomerTodoLink') {
      return (
        links.find(
          (link) =>
            link.entity === where.entity &&
            link.todoId === where.todoId &&
            link.todoSource === where.todoSource,
        ) ?? null
      )
    }
    return null
  })
  const flush = jest.fn(async () => undefined)
  const create = jest.fn((_entity: unknown, data: Row) => ({ ...data }))
  const persist = jest.fn((row: Row) => {
    links.push(row)
    return { flush }
  })
  const em = { findOne, flush, create, persist }
  return {
    ctx: { resolve: <T,>(): T => em as unknown as T },
    links,
    findOne,
    create,
  }
}

const personBinding = { entityType: 'customers:person', entityId: PERSON_ID, label: 'Ada' }

function payload(overrides: Row = {}) {
  return {
    taskId: TASK_ID,
    tenantId: TENANT,
    organizationId: ORG,
    entityBindings: [personBinding],
    ...overrides,
  }
}

describe('which bindings become customer todos', () => {
  test('takes the binding types that address a CustomerEntity, in either spelling', () => {
    expect(
      collectCustomerEntityIds([
        { entityType: 'customers:person', entityId: 'p1' },
        { entityType: 'customers.company', entityId: 'c1' },
        { entityType: 'customers:customer_entity', entityId: 'e1' },
      ]),
    ).toEqual(['p1', 'c1', 'e1'])
  })

  test('leaves out record types that are not customer entities', () => {
    // `CustomerTodoLink.entity` is a foreign key to `customer_entities`; a deal
    // lives in `customer_deals` and an order is another module entirely.
    expect(
      collectCustomerEntityIds([
        { entityType: 'customers:deal', entityId: 'd1' },
        { entityType: 'sales:order', entityId: 'o1' },
      ]),
    ).toEqual([])
  })

  test('ignores malformed bindings and de-duplicates', () => {
    expect(
      collectCustomerEntityIds([
        { entityType: 'customers:person', entityId: 'p1' },
        { entityType: 'customers:person', entityId: 'p1' },
        { entityType: 'customers:person' },
        'nope',
        null,
      ]),
    ).toEqual(['p1'])
  })
})

describe('link-workflow-task subscriber', () => {
  beforeEach(() => jest.clearAllMocks())

  /**
   * The literal is spelled out rather than referenced through the constant:
   * `'workflows'` is the value spec §2.3 names, and it is what distinguishes a
   * workflow task from the module's own `'customers:interaction'` todos in the
   * `(entity, todoId, todoSource)` unique key.
   */
  test('uses the workflows todo source', () => {
    expect(WORKFLOW_TASK_TODO_SOURCE).toBe('workflows')
  })

  test('writes one workflows-sourced todo link for a customer-bound task', async () => {
    const customer = { id: PERSON_ID, tenantId: TENANT, organizationId: ORG }
    const { ctx, links, create } = makeContext([customer])

    await handler(payload(), ctx)

    expect(links).toHaveLength(1)
    expect(create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entity: customer,
        todoId: TASK_ID,
        todoSource: 'workflows',
        tenantId: TENANT,
        organizationId: ORG,
      }),
    )
  })

  test('writes nothing for a task bound to no customer', async () => {
    const { ctx, links } = makeContext([{ id: PERSON_ID, tenantId: TENANT, organizationId: ORG }])

    await handler(payload({ entityBindings: [{ entityType: 'sales:order', entityId: 'order-1' }] }), ctx)
    await handler(payload({ entityBindings: [] }), ctx)
    await handler(payload({ entityBindings: undefined }), ctx)

    expect(links).toHaveLength(0)
  })

  test('writes nothing when the binding id is not a customer in this scope', async () => {
    // Bindings are authored free text resolved from run context — the id is
    // only assumed to be a customer once the scoped lookup says so.
    const { ctx, links } = makeContext([{ id: 'someone-else', tenantId: TENANT, organizationId: ORG }])

    await handler(payload(), ctx)

    expect(links).toHaveLength(0)
  })

  test('fails closed on a payload with no tenant or organization', async () => {
    const { ctx, links, findOne } = makeContext([
      { id: PERSON_ID, tenantId: TENANT, organizationId: ORG },
    ])

    await handler(payload({ tenantId: undefined }), ctx)
    await handler(payload({ organizationId: undefined }), ctx)

    expect(findOne).not.toHaveBeenCalled()
    expect(links).toHaveLength(0)
  })

  test('a redelivered event does not write a second link', async () => {
    const { ctx, links } = makeContext([{ id: PERSON_ID, tenantId: TENANT, organizationId: ORG }])

    await handler(payload(), ctx)
    await handler(payload(), ctx)

    expect(links).toHaveLength(1)
  })
})
