import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

const findOneResults: Array<{ match: (entity: unknown) => boolean; row: unknown }> = []
const findResults: Array<{ match: (entity: unknown) => boolean; rows: unknown[] }> = []

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (_em: unknown, entity: unknown) => {
    const index = findOneResults.findIndex((candidate) => candidate.match(entity))
    if (index === -1) return null
    return findOneResults.splice(index, 1)[0]!.row
  }),
  findWithDecryption: jest.fn(async (_em: unknown, entity: unknown) => {
    const index = findResults.findIndex((candidate) => candidate.match(entity))
    if (index === -1) return []
    return findResults.splice(index, 1)[0]!.rows
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

const mockAssertCapability = jest.fn(async () => undefined)
const mockResolveFeatures = jest.fn(async () => ['documents.view', 'documents.create', 'documents.edit'])

jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return {
    ...actual,
    assertDocumentCommandCapability: (...args: unknown[]) => mockAssertCapability(...args),
    resolveDocumentsCommandFeatures: (...args: unknown[]) => mockResolveFeatures(...args),
  }
})

const mockLockAggregate = jest.fn(async () => undefined)
const mockAssertNoDependents = jest.fn(async () => undefined)

jest.mock('../commands/aggregate', () => ({
  lockDocumentAggregateRoot: (...args: unknown[]) => mockLockAggregate(...args),
  assertNoPostCreateDocumentDependents: (...args: unknown[]) => mockAssertNoDependents(...args),
}))

jest.mock('../commands/side-effects', () => ({
  bufferDocumentMutationSideEffects: jest.fn(async () => undefined),
  bufferLinkMutationSideEffects: jest.fn(async () => undefined),
}))

jest.mock('../lib/collabMaterializer', () => ({
  materializeDocumentHtml: jest.fn((html: string) => ({
    yjsState: Buffer.from(`yjs:${html}`),
    html,
    text: html.replace(/<[^>]+>/g, ''),
  })),
}))

const mockReleaseAll = jest.fn(async () => [])

jest.mock('../commands/attachments', () => {
  const actual = jest.requireActual('../commands/attachments')
  return {
    ...actual,
    releaseAllDocumentAttachments: (...args: unknown[]) => mockReleaseAll(...args),
    runAttachmentProviderCleanups: jest.fn(async () => undefined),
  }
})

const mockReadScoped = jest.fn()
const mockCreateScoped = jest.fn()

jest.mock('../lib/attachmentServicePort', () => {
  const actual = jest.requireActual('../lib/attachmentServicePort')
  return {
    ...actual,
    resolveAttachmentServicePort: () => ({
      validateUpload: jest.fn(),
      readScoped: (...args: unknown[]) => mockReadScoped(...args),
      createScoped: (...args: unknown[]) => mockCreateScoped(...args),
      releaseScoped: jest.fn(async () => undefined),
    }),
  }
})

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  Document,
  DocumentAttachment,
  DocumentContent,
  DocumentEntityLink,
} from '../data/entities'
import { duplicateDocumentCommand, type DuplicateDocumentCommandInput } from '../commands/duplicate'
import { mutateDocumentContentState } from '../lib/contentService'

jest.mock('../lib/contentService', () => ({
  mutateDocumentContentState: jest.fn(),
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const actorUserId = '33333333-3333-4333-8333-333333333333'
const sourceDocumentId = '44444444-4444-4444-8444-444444444444'
const newDocumentId = '55555555-5555-4555-8555-555555555555'
const newContentId = '66666666-6666-4666-8666-666666666666'
const sourceAttachmentId = '77777777-7777-4777-8777-777777777777'
const copiedAttachmentId = '88888888-8888-4888-8888-888888888888'

type PersistedRows = { documents: Document[]; links: DocumentEntityLink[]; attachments: DocumentAttachment[] }

function makeHarness() {
  const persisted: PersistedRows = { documents: [], links: [], attachments: [] }
  const em = {
    fork: jest.fn(() => em),
    begin: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    transactional: jest.fn(async (callback: (inner: unknown) => Promise<unknown>) => callback(em)),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      if (entity === Document) {
        const row = Object.assign(new Document(), { updatedAt: new Date('2026-07-17T10:00:00.000Z') }, data)
        persisted.documents.push(row)
        return row
      }
      if (entity === DocumentEntityLink) {
        const row = Object.assign(new DocumentEntityLink(), data)
        persisted.links.push(row)
        return row
      }
      if (entity === DocumentAttachment) {
        const row = Object.assign(new DocumentAttachment(), data)
        persisted.attachments.push(row)
        return row
      }
      throw new Error('Unexpected entity in duplicate harness')
    }),
    persist: jest.fn(),
    count: jest.fn(async () => 0),
  } as unknown as EntityManager
  const ctx: CommandRuntimeContext = {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        throw new Error(`Unexpected dependency: ${token}`)
      },
    } as CommandRuntimeContext['container'],
    auth: {
      sub: actorUserId,
      userId: actorUserId,
      tenantId,
      orgId: organizationId,
      features: ['documents.view', 'documents.create', 'documents.edit'],
    } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    request: new Request('http://localhost/api/documents/duplicate'),
  }
  return { em, ctx, persisted }
}

