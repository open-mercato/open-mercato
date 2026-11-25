import type { EntityManager } from '@mikro-orm/postgresql'
import {
  listEntityMergeParticipants,
  resetEntityMergeParticipantsForTests,
} from '@open-mercato/shared/lib/entities/merge-participants'
import { DocumentEntityLink } from '../../data/entities'

const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

import {
  mergeDocumentDealLinks,
  previewDocumentDealLinks,
  registerDocumentDealMergeParticipant,
} from '../deal-merge-participant'

const scope = {
  entityId: 'customers:customer_deal',
  survivorId: '11111111-1111-4111-8111-111111111111',
  sourceId: '22222222-2222-4222-8222-222222222222',
  tenantId: '33333333-3333-4333-8333-333333333333',
  organizationId: '44444444-4444-4444-8444-444444444444',
}

const baseVersion = new Date('2026-01-01T00:00:00.000Z')

type LinkRow = {
  id: string
  documentId: string
  dealId: string
  deletedAt?: Date | null
  updatedAt?: Date
}

function createEntityManager(links: LinkRow[]) {
  mockFindWithDecryption.mockImplementation(async (
    _em: EntityManager,
    _entity: unknown,
    where: { deletedAt?: null },
  ) => links
    .map((link) => ({ deletedAt: null, updatedAt: baseVersion, ...link }))
    .filter((link) => !('deletedAt' in where) || link.deletedAt === null))
  const nativeDelete = jest.fn().mockResolvedValue(1)
  const nativeUpdate = jest.fn().mockResolvedValue(1)
  return {
    em: { nativeDelete, nativeUpdate } as unknown as EntityManager,
    nativeDelete,
    nativeUpdate,
  }
}

describe('documents Deal merge participant', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetEntityMergeParticipantsForTests()
  })

  it('previews scoped active source, survivor and overlap counts with an i18n label', async () => {
    const manager = createEntityManager([
      { id: 'link-1', documentId: 'document-a', dealId: scope.survivorId },
      { id: 'link-2', documentId: 'document-a', dealId: scope.sourceId },
      { id: 'link-3', documentId: 'document-b', dealId: scope.sourceId },
      { id: 'link-4', documentId: 'document-c', dealId: scope.sourceId, deletedAt: baseVersion },
    ])

    await expect(previewDocumentDealLinks({ ...scope, em: manager.em })).resolves.toEqual({
      participantId: 'documents.deal-links',
      label: 'documents.dealMerge.participantLabel',
      sourceCount: 2,
      survivorCount: 1,
      overlapCount: 1,
    })
    expect(mockFindWithDecryption).toHaveBeenCalledWith(manager.em, DocumentEntityLink, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      dealId: { $in: [scope.survivorId, scope.sourceId] },
    }, { disableIdentityMap: true }, { tenantId: scope.tenantId, organizationId: scope.organizationId })
  })

  it('deduplicates overlap and reparents active and soft-deleted source-only links in scope', async () => {
    const manager = createEntityManager([
      { id: 'link-1', documentId: 'document-a', dealId: scope.survivorId },
      { id: 'link-2', documentId: 'document-a', dealId: scope.sourceId },
      { id: 'link-3', documentId: 'document-b', dealId: scope.sourceId },
      { id: 'link-4', documentId: 'document-c', dealId: scope.sourceId, deletedAt: baseVersion },
      { id: 'link-5', documentId: 'document-b', dealId: scope.sourceId, deletedAt: baseVersion },
      { id: 'link-6', documentId: 'document-d', dealId: scope.survivorId, deletedAt: baseVersion },
      { id: 'link-7', documentId: 'document-d', dealId: scope.sourceId, deletedAt: baseVersion },
    ])

    await expect(mergeDocumentDealLinks({ ...scope, em: manager.em })).resolves.toEqual({
      moved: 2,
      deduplicated: 3,
    })
    expect(mockFindWithDecryption).toHaveBeenCalledWith(manager.em, DocumentEntityLink, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      dealId: { $in: [scope.survivorId, scope.sourceId] },
    }, { disableIdentityMap: true, filters: false }, { tenantId: scope.tenantId, organizationId: scope.organizationId })
    const deletedIds = manager.nativeDelete.mock.calls.map((call) => call[1].id).sort()
    expect(deletedIds).toEqual(['link-2', 'link-5', 'link-7'])
    for (const call of manager.nativeDelete.mock.calls) {
      expect(call[1]).toMatchObject({ tenantId: scope.tenantId, organizationId: scope.organizationId })
    }
    const movedIds = manager.nativeUpdate.mock.calls.map((call) => call[1].id).sort()
    expect(movedIds).toEqual(['link-3', 'link-4'])
    expect(manager.nativeUpdate).toHaveBeenCalledWith(DocumentEntityLink, {
      id: 'link-4',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      dealId: scope.sourceId,
    }, { dealId: scope.survivorId, updatedAt: expect.any(Date) })
    const updateValues = manager.nativeUpdate.mock.calls[0][2] as { updatedAt: Date }
    expect(updateValues.updatedAt.getTime()).toBeGreaterThan(baseVersion.getTime())
  })

  it('registers once per participant id for the Deal entity', () => {
    registerDocumentDealMergeParticipant()
    registerDocumentDealMergeParticipant()
    const participants = listEntityMergeParticipants('customers:customer_deal')
    expect(participants.map((participant) => participant.id)).toEqual(['documents.deal-links'])
  })
})
