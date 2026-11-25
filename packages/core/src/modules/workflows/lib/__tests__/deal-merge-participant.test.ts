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
  const nativeUpdate = jest.fn().mockResolvedValue(1)
  return { em: { nativeUpdate } as unknown as EntityManager, nativeUpdate }
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
    expect(manager.nativeUpdate).toHaveBeenCalledTimes(2)
    expect(manager.nativeUpdate).toHaveBeenCalledWith(UserTask, {
      id: 'task-1',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }, {
      entityBindings: [
        { entityType: 'customers:deal', entityId: scope.survivorId, label: 'Source' },
        { entityType: 'customers:person', entityId: 'person-1' },
      ],
      entityTypes: ['customers:deal', 'customers:person'],
      updatedAt: expect.any(Date),
    })
    expect(manager.nativeUpdate).toHaveBeenCalledWith(UserTask, {
      id: 'task-2',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }, {
      entityBindings: [{ entityType: 'customers:customer_deal', entityId: scope.survivorId }],
      entityTypes: ['customers:customer_deal'],
      updatedAt: expect.any(Date),
    })
  })

  it('registers once for the Deal entity', () => {
    registerWorkflowDealMergeParticipant()
    registerWorkflowDealMergeParticipant()
    expect(listEntityMergeParticipants('customers:customer_deal').map((participant) => participant.id))
      .toEqual(['workflows.deal-task-bindings'])
  })
})
