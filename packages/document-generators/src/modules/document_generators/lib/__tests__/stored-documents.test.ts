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

  it('releases each stored file by the owner assignment the attachments upload adds automatically', async () => {
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
      expectedAssignment: { type: 'document_generators:document', id: 'order-1' },
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

describe('storeGeneratedDocument', () => {
  it('leaves the owner assignment as the only assignment so the file stays releasable', async () => {
    const { storeGeneratedDocument, storedDocumentAssignment } = await import('../stored-documents')
    const persisted: unknown[] = []
    const tx = { persist: (entity: unknown) => { persisted.push(entity); return { flush: async () => undefined } } }
    const createScoped = jest.fn(async (input: {
      entityId: string
      recordId: string
      assignments?: Array<{ type: string; id: string }>
      persistLink?: (tx: unknown, id: string) => Promise<void>
    }) => {
      const ownerAssignment = { type: input.entityId, id: input.recordId }
      const assignments = [...(input.assignments ?? []).filter((entry) => entry.type !== ownerAssignment.type || entry.id !== ownerAssignment.id), ownerAssignment]
      await input.persistLink?.(tx, 'attachment-1')
      return { id: 'attachment-1', assignments }
    })
    const entity = { id: 'history-1', resourceId: 'order-1', tenantId: 'tenant-1', organizationId: 'org-1' }

    await storeGeneratedDocument({
      attachmentService: { createScoped, readScoped: jest.fn() } as never,
      prepared: { entity, plaintextResourceLabel: 'ORD-1' } as never,
      buffer: new Uint8Array([37, 80, 68, 70]),
      fileName: 'invoice-ORD-1.pdf',
      mimeType: 'application/pdf',
    })

    const stored = await createScoped.mock.results[0].value
    expect(stored.assignments).toEqual([storedDocumentAssignment('order-1')])
    expect(persisted).toEqual([expect.objectContaining({ id: 'history-1', attachmentId: 'attachment-1' })])
  })
})
