import type { EntityManager } from '@mikro-orm/postgresql'
import {
  collectEntityMergeParticipantPreviews,
  listEntityMergeParticipants,
  resetEntityMergeParticipantsForTests,
} from '@open-mercato/shared/lib/entities/merge-participants'
import { Attachment, AttachmentPartition } from '../../data/entities'
import { registerAttachmentAccessResolvers } from '../access-registry'

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
  mockFindWithDecryption.mockImplementation(async (_em: EntityManager, entity: unknown) =>
    entity === AttachmentPartition ? [] : rows)
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

  afterEach(() => registerAttachmentAccessResolvers([]))

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
    expect(manager.nativeUpdate).not.toHaveBeenCalled()
    expect(manager.execute).toHaveBeenCalledTimes(2)
    expect(manager.execute.mock.calls[0][0]).toMatch(/order by id for update$/)
    const [sql, params] = manager.execute.mock.calls[1] as [string, string[]]
    expect(sql).toContain('update attachments as a')
    expect(sql).toContain('record_id = case when a.entity_id = ? and a.record_id = ? then ? else a.record_id end')
    expect(sql).toContain('where a.id = v.id and a.tenant_id = ? and a.organization_id = ?')
    expect(params.slice(0, 3)).toEqual([DEAL, scope.sourceId, scope.survivorId])
    expect(params.slice(-2)).toEqual([scope.tenantId, scope.organizationId])
    const rewritten = params.slice(3, -2)
    expect(rewritten.filter((_value, index) => index % 2 === 0)).toEqual(['att-1', 'att-2'])
    for (const metadata of rewritten.filter((_value, index) => index % 2 === 1)) {
      expect(JSON.parse(metadata).assignments).toEqual([{ type: DEAL, id: scope.survivorId }])
    }
  })

  it('issues a constant number of statements regardless of how many attachments move', async () => {
    const statementsFor = async (count: number) => {
      jest.clearAllMocks()
      const many: Row[] = Array.from({ length: count }, (_value, index) => ({
        id: `att-${index}`,
        entityId: DEAL,
        recordId: scope.sourceId,
        storageMetadata: { assignments: [{ type: DEAL, id: scope.sourceId }] },
      }))
      const manager = harness(many)
      await expect(mergeAttachmentDealRecords({ ...scope, em: manager.em }))
        .resolves.toEqual({ moved: count, deduplicated: 0 })
      await previewAttachmentDealRecords({ ...scope, em: manager.em })
      expect(manager.execute.mock.calls.at(-1)?.[0]).not.toContain('for update')
      return manager.execute.mock.calls.length
        + manager.nativeUpdate.mock.calls.length
        + mockFindWithDecryption.mock.calls.length
    }
    const single = await statementsFor(1)
    expect(single).toBe(5)
    expect(await statementsFor(50)).toBe(single)
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

  it('omits counts when a registered owner policy could restrict record visibility', async () => {
    registerAttachmentDealMergeParticipant()
    registerAttachmentAccessResolvers([{ moduleId: 'test', resolvers: [{
      id: 'test.owner', targetPartition: '*', resolve: async () => ({ ok: true }),
    }] }])
    const manager = harness(rows)
    await expect(collectEntityMergeParticipantPreviews({
      ...scope, em: manager.em, callerHasFeatures: async () => true,
    })).resolves.toEqual([])
    expect(manager.execute).not.toHaveBeenCalled()
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('omits counts when a partition requires an owner policy', async () => {
    registerAttachmentDealMergeParticipant()
    const manager = harness(rows)
    mockFindWithDecryption.mockResolvedValueOnce([{
      accessResolverRequirements: [{ targetEntity: '*', resolverId: 'test.required' }],
    }])
    await expect(collectEntityMergeParticipantPreviews({
      ...scope, em: manager.em, callerHasFeatures: async () => true,
    })).resolves.toEqual([])
    expect(manager.execute).not.toHaveBeenCalled()
  })

  it('reads only partitions visible to the merge scope', async () => {
    registerAttachmentDealMergeParticipant()
    const manager = harness(rows)
    await collectEntityMergeParticipantPreviews({ ...scope, em: manager.em, callerHasFeatures: async () => true })
    const partitionCall = mockFindWithDecryption.mock.calls.find(([, entity]) => entity === AttachmentPartition)
    expect(partitionCall?.[2]).toEqual({
      $or: [
        { tenantId: null, organizationId: null },
        { tenantId: scope.tenantId, organizationId: null },
        { tenantId: scope.tenantId, organizationId: scope.organizationId },
      ],
    })
    expect(partitionCall?.[4]).toEqual({ tenantId: scope.tenantId, organizationId: scope.organizationId })
  })
})
