import type { EntityManager } from '@mikro-orm/postgresql'
import {
  listEntityMergeParticipants,
  resetEntityMergeParticipantsForTests,
} from '@open-mercato/shared/lib/entities/merge-participants'
import { Message, MessageObject } from '../../data/entities'

const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

import {
  mergeMessageDealObjects,
  previewMessageDealObjects,
  registerMessageDealMergeParticipant,
} from '../deal-merge-participant'

const scope = {
  entityId: 'customers:customer_deal',
  survivorId: '11111111-1111-4111-8111-111111111111',
  sourceId: '22222222-2222-4222-8222-222222222222',
  tenantId: '33333333-3333-4333-8333-333333333333',
  organizationId: '44444444-4444-4444-8444-444444444444',
}

const objects = [
  { id: 'obj-1', messageId: 'msg-a', entityId: scope.sourceId, actionRequired: false },
  { id: 'obj-2', messageId: 'msg-b', entityId: scope.sourceId, actionRequired: true },
  { id: 'obj-3', messageId: 'msg-b', entityId: scope.survivorId, actionRequired: false },
  { id: 'obj-4', messageId: 'msg-c', entityId: scope.sourceId, actionRequired: false },
  { id: 'obj-5', messageId: 'msg-c', entityId: scope.survivorId, actionRequired: false },
  { id: 'obj-6', messageId: 'msg-foreign', entityId: scope.sourceId, actionRequired: false },
]

function harness() {
  mockFindWithDecryption.mockImplementation(async (_em: EntityManager, entity: unknown) => {
    if (entity === MessageObject) return objects
    return [{ id: 'msg-a' }, { id: 'msg-b' }, { id: 'msg-c' }]
  })
  const nativeUpdate = jest.fn().mockResolvedValue(1)
  const nativeDelete = jest.fn().mockResolvedValue(1)
  return { em: { nativeUpdate, nativeDelete } as unknown as EntityManager, nativeUpdate, nativeDelete }
}

describe('messages Deal merge participant', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetEntityMergeParticipantsForTests()
  })

  it('previews per-message counts restricted to messages in scope', async () => {
    const manager = harness()
    await expect(previewMessageDealObjects({ ...scope, em: manager.em })).resolves.toEqual({
      participantId: 'messages.deal-objects',
      label: 'messages.dealMerge.participantLabel',
      sourceCount: 3,
      survivorCount: 2,
      overlapCount: 2,
    })
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      manager.em,
      Message,
      {
        id: { $in: ['msg-a', 'msg-b', 'msg-c', 'msg-foreign'] },
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      expect.anything(),
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
  })

  it('moves source objects, keeps action-required objects and deduplicates per message', async () => {
    const manager = harness()
    await expect(mergeMessageDealObjects({ ...scope, em: manager.em })).resolves.toEqual({ moved: 1, deduplicated: 2 })
    const deleted = manager.nativeDelete.mock.calls.map((call) => call[1].id).sort()
    expect(deleted).toEqual(['obj-3', 'obj-4'])
    const updated = manager.nativeUpdate.mock.calls.map((call) => call[1].id).sort()
    expect(updated).toEqual(['obj-1', 'obj-2'])
    expect(manager.nativeUpdate).toHaveBeenCalledWith(MessageObject, {
      id: 'obj-1',
      messageId: 'msg-a',
      entityId: scope.sourceId,
    }, { entityId: scope.survivorId })
    expect(updated).not.toContain('obj-6')
  })

  it('registers once for the Deal entity', () => {
    registerMessageDealMergeParticipant()
    registerMessageDealMergeParticipant()
    expect(listEntityMergeParticipants('customers:customer_deal').map((participant) => participant.id))
      .toEqual(['messages.deal-objects'])
  })
})
