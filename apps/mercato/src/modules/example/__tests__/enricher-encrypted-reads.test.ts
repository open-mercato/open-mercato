/** @jest-environment node */
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { enrichers } from '../data/enrichers'
import { ExampleCustomerPriority } from '../data/entities'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: jest.fn(async () => null),
}))

const findOneWithDecryptionMock = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const findWithDecryptionMock = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

const TENANT = '00000000-0000-4000-8000-00000000000a'
const ORG = '00000000-0000-4000-8000-0000000000a1'
const PERSON_ID = '00000000-0000-4000-8000-000000000000'
const SAME_BUCKET_ID = '00000000-0000-4000-8000-000000000011'
const OTHER_BUCKET_ID = '00000000-0000-4000-8000-000000000001'

function createContext() {
  const execute = jest.fn<Promise<Array<{ bucket: number; todoCount: string; openTodoCount: string }>>, [string, unknown[]]>().mockResolvedValue([])
  const find = jest.fn(async () => [])
  const findOne = jest.fn(async () => null)
  const forkedEm = { execute, find, findOne }
  const context: EnricherContext = {
    em: { fork: () => forkedEm },
    tenantId: TENANT,
    organizationId: ORG,
    userId: 'user-1',
    container: {},
  }
  return { context, forkedEm, execute, find, findOne }
}

const enricher = enrichers[0]

beforeEach(() => {
  findOneWithDecryptionMock.mockReset().mockResolvedValue(null)
  findWithDecryptionMock.mockReset()
  findWithDecryptionMock.mockImplementation(async () => [])
})

describe('example customer-todo-count enricher', () => {
  it('is the enricher this module registers for customers.person', () => {
    expect(enricher.id).toBe('example.customer-todo-count')
    expect(enricher.targetEntity).toBe('customers.person')
  })

  it('counts only the requested bucket for enrichOne and keeps the priority read scoped', async () => {
    const { context, forkedEm, execute, find } = createContext()
    execute.mockResolvedValue([{ bucket: 12, todoCount: '3', openTodoCount: '2' }])

    const result = await enricher.enrichOne({ id: PERSON_ID }, context)

    expect(result).toMatchObject({ id: PERSON_ID, _example: { todoCount: 3, openTodoCount: 2 } })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('where bucket in (?)'), [TENANT, ORG, 12])
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(
      forkedEm, ExampleCustomerPriority, { customerId: PERSON_ID, organizationId: ORG, tenantId: TENANT, deletedAt: null },
      expect.any(Object), { tenantId: TENANT, organizationId: ORG },
    )
    expect(find).not.toHaveBeenCalled()
  })

  it('fetches one aggregate per requested bucket and shares counts across bucket collisions', async () => {
    const { context, forkedEm, execute, find } = createContext()
    execute.mockResolvedValue([{ bucket: 12, todoCount: '3', openTodoCount: '2' }])
    const records = [PERSON_ID, SAME_BUCKET_ID, OTHER_BUCKET_ID].map((id) => ({ id }))

    const result = await enricher.enrichMany!(records, context)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('where bucket in (?, ?)'), [TENANT, ORG, 12, 11])
    const [[query]] = execute.mock.calls
    expect(query).toContain('where tenant_id = ? and organization_id = ? and deleted_at is null')
    expect(query).toContain('group by bucket')
    expect(query).not.toContain('notes')
    expect(result).toMatchObject([
      { id: PERSON_ID, _example: { todoCount: 3, openTodoCount: 2 } },
      { id: SAME_BUCKET_ID, _example: { todoCount: 3, openTodoCount: 2 } },
      { id: OTHER_BUCKET_ID, _example: { todoCount: 0, openTodoCount: 0 } },
    ])
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    expect(findWithDecryptionMock).toHaveBeenCalledWith(
      forkedEm, ExampleCustomerPriority,
      { customerId: { $in: records.map(({ id }) => id) }, organizationId: ORG, tenantId: TENANT, deletedAt: null },
      expect.any(Object), { tenantId: TENANT, organizationId: ORG },
    )
    expect(find).not.toHaveBeenCalled()
  })

  it('skips both reads for an empty list', async () => {
    const { context, execute } = createContext()

    await expect(enricher.enrichMany!([], context)).resolves.toEqual([])
    expect(execute).not.toHaveBeenCalled()
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('returns a stored nonfallback customer priority', async () => {
    const { context } = createContext()
    findWithDecryptionMock.mockImplementation(async (_em, entity) => entity === ExampleCustomerPriority ? [{ id: 'priority-1', customerId: 'person-1', priority: 'critical', updatedAt: new Date('2026-10-01T10:00:00.000Z') }] as never : [])

    const [record] = await enricher.enrichMany!([{ id: 'person-1' }], context)

    expect((record as never as { _example: { priority: string } })._example.priority).toBe('critical')
  })
})


describe('priority hydration on additional CRM semantic targets', () => {
  it.each(['customers.company', 'customers.deal'])('scopes %s child records and includes the captured version', async (target) => {
    const { context, forkedEm, find, findOne } = createContext()
    const contributor = enrichers.find((entry) => entry.targetEntity === target)
    findOneWithDecryptionMock.mockResolvedValue({ id: 'priority-1', customerId: 'record-1', priority: 'high', updatedAt: new Date('2026-10-01T10:00:00.000Z') } as never)
    const result = await contributor?.enrichOne({ id: 'record-1' }, context)
    expect(result).toMatchObject({ _example: { priority: 'high', priorityId: 'priority-1', priorityUpdatedAt: '2026-10-01T10:00:00.000Z' } })
    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(forkedEm, ExampleCustomerPriority, { customerId: 'record-1', tenantId: TENANT, organizationId: ORG, deletedAt: null }, expect.any(Object), { tenantId: TENANT, organizationId: ORG })
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
    expect(find).not.toHaveBeenCalled()
    expect(findOne).not.toHaveBeenCalled()
  })
})