function commandInput(): DuplicateDocumentCommandInput {
  return {
    tenantId,
    organizationId,
    sourceDocumentId,
    newDocumentId,
    newContentId,
    actorUserId,
    localizedCopyTitle: '{title} (copy)',
    verifiedLinks: [],
  }
}

function sourceDocumentRow(): Document {
  return Object.assign(new Document(), {
    id: sourceDocumentId,
    title: 'Quarterly SOP',
    folderId: null,
    tenantId,
    organizationId,
    updatedAt: new Date('2026-07-17T09:00:00.000Z'),
  })
}

function sourceContentRow(): DocumentContent {
  return Object.assign(new DocumentContent(), {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
    documentId: sourceDocumentId,
    tenantId,
    organizationId,
    contentHtml: `<p>terms</p><img src="/api/documents/${sourceDocumentId}/attachments/${sourceAttachmentId}">`,
    contentText: 'terms',
    updatedAt: new Date('2026-07-17T09:00:00.000Z'),
  })
}

function sourceAttachmentRow(): DocumentAttachment {
  return Object.assign(new DocumentAttachment(), {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
    documentId: sourceDocumentId,
    attachmentId: sourceAttachmentId,
    tenantId,
    organizationId,
    updatedAt: new Date('2026-07-17T09:00:00.000Z'),
  })
}

function queueHappyPathReads(copyContent: DocumentContent) {
  findOneResults.push({ match: (entity) => entity === Document, row: sourceDocumentRow() })
  findOneResults.push({ match: (entity) => entity === DocumentContent, row: sourceContentRow() })
  findResults.push({ match: (entity) => entity === DocumentAttachment, rows: [sourceAttachmentRow()] })
  findOneResults.push({ match: (entity) => entity === DocumentContent, row: copyContent })
  findResults.push({ match: (entity) => entity === DocumentEntityLink, rows: [] })
  findResults.push({ match: (entity) => entity === DocumentAttachment, rows: [
    Object.assign(new DocumentAttachment(), {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad',
      documentId: newDocumentId,
      attachmentId: copiedAttachmentId,
      tenantId,
      organizationId,
    }),
  ] })
  findOneResults.push({ match: (entity) => entity === DocumentContent, row: copyContent })
}

