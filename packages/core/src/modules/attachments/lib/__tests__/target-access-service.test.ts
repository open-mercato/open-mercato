import type { EntityManager } from '@mikro-orm/postgresql'
import { AttachmentTargetAccessService } from '../target-access-service'

const findOneWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

const tenantId = 'tenant-1'
const organizationId = 'org-1'
const auth = { sub: 'user-1', tenantId, orgId: organizationId, roles: ['admin'] }

function makeService(attachment: Record<string, unknown> | null) {
  findOneWithDecryptionMock.mockResolvedValue(attachment)
  const em = {
    findOne: jest.fn(async () => ({ code: 'private', isPublic: false })),
  } as unknown as EntityManager
  return { service: new AttachmentTargetAccessService(em), em }
}

const input = {
  attachmentId: 'attachment-1',
  tenantId,
  organizationId,
  auth,
  targets: [
    { entityId: 'warranty_claims:warranty_claim', recordId: 'claim-1' },
    { entityId: 'warranty_claims:warranty_claim_line', recordId: 'line-1' },
  ],
}

describe('AttachmentTargetAccessService', () => {
  beforeEach(() => findOneWithDecryptionMock.mockReset())

  it('accepts a primary target or metadata assignment linked to the claim request', async () => {
    const direct = makeService({
      tenantId,
      organizationId,
      partitionCode: 'private',
      entityId: 'warranty_claims:warranty_claim_line',
      recordId: 'line-1',
      storageMetadata: null,
    })
    await expect(direct.service.canAccessLinkedTarget(input)).resolves.toBe(true)
    expect(direct.em.findOne).toHaveBeenCalledWith(expect.anything(), {
      code: 'private',
      $or: [
        { tenantId: null, organizationId: null },
        { tenantId, organizationId },
      ],
    })

    const assigned = makeService({
      tenantId,
      organizationId,
      partitionCode: 'private',
      entityId: 'attachments:library',
      recordId: 'library-1',
      storageMetadata: {
        assignments: [{ type: 'warranty_claims:warranty_claim', id: 'claim-1' }],
      },
    })
    await expect(assigned.service.canAccessLinkedTarget(input)).resolves.toBe(true)
  })

  it('rejects an unrelated same-scope attachment', async () => {
    const { service } = makeService({
      tenantId,
      organizationId,
      partitionCode: 'private',
      entityId: 'attachments:library',
      recordId: 'library-1',
      storageMetadata: {
        assignments: [{ type: 'warranty_claims:warranty_claim', id: 'other-claim' }],
      },
    })

    await expect(service.canAccessLinkedTarget(input)).resolves.toBe(false)
  })
})
