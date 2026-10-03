import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  createStoredDocumentRemover,
  resolveStoredDocumentAttachmentService,
  STORED_DOCUMENT_PARTITION,
} from '../stored-documents'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

describe('resolveStoredDocumentAttachmentService', () => {
  it('returns the service when the attachments contract is registered', () => {
    const service = { createScoped: jest.fn(), readScoped: jest.fn() }
    expect(resolveStoredDocumentAttachmentService(<T,>() => service as T)).toBe(service)
  })

  it('returns null when the service is missing or incomplete', () => {
    expect(resolveStoredDocumentAttachmentService(() => { throw new Error('not registered') })).toBeNull()
    expect(resolveStoredDocumentAttachmentService(<T,>() => ({ createScoped: jest.fn() }) as T)).toBeNull()
  })
})

describe('createStoredDocumentRemover', () => {
  it('is unavailable without releaseScoped', () => {
    expect(createStoredDocumentRemover({ createScoped: jest.fn(), readScoped: jest.fn() })).toBeUndefined()
  })

  it('releases each stored file with its exact owner, assignment, partition and scope', async () => {
    const releaseScoped = jest.fn(async () => undefined)
    const remover = createStoredDocumentRemover({ createScoped: jest.fn(), readScoped: jest.fn(), releaseScoped })
    await remover?.({
      ...scope,
      documents: [{ attachmentId: 'attachment-1', historyId: 'history-1', resourceId: 'order-1' }],
    })
    expect(releaseScoped).toHaveBeenCalledWith({
      attachmentId: 'attachment-1',
      ...scope,
      expectedOwner: { entityId: 'document_generators:document', recordId: 'order-1' },
      expectedAssignment: { type: 'document_generators:generated_document', id: 'history-1' },
      expectedPartitionCode: STORED_DOCUMENT_PARTITION,
    })
  })

  it('treats an already removed file as done but propagates other failures', async () => {
    const releaseScoped = jest.fn()
      .mockRejectedValueOnce(new CrudHttpError(404, { error: 'Attachment not found' }))
      .mockRejectedValueOnce(new CrudHttpError(409, { error: 'Attachment is still referenced by another record' }))
    const remover = createStoredDocumentRemover({ createScoped: jest.fn(), readScoped: jest.fn(), releaseScoped })
    const documents = [{ attachmentId: 'attachment-1', historyId: 'history-1', resourceId: 'order-1' }]
    await expect(remover?.({ ...scope, documents })).resolves.toBeUndefined()
    await expect(remover?.({ ...scope, documents })).rejects.toThrow()
  })
})
