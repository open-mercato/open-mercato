import { linkAttachmentsToMessage, linkLibraryAttachmentsToMessage } from '../attachments'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'

const mockPolicy = jest.fn(async () => ({ ok: true, protected: false }))
const mockCanRead = jest.fn(async () => ({ canRead: true }))

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({ Attachment: class Attachment {}, AttachmentPartition: class AttachmentPartition {} }))
jest.mock('@open-mercato/core/modules/attachments/lib/access-runner', () => ({
  createAttachmentAccessContext: jest.fn(() => ({})),
  evaluateAttachmentAccess: (...args: unknown[]) => mockPolicy(...args),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: { find: (...args: unknown[]) => unknown }, ...args: unknown[]) => em.find(...args.slice(0, 3)),
  findOneWithDecryption: (em: { findOne: (...args: unknown[]) => unknown }, ...args: unknown[]) => em.findOne(...args.slice(0, 3)),
}))
jest.mock('../routeHelpers', () => ({ resolveMessageReadAccess: (...args: unknown[]) => mockCanRead(...args) }))

const auth = { sub: 'actor', tenantId: 'tenant', orgId: 'org' }
const provenance = { __openMercatoUpload: { principalId: 'actor', tenantId: 'tenant', organizationId: 'org' } }

function fixture(entityId = 'attachments:library', principalId = 'actor') {
  const attachment = {
    id: 'file', entityId, recordId: 'source', tenantId: 'tenant', organizationId: 'org',
    fileName: 'secret.txt', mimeType: 'text/plain', partitionCode: 'private',
    storageMetadata: { __openMercatoUpload: { ...provenance.__openMercatoUpload, principalId } },
  }
  const em = {
    find: jest.fn(async () => [attachment]),
    findOne: jest.fn(async (entity: unknown) => entity === AttachmentPartition
      ? { code: 'private', isPublic: false }
      : { id: 'source', senderUserId: 'sender', tenantId: 'tenant', organizationId: 'org' }),
    create: jest.fn((_entity: unknown, values: unknown) => values),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
  }
  const access = {
    auth,
    container: { resolve: () => ({ userHasAllFeatures: async () => false }) },
  }
  return { em, access, attachment }
}

const link = linkAttachmentsToMessage as (...args: unknown[]) => Promise<void>
const linkLibrary = linkLibraryAttachmentsToMessage as (...args: unknown[]) => Promise<void>

beforeEach(() => {
  jest.clearAllMocks()
  mockPolicy.mockResolvedValue({ ok: true, protected: false })
  mockCanRead.mockResolvedValue({ canRead: true })
})

it.each(['sales:sales_order', 'customers:customer_entity', 'sync_excel:upload'])('rejects resolver-less foreign owner %s without modifying it', async (entityId) => {
  const { em, access, attachment } = fixture(entityId)
  await expect(link(em, 'draft', ['file'], 'org', 'tenant', access)).rejects.toMatchObject({ status: 403 })
  expect(attachment.entityId).toBe(entityId)
  expect(attachment.recordId).toBe('source')
  expect(em.flush).not.toHaveBeenCalled()
})

it('rejects another principal staging through explicit ids', async () => {
  const { em, access, attachment } = fixture('attachments:library', 'victim')
  await expect(link(em, 'draft', ['file'], 'org', 'tenant', access)).rejects.toMatchObject({ status: 403 })
  expect(attachment.entityId).toBe('attachments:library')
})

it('rejects another principal staging through a caller-supplied record id', async () => {
  const { em, access, attachment } = fixture('attachments:library', 'victim')
  await expect(linkLibrary(em, 'draft', 'source', 'org', 'tenant', access)).rejects.toMatchObject({ status: 403 })
  expect(attachment.recordId).toBe('source')
})

it('requires re-upload of legacy unowned staging', async () => {
  const { em, access, attachment } = fixture()
  attachment.storageMetadata = {} as typeof attachment.storageMetadata
  await expect(link(em, 'draft', ['file'], 'org', 'tenant', access)).rejects.toMatchObject({ status: 403 })
})

it('preserves new own staging', async () => {
  const { em, access, attachment } = fixture()
  await link(em, 'draft', ['file'], 'org', 'tenant', access)
  expect(attachment.entityId).toBe('messages:message')
  expect(attachment.recordId).toBe('draft')
})

it('copies a readable message source without reparenting the original', async () => {
  const { em, access, attachment } = fixture('messages:message')
  await link(em, 'draft', ['file'], 'org', 'tenant', access)
  expect(attachment.recordId).toBe('source')
  expect(em.create).toHaveBeenCalledWith(Attachment, expect.objectContaining({ entityId: 'messages:message', recordId: 'draft' }))
})

it('denies an unreadable message source', async () => {
  const { em, access } = fixture('messages:message')
  mockCanRead.mockResolvedValue({ canRead: false })
  await expect(link(em, 'draft', ['file'], 'org', 'tenant', access)).rejects.toMatchObject({ status: 403 })
})

it('fails closed without an authenticated access context', async () => {
  const { em } = fixture()
  await expect(link(em, 'draft', ['file'], 'org', 'tenant')).rejects.toMatchObject({ status: 403 })
})

it('does not treat attachments.manage alone as an owner policy for resolver-less sources', async () => {
  const { em, access } = fixture('sales:sales_order')
  access.container.resolve = () => ({ userHasAllFeatures: async () => true })
  await expect(link(em, 'draft', ['file'], 'org', 'tenant', access)).rejects.toMatchObject({ status: 403 })
})

it('requires the owner reassign decision even for the caller own staged file', async () => {
  const { em, access, attachment } = fixture()
  mockPolicy.mockResolvedValue({ ok: false, protected: true })
  await expect(link(em, 'draft', ['file'], 'org', 'tenant', access)).rejects.toMatchObject({ status: 403 })
  expect(attachment.entityId).toBe('attachments:library')
})

it('copies a policy-authorized foreign owner only with attachments.manage and preserves its protection', async () => {
  const { em, access, attachment } = fixture('documents:document')
  mockPolicy.mockResolvedValue({ ok: true, protected: true })
  access.container.resolve = () => ({ userHasAllFeatures: async () => true })
  await link(em, 'draft', ['file'], 'org', 'tenant', access)
  expect(attachment.recordId).toBe('source')
  expect(em.create).toHaveBeenCalledWith(Attachment, expect.objectContaining({ storageMetadata: expect.objectContaining({ assignments: [{ type: 'documents:document', id: 'source' }] }) }))
})

it.each([
  { tenantId: 'foreign', organizationId: 'org' },
  { tenantId: 'tenant', organizationId: 'foreign' },
  { tenantId: 'tenant', organizationId: null },
])('denies out-of-scope rows even when returned by an unsafe repository: %o', async (scope) => {
  const { em, access, attachment } = fixture()
  Object.assign(attachment, scope)
  await expect(link(em, 'draft', ['file'], 'org', 'tenant', access)).rejects.toMatchObject({ status: 403 })
  expect(attachment.recordId).toBe('source')
})
