/** @jest-environment node */
/**
 * `Todo.notes` is an encrypted field, so this module's rule — and the repository
 * rule the module exists to demonstrate — is that every `Todo` read goes through
 * `findWithDecryption` rather than a raw `em.find`.
 *
 * These tests hold that as a behavioral contract, not a grep: the encryption
 * helper is mocked, so a regression back to `em.find(Todo, …)` makes the helper
 * assertions fail AND makes the counts stop tracking what the helper returned.
 */
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { enrichers } from '../data/enrichers'
import { ExampleCustomerPriority, Todo } from '../data/entities'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
}))

const findWithDecryptionMock = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

const TENANT = '00000000-0000-4000-8000-00000000000a'
const ORG = '00000000-0000-4000-8000-0000000000a1'

type StubTodo = { id: string; isDone: boolean }

function createContext() {
  const find = jest.fn(async (entity: unknown) => {
    if (entity === Todo) throw new Error('[internal] Todo must not be read with a raw em.find')
    return []
  })
  const findOne = jest.fn(async () => null)
  const forkedEm = { find, findOne }
  const context = {
    em: { fork: () => forkedEm },
    tenantId: TENANT,
    organizationId: ORG,
  }
  return { context, forkedEm, find, findOne }
}

function stubTodos(todos: StubTodo[]) {
  findWithDecryptionMock.mockImplementation(async () => todos as never)
}

const enricher = enrichers[0]

beforeEach(() => {
  findWithDecryptionMock.mockReset()
  findWithDecryptionMock.mockImplementation(async () => [])
})

describe('example customer-todo-count enricher reads Todo through the decryption helper', () => {
  it('is the enricher this module registers for customers.person', () => {
    expect(enricher.id).toBe('example.customer-todo-count')
    expect(enricher.targetEntity).toBe('customers.person')
  })

  it('routes the enrichOne Todo read through findWithDecryption with the request scope', async () => {
    const { context, forkedEm, find } = createContext()

    await enricher.enrichOne!({ id: 'person-1' }, context as never)

    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    expect(findWithDecryptionMock).toHaveBeenCalledWith(
      forkedEm,
      Todo,
      { organizationId: ORG, tenantId: TENANT, deletedAt: null },
      undefined,
      { tenantId: TENANT, organizationId: ORG },
    )
    expect(find.mock.calls.map((call) => call[0])).not.toContain(Todo)
  })

  it('routes the enrichMany Todo read through findWithDecryption and leaves the unencrypted priority entity on em.find', async () => {
    const { context, forkedEm, find } = createContext()

    await enricher.enrichMany!([{ id: 'person-1' }], context as never)

    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    // Asserts the FULL call, mirroring the enrichOne sibling above. Checking only
    // `calls[0][1] === Todo` left the where-clause, the decryption scope and the
    // EntityManager handle unasserted — two independent mutations to this call site
    // passed it, so the tenant/organization scope was unpinned on the list path.
    expect(findWithDecryptionMock).toHaveBeenCalledWith(
      forkedEm,
      Todo,
      { organizationId: ORG, tenantId: TENANT, deletedAt: null },
      undefined,
      { tenantId: TENANT, organizationId: ORG },
    )
    expect(find.mock.calls.map((call) => call[0])).toEqual([ExampleCustomerPriority])
  })

  it('derives its counts from the rows the decryption helper returned, not from em.find', async () => {
    const { context } = createContext()
    stubTodos([
      { id: 'todo-shared', isDone: false },
      { id: 'todo-shared', isDone: false },
      { id: 'todo-shared', isDone: true },
    ])

    const candidates = Array.from({ length: 200 }, (_, index) => ({ id: `person-${index}` }))
    const enriched = await enricher.enrichMany!(candidates, context as never)
    const counted = enriched.filter((record) => (record as never as { _example: { todoCount: number } })._example.todoCount > 0)

    expect(counted.length).toBeGreaterThan(0)
    for (const record of counted) {
      const summary = (record as never as { _example: { todoCount: number; openTodoCount: number } })._example
      expect(summary.todoCount).toBe(3)
      expect(summary.openTodoCount).toBe(2)
    }
  })

  it('reports zero when the decryption helper returns no rows', async () => {
    const { context } = createContext()
    stubTodos([])

    const candidates = Array.from({ length: 200 }, (_, index) => ({ id: `person-${index}` }))
    const enriched = await enricher.enrichMany!(candidates, context as never)

    for (const record of enriched) {
      const summary = (record as never as { _example: { todoCount: number; openTodoCount: number } })._example
      expect(summary).toEqual({ todoCount: 0, openTodoCount: 0, priority: 'normal' })
    }
  })

  it('returns a stored nonfallback customer priority', async () => {
    const { context, find } = createContext()
    find.mockResolvedValueOnce([{ customerId: 'person-1', priority: 'critical' }])

    const [record] = await enricher.enrichMany!([{ id: 'person-1' }], context as never)

    expect((record as never as { _example: { priority: string } })._example.priority).toBe('critical')
  })
})
