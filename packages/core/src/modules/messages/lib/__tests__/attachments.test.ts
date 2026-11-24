import {
  copyAttachmentsForForwardMessages,
  copyAttachmentsForForward,
  getMessageAttachments,
  getMessageEmailAttachments,
  linkLibraryAttachmentsToMessage,
  linkAttachmentsToMessage,
  detachMessageAttachments,
} from '../attachments'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { assertMessageAttachmentSources } from '../attachmentAccess'

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({ Attachment: class Attachment {} }))
jest.mock('../attachmentAccess', () => ({
  ...jest.requireActual('../attachmentAccess'),
  assertMessageAttachmentSources: jest.fn(async () => undefined),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: { find: (...args: unknown[]) => unknown }, ...args: unknown[]) => em.find(...args.slice(0, 3)),
}))

const access = { auth: { sub: 'actor', tenantId: 'tenant', orgId: 'org' }, container: {} } as never
function source(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file', entityId: 'messages:message', recordId: 'source', tenantId: 'tenant', organizationId: 'org',
    fileName: 'secret.txt', fileSize: 8, mimeType: 'text/plain', url: '/file', partitionCode: 'private',
    storageDriver: 'local', storagePath: 'blob', content: 'contents', storageMetadata: {}, ...overrides,
  }
}
function createEm(rows: ReturnType<typeof source>[] = []) {
  return {
    find: jest.fn(async () => rows), create: jest.fn((_entity: unknown, payload: unknown) => payload),
    persist: jest.fn(), flush: jest.fn(async () => undefined),
    begin: jest.fn(async () => undefined), commit: jest.fn(async () => undefined), rollback: jest.fn(async () => undefined),
  }
}
beforeEach(() => jest.clearAllMocks())

it('does not query or open a transaction for an empty explicit attachment list', async () => {
  const em = createEm()
  await linkAttachmentsToMessage(em as never, 'target', [], 'org', 'tenant')
  expect(em.find).not.toHaveBeenCalled()
  expect(em.begin).not.toHaveBeenCalled()
})

it('links authorized staging under an exact scope', async () => {
  const row = source({ entityId: 'attachments:library' })
  const em = createEm([row])
  await linkLibraryAttachmentsToMessage(em as never, 'target', 'source', 'org', 'tenant', access)
  expect(em.find).toHaveBeenCalledWith(Attachment, expect.objectContaining({ organizationId: 'org', tenantId: 'tenant' }), expect.any(Object))
  expect(assertMessageAttachmentSources).toHaveBeenCalled()
  expect(row.recordId).toBe('target')
  expect(row.entityId).toBe('messages:message')
})

it('returns display metadata with an exact organization filter', async () => {
  const em = createEm([source()])
  expect(await getMessageAttachments(em as never, 'source', null, 'tenant')).toEqual([
    { id: 'file', fileName: 'secret.txt', fileSize: 8, mimeType: 'text/plain', url: '/file' },
  ])
  expect(em.find).toHaveBeenCalledWith(Attachment, expect.objectContaining({ organizationId: null }))
})

it('includes attachment identity for authorization at email byte read', async () => {
  const em = createEm([source()])
  expect(await getMessageEmailAttachments(em as never, 'source', 'org', 'tenant')).toEqual([
    expect.objectContaining({ attachmentId: 'file', storagePath: 'blob' }),
  ])
})

it('copies a forward without changing the source and retains existing protected assignments', async () => {
  const row = source({ storageMetadata: { assignments: [{ type: 'documents:document', id: 'document' }] } })
  const em = createEm([row])
  expect(await copyAttachmentsForForward(em as never, 'source', 'target', 'tenant', access)).toBe(1)
  expect(row.recordId).toBe('source')
  expect(em.create).toHaveBeenCalledWith(Attachment, expect.objectContaining({
    recordId: 'target', tenantId: 'tenant', organizationId: 'org', storagePath: 'blob',
    storageMetadata: expect.objectContaining({ assignments: [{ type: 'documents:document', id: 'document' }] }),
  }))
})

it('deduplicates sources in a forwarded thread slice', async () => {
  const row = source()
  const em = createEm([row, { ...row }, source({ id: 'second' })])
  expect(await copyAttachmentsForForwardMessages(em as never, ['source', 'previous'], 'target', 'tenant', access)).toBe(2)
  expect(em.create).toHaveBeenCalledTimes(2)
})

it('detaches a draft reference without deleting its row or provider bytes', async () => {
  const row = source({ recordId: 'draft' })
  const em = createEm([row])
  await detachMessageAttachments(em as never, 'draft', ['file'], 'org', 'tenant', access)
  expect(row.entityId).toBe('attachments:library')
  expect(row.recordId).toBe('messages-detached:draft')
  expect(row.storagePath).toBe('blob')
  expect(em.find).toHaveBeenCalledWith(Attachment, expect.objectContaining({ recordId: 'draft', entityId: 'messages:message', id: { $in: ['file'] } }), expect.any(Object))
})

it.each(['link', 'forward'] as const)('assigns copied %s rows a download URL bound to their new identity', async (operation) => {
  const row = source({ url: '/api/attachments/file/source-file' })
  const em = createEm([row])
  if (operation === 'link') await linkAttachmentsToMessage(em as never, 'target', ['file'], 'org', 'tenant', access)
  else await copyAttachmentsForForward(em as never, 'source', 'target', 'tenant', access)

  const copy = em.create.mock.calls[0][1] as { id: string; url: string }
  expect(copy.id).not.toBe(row.id)
  expect(copy.url).toBe(`/api/attachments/file/${copy.id}`)
  expect(row.url).toBe('/api/attachments/file/source-file')
})
