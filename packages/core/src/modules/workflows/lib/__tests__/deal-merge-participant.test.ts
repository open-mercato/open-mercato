import type { EntityManager } from '@mikro-orm/postgresql'
import {
  listEntityMergeParticipants,
  resetEntityMergeParticipantsForTests,
} from '@open-mercato/shared/lib/entities/merge-participants'
import { UserTask } from '../../data/entities'

const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

import {
  mergeWorkflowDealTaskBindings,
  previewWorkflowDealTaskBindings,
  registerWorkflowDealMergeParticipant,
} from '../deal-merge-participant'

const scope = {
  entityId: 'customers:customer_deal',
  survivorId: '11111111-1111-4111-8111-111111111111',
  sourceId: '22222222-2222-4222-8222-222222222222',
  tenantId: '33333333-3333-4333-8333-333333333333',
  organizationId: '44444444-4444-4444-8444-444444444444',
}

const tasks = [
  {
    id: 'task-1',
    entityBindings: [
      { entityType: 'customers:deal', entityId: scope.sourceId, label: 'Source' },
      { entityType: 'customers:person', entityId: 'person-1' },
    ],
  },
  {
    id: 'task-2',
    entityBindings: [
      { entityType: 'Customers.Deal', entityId: scope.sourceId },
      { entityType: 'customers:customer_deal', entityId: scope.survivorId },
    ],
  },
  { id: 'task-3', entityBindings: [{ entityType: 'customers:deal', entityId: scope.survivorId }] },
  { id: 'task-4', entityBindings: [{ entityType: 'sales:order', entityId: scope.sourceId }] },
]

function harness() {
  mockFindWithDecryption.mockResolvedValue(tasks)
  const execute = jest.fn().mockResolvedValue([])
  return { em: { execute } as unknown as EntityManager, execute }
}

describe('workflows Deal merge participant', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetEntityMergeParticipantsForTests()
  })

  it('previews scoped task bindings through the Deal alias spellings', async () => {
    const manager = harness()
    await expect(previewWorkflowDealTaskBindings({ ...scope, em: manager.em })).resolves.toEqual({
      participantId: 'workflows.deal-task-bindings',
      label: 'workflows.dealMerge.participantLabel',
      sourceCount: 2,
      survivorCount: 2,
      overlapCount: 1,
    })
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      manager.em,
      UserTask,
      expect.objectContaining({ tenantId: scope.tenantId, organizationId: scope.organizationId }),
      expect.anything(),
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
  })

  it('rewrites source bindings, deduplicates per task and recomputes entity types', async () => {
    const manager = harness()
    await expect(mergeWorkflowDealTaskBindings({ ...scope, em: manager.em })).resolves.toEqual({ moved: 1, deduplicated: 1 })
    expect(manager.execute).toHaveBeenCalledTimes(1)
    const [sql, params] = manager.execute.mock.calls[0] as [string, Array<string | Date | null>]
    expect(sql).toContain('update user_tasks as t')
    expect(sql).toContain('where t.id = v.id and t.tenant_id = ? and t.organization_id = ?')
    expect(params[0]).toBeInstanceOf(Date)
    expect(params.slice(-2)).toEqual([scope.tenantId, scope.organizationId])
    const rows = params.slice(1, -2)
    expect(rows).toHaveLength(6)
    expect(rows[0]).toBe('task-1')
    expect(JSON.parse(rows[1] as string)).toEqual([
      { entityType: 'customers:deal', entityId: scope.survivorId, label: 'Source' },
      { entityType: 'customers:person', entityId: 'person-1' },
    ])
    expect(JSON.parse(rows[2] as string)).toEqual(['customers:deal', 'customers:person'])
    expect(rows[3]).toBe('task-2')
    expect(JSON.parse(rows[4] as string)).toEqual([{ entityType: 'customers:customer_deal', entityId: scope.survivorId }])
    expect(JSON.parse(rows[5] as string)).toEqual(['customers:customer_deal'])
  })

  it('issues a constant number of statements regardless of how many tasks move', async () => {
    const statementsFor = async (count: number) => {
      jest.clearAllMocks()
      mockFindWithDecryption.mockResolvedValue(Array.from({ length: count }, (_value, index) => ({
        id: `task-${index}`,
        entityBindings: [{ entityType: 'customers:deal', entityId: scope.sourceId }],
      })))
      const execute = jest.fn().mockResolvedValue([])
      const em = { execute } as unknown as EntityManager
      await expect(mergeWorkflowDealTaskBindings({ ...scope, em })).resolves.toEqual({ moved: count, deduplicated: 0 })
      await previewWorkflowDealTaskBindings({ ...scope, em })
      return execute.mock.calls.length + mockFindWithDecryption.mock.calls.length
    }
    const single = await statementsFor(1)
    expect(single).toBe(3)
    expect(await statementsFor(50)).toBe(single)
  })

  it('registers once for the Deal entity', () => {
    registerWorkflowDealMergeParticipant()
    registerWorkflowDealMergeParticipant()
    expect(listEntityMergeParticipants('customers:customer_deal').map((participant) => participant.id))
      .toEqual(['workflows.deal-task-bindings'])
  })
})
