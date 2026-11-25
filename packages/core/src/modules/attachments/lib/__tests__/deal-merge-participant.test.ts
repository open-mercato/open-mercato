import type { EntityManager } from '@mikro-orm/postgresql'
import {
  collectEntityMergeParticipantPreviews,
  listEntityMergeParticipants,
  resetEntityMergeParticipantsForTests,
} from '@open-mercato/shared/lib/entities/merge-participants'
import { Attachment } from '../../data/entities'

const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

import {
  mergeAttachmentDealRecords,
  previewAttachmentDealRecords,
  registerAttachmentDealMergeParticipant,
} from '../deal-merge-participant'

const DEAL = 'customers:customer_deal'
const scope = {
  entityId: DEAL,
  survivorId: '11111111-1111-4111-8111-111111111111',
  sourceId: '22222222-2222-4222-8222-222222222222',
  tenantId: '33333333-3333-4333-8333-333333333333',
  organizationId: '44444444-4444-4444-8444-444444444444',
}

type Row = { id: string; entityId: string; recordId: string; storageMetadata: Record<string, unknown> | null }

function harness(rows: Row[]) {
  const execute = jest.fn().mockResolvedValue(rows.map((row) => ({ id: row.id })))
  const nativeUpdate = jest.fn().mockResolvedValue(1)
  mockFindWithDecryption.mockResolvedValue(rows)
  return { em: { execute, nativeUpdate } as unknown as EntityManager, execute, nativeUpdate }
}

const rows: Row[] = [
  { id: 'att-1', entityId: DEAL, recordId: scope.sourceId, storageMetadata: { assignments: [{ type: DEAL, id: scope.sourceId }] } },
  {
    id: 'att-2',
    entityId: 'customers:customer_entity',
    recordId: 'person-1',
    storageMetadata: { assignments: [{ type: DEAL, id: scope.sourceId }, { type: DEAL, id: scope.survivorId }] },
  },
  { id: 'att-3', entityId: DEAL, recordId: scope.survivorId, storageMetadata: null },
]

describe('attachments Deal merge participant', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetEntityMergeParticipantsForTests()
  })

  it('previews scoped owner and assignment references', async () => {
    const manager = harness(rows)
    await expect(previewAttachmentDealRecords({ ...scope, em: manager.em })).resolves.toEqual({
      participantId: 'attachments.deal-records',
      label: 'attachments.dealMerge.participantLabel',
      sourceCount: 2,
      survivorCount: 2,
      overlapCount: 1,
    })
    expect(manager.execute.mock.calls[0][1].slice(0, 2)).toEqual([scope.tenantId, scope.organizationId])
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      manager.em,
      Attachment,
      { id: { $in: ['att-1', 'att-2', 'att-3'] }, tenantId: scope.tenantId, organizationId: scope.organizationId },
      expect.anything(),
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
  })

  it('moves owned attachments and deduplicates assignments in scope', async () => {
    const manager = harness(rows)
    await expect(mergeAttachmentDealRecords({ ...scope, em: manager.em })).resolves.toEqual({ moved: 1, deduplicated: 1 })
    expect(manager.nativeUpdate).toHaveBeenCalledTimes(2)
    const [ownedWhere, ownedValues] = manager.nativeUpdate.mock.calls[0].slice(1)
    expect(ownedWhere).toEqual({ id: 'att-1', tenantId: scope.tenantId, organizationId: scope.organizationId })
    expect(ownedValues.recordId).toBe(scope.survivorId)
    expect(ownedValues.storageMetadata.assignments).toEqual([{ type: DEAL, id: scope.survivorId }])
    const [, assignedValues] = manager.nativeUpdate.mock.calls[1].slice(1)
    expect(assignedValues.recordId).toBeUndefined()
    expect(assignedValues.storageMetadata.assignments).toEqual([{ type: DEAL, id: scope.survivorId }])
  })

  it('skips the decrypting read when nothing references either Deal', async () => {
    const manager = harness([])
    await expect(mergeAttachmentDealRecords({ ...scope, em: manager.em })).resolves.toEqual({ moved: 0, deduplicated: 0 })
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('registers once for the Deal entity', () => {
    registerAttachmentDealMergeParticipant()
    registerAttachmentDealMergeParticipant()
    expect(listEntityMergeParticipants(DEAL).map((participant) => participant.id)).toEqual(['attachments.deal-records'])
  })

  it('gates the preview on attachments.view while merge stays unconditional', async () => {
    registerAttachmentDealMergeParticipant()
    const manager = harness(rows)
    const denied = jest.fn(async () => false)

    await expect(collectEntityMergeParticipantPreviews({ ...scope, em: manager.em, callerHasFeatures: denied })).resolves.toEqual([])
    expect(denied).toHaveBeenCalledWith(['attachments.view'])
    expect(manager.execute).not.toHaveBeenCalled()

    const allowed = jest.fn(async () => true)
    const previews = await collectEntityMergeParticipantPreviews({ ...scope, em: manager.em, callerHasFeatures: allowed })
    expect(previews.map((preview) => preview.participantId)).toEqual(['attachments.deal-records'])

    await expect(mergeAttachmentDealRecords({ ...scope, em: manager.em, callerHasFeatures: denied }))
      .resolves.toEqual({ moved: 1, deduplicated: 1 })
  })
})