describe('M9 duplicate command execution', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    findOneResults.length = 0
    findResults.length = 0
  })

  it('creates the copy hidden, copies attachments, rewrites and re-materializes content, then reveals', async () => {
    const { ctx, persisted } = makeHarness()
    const copyContent = Object.assign(new DocumentContent(), {
      id: newContentId,
      documentId: newDocumentId,
      tenantId,
      organizationId,
      contentHtml: `<p>terms</p><img src="/api/documents/${sourceDocumentId}/attachments/${sourceAttachmentId}">`,
      contentText: 'terms',
      updatedAt: new Date('2026-07-17T10:00:01.000Z'),
    })
    queueHappyPathReads(copyContent)
    mockReadScoped.mockResolvedValue({
      buffer: Buffer.from('image-bytes'),
      contentType: 'image/png',
      contentDisposition: 'inline; filename="diagram.png"',
    })
    mockCreateScoped.mockImplementation(async (input: { persistLink?: (tx: unknown, attachmentId: string) => void }) => {
      input.persistLink?.(makeHarness().em, copiedAttachmentId)
      return { id: copiedAttachmentId }
    })

    const result = await duplicateDocumentCommand.execute(commandInput(), ctx)

    const createdCopy = persisted.documents.find((row) => row.id === newDocumentId)
    expect(createdCopy).toBeTruthy()
    expect(createdCopy?.title).toBe('Quarterly SOP (copy)')
    expect(createdCopy?.ownerUserId).toBe(actorUserId)
    expect(createdCopy?.deletedAt).toBeNull()
    expect(mockCreateScoped).toHaveBeenCalledTimes(1)
    expect(mockCreateScoped.mock.calls[0]?.[0]).toMatchObject({
      recordId: newDocumentId,
      fileName: 'diagram.png',
      declaredMimeType: 'image/png',
    })
    expect(copyContent.contentHtml).toContain(`/api/documents/${newDocumentId}/attachments/${copiedAttachmentId}`)
    expect(copyContent.contentHtml).not.toContain(sourceDocumentId)
    expect(copyContent.yjsState?.toString()).toBe(`yjs:${copyContent.contentHtml}`)
    expect(result.copiedAttachments).toBe(1)
    expect(result.projections?.[0]).toMatchObject({ kind: 'event', eventId: 'documents.document.duplicated' })
    expect(mockReadScoped.mock.calls[0]?.[0]).toMatchObject({
      attachmentId: sourceAttachmentId,
      expectedOwner: { recordId: sourceDocumentId },
    })
    expect(mutateDocumentContentState).toHaveBeenCalledWith(
      expect.anything(),
      newDocumentId,
      { tenantId, organizationId },
      expect.objectContaining({ contentHtml: expect.stringContaining('terms') }),
      expect.objectContaining({ id: newContentId }),
    )
  })

  it('compensates by deleting the hidden copy when an attachment copy fails', async () => {
    const { ctx } = makeHarness()
    findOneResults.push({ match: (entity) => entity === Document, row: sourceDocumentRow() })
    findOneResults.push({ match: (entity) => entity === DocumentContent, row: sourceContentRow() })
    findResults.push({ match: (entity) => entity === DocumentAttachment, rows: [sourceAttachmentRow()] })
    findOneResults.push({ match: (entity) => entity === DocumentContent, row: null })
    findResults.push({ match: (entity) => entity === DocumentEntityLink, rows: [] })
    findOneResults.push({ match: (entity) => entity === DocumentContent, row: null })
    findOneResults.push({ match: (entity) => entity === Document, row: null })
    mockReadScoped.mockRejectedValue(new CrudHttpError(503, { error: 'documents.attachments.partitionUnavailable' }))

    await expect(duplicateDocumentCommand.execute(commandInput(), ctx)).rejects.toMatchObject({ status: 503 })
    expect(mockReleaseAll).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { tenantId, organizationId },
      newDocumentId,
    )
  })

  it('refuses undo with 409 when the copy was touched after duplication', async () => {
    const { ctx } = makeHarness()
    const logEntry = {
      commandPayload: {
        undo: {
          after: {
            documentUpdatedAt: '2026-07-17T10:00:02.000Z',
            documentDeletedAt: null,
            contentUpdatedAt: '2026-07-17T10:00:02.000Z',
            contentDeletedAt: null,
            linkIds: [],
            attachmentIds: [],
          },
        },
        __redoInput: commandInput(),
      },
    }
    findOneResults.push({
      match: (entity) => entity === Document,
      row: Object.assign(new Document(), {
        id: newDocumentId,
        tenantId,
        organizationId,
        updatedAt: new Date('2026-07-17T11:30:00.000Z'),
        deletedAt: null,
      }),
    })
    findOneResults.push({
      match: (entity) => entity === DocumentContent,
      row: Object.assign(new DocumentContent(), {
        id: newContentId,
        documentId: newDocumentId,
        tenantId,
        organizationId,
        updatedAt: new Date('2026-07-17T10:00:02.000Z'),
        deletedAt: null,
      }),
    })

    await expect(
      duplicateDocumentCommand.undo?.({ logEntry, ctx } as never),
    ).rejects.toMatchObject({ status: 409 })
  })
})
