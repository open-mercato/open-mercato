import type { AwilixContainer } from 'awilix'
import { createAttachmentAccessContext } from '../access-runner'
import { registerAttachmentAccessResolvers } from '../access-registry'
import type { AttachmentAccessDecision, AttachmentAccessInput } from '../access-types'
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

describe('AttachmentTargetAccessService owner policy boundary', () => {
  const resolverId = 'documents.link-test'
  const resolveOwner = jest.fn(async (_input: AttachmentAccessInput): Promise<AttachmentAccessDecision> => (
    { ok: false, status: 404, reason: 'document_not_found' }
  ))
  const linkedInput = { ...input, targets: [{ entityId: 'documents:document', recordId: 'document-1' }] }

  function harness(withContext = true) {
    const base = makeService({
      id: 'attachment-1', tenantId, organizationId, partitionCode: 'private',
      entityId: 'documents:document', recordId: 'document-1', storageMetadata: null,
      fileName: 'file.txt', mimeType: 'text/plain',
    })
    jest.mocked(base.em.findOne).mockResolvedValue({
      code: 'private', isPublic: false,
      accessResolverRequirements: [{ resolverId, targetEntity: 'documents:document' }],
    } as never)
    const container = { resolve: () => ({
      loadAcl: async () => ({ isSuperAdmin: false, organizations: null }),
      getEffectiveFeatures: async () => ['documents.view'],
    }) } as unknown as AwilixContainer
    return new AttachmentTargetAccessService(base.em,
      withContext ? () => createAttachmentAccessContext(container) : null)
  }

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    resolveOwner.mockReset()
    resolveOwner.mockResolvedValue({ ok: false, status: 404, reason: 'document_not_found' })
    registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [{
      id: resolverId, targetPartition: '*', targetEntity: 'documents:document', resolve: resolveOwner,
    }] }])
  })
  afterEach(() => registerAttachmentAccessResolvers([]))

  it('does not treat a matching link as owner authorization', async () => {
    await expect(harness().canAccessLinkedTarget(linkedInput)).resolves.toBe(false)
    expect(resolveOwner).toHaveBeenCalledWith(expect.objectContaining({ action: 'read' }))
  })

  it.each(['missing-context', 'missing-provider'])('rejects a protected matching link with %s', async (failure) => {
    if (failure === 'missing-provider') registerAttachmentAccessResolvers([])
    await expect(harness(failure !== 'missing-context').canAccessLinkedTarget(linkedInput)).resolves.toBe(false)
    expect(resolveOwner).not.toHaveBeenCalled()
  })

  it('requires expected link membership even after owner policy allows', async () => {
    resolveOwner.mockResolvedValue({ ok: true })
    const service = harness()
    await expect(service.canAccessLinkedTarget(linkedInput)).resolves.toBe(true)
    await expect(service.canAccessLinkedTarget({ ...linkedInput,
      targets: [{ entityId: 'documents:document', recordId: 'unrelated-document' }],
    })).resolves.toBe(false)
    expect(resolveOwner).toHaveBeenCalledTimes(2)
  })
})
