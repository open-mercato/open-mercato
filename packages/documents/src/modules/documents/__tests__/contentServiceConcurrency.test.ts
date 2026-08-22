import { LockMode } from '@mikro-orm/core'
import { DocumentContent } from '../data/entities'

const mockLoggerError = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => {
    const logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: (...args: unknown[]) => mockLoggerError(...args),
      child: () => logger,
    }
    return logger
  },
}))
import {
  loadDocumentCollaborationGeneration,
  loadDocumentContentForCollaboration,
  persistDocumentContent,
} from '../lib/contentService'

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'
const CONTENT_ID = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444'
const CURRENT_VERSION = new Date('2026-07-10T10:00:01.000Z')
const STALE_VERSION = '2026-07-10T10:00:00.000Z'

function contentRow(): DocumentContent {
  return Object.assign(new DocumentContent(), {
    id: CONTENT_ID,
    documentId: DOCUMENT_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    contentHtml: '<p>Current</p>',
    contentText: 'Current',
    yjsState: Buffer.from([1]),
    collaborationGeneration: 1,
    createdAt: new Date('2026-07-10T09:00:00.000Z'),
    updatedAt: new Date(CURRENT_VERSION.getTime()),
    deletedAt: null,
  })
}

function makeEntityManager(content: DocumentContent, options: { resetVersionOnFlush?: boolean } = {}) {
  const transactionalEm = {
    findOne: jest.fn(async () => content),
    flush: jest.fn(async () => {
      if (options.resetVersionOnFlush) content.updatedAt = new Date(CURRENT_VERSION.getTime())
    }),
    persist: jest.fn(),
    nativeUpdate: jest.fn(async (
      _entity: unknown,
      _where: unknown,
      input: { updatedAt: Date },
    ) => {
      content.updatedAt = new Date(input.updatedAt.getTime())
      return 1
    }),
  }
  const isolatedEm = {
    transactional: jest.fn(async (callback: (fork: typeof transactionalEm) => Promise<unknown>) => (
      callback(transactionalEm)
    )),
  }
  const em = { fork: jest.fn(() => isolatedEm) }
  return { em, isolatedEm, transactionalEm }
}

describe('document content persistence concurrency', () => {
  afterEach(() => {
    jest.useRealTimers()
    mockLoggerError.mockClear()
  })

  it('loads a room from a fresh transaction under a scoped pessimistic read lock', async () => {
    const content = contentRow()
    const { em, isolatedEm, transactionalEm } = makeEntityManager(content)

    await expect(loadDocumentContentForCollaboration(
      em as never,
      DOCUMENT_ID,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
    )).resolves.toBe(content)

    expect(em.fork).toHaveBeenCalledTimes(1)
    expect(isolatedEm.transactional).toHaveBeenCalledTimes(1)
    expect(transactionalEm.findOne).toHaveBeenCalledWith(
      DocumentContent,
      {
        documentId: DOCUMENT_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        deletedAt: null,
      },
      { lockMode: LockMode.PESSIMISTIC_READ },
    )
  })

  it('projects only the durable generation for active-room reconciliation', async () => {
    const content = contentRow()
    const em = { findOne: jest.fn(async () => content) }

    await expect(loadDocumentCollaborationGeneration(
      em as never,
      DOCUMENT_ID,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
    )).resolves.toBe(1)

    expect(em.findOne).toHaveBeenCalledWith(
      DocumentContent,
      {
        documentId: DOCUMENT_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        deletedAt: null,
      },
      { fields: ['collaborationGeneration'] },
    )
  })

  it('rejects a stale sidecar CAS while the row is locked and never mutates content', async () => {
    const content = contentRow()
    const { em, transactionalEm } = makeEntityManager(content)
    const searchIndexer = { indexRecordById: jest.fn(async () => undefined) }

    const promise = persistDocumentContent(
      em as never,
      DOCUMENT_ID,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      { contentHtml: '<p>Stale overwrite</p>', contentText: 'Stale overwrite' },
      {
        searchIndexer,
        expectedUpdatedAt: STALE_VERSION,
        expectedCollaborationGeneration: 1,
        requireExpectedVersion: true,
      },
    )

    await expect(promise).rejects.toMatchObject({
      status: 409,
      body: {
        code: 'optimistic_lock_conflict',
        currentUpdatedAt: CURRENT_VERSION.toISOString(),
        expectedUpdatedAt: STALE_VERSION,
      },
    })
    expect(transactionalEm.findOne).toHaveBeenCalledWith(
      DocumentContent,
      {
        documentId: DOCUMENT_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
      },
      { filters: false, lockMode: LockMode.PESSIMISTIC_WRITE },
    )
    expect(content.contentText).toBe('Current')
    expect(transactionalEm.flush).not.toHaveBeenCalled()
    expect(searchIndexer.indexRecordById).not.toHaveBeenCalled()
  })

  it('rejects a stale collaboration generation even when the timestamp still matches', async () => {
    const content = contentRow()
    content.collaborationGeneration = 2
    const { em, transactionalEm } = makeEntityManager(content)
    const searchIndexer = { indexRecordById: jest.fn(async () => undefined) }

    await expect(persistDocumentContent(
      em as never,
      DOCUMENT_ID,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      { contentHtml: '<p>Stale lineage</p>', contentText: 'Stale lineage' },
      {
        searchIndexer,
        expectedUpdatedAt: CURRENT_VERSION,
        expectedCollaborationGeneration: 1,
        requireExpectedVersion: true,
      },
    )).rejects.toMatchObject({
      status: 409,
      body: {
        code: 'optimistic_lock_conflict',
        currentCollaborationGeneration: 2,
        expectedCollaborationGeneration: 1,
      },
    })
    expect(content.contentText).toBe('Current')
    expect(transactionalEm.flush).not.toHaveBeenCalled()
    expect(searchIndexer.indexRecordById).not.toHaveBeenCalled()
  })

  it('returns a strictly newer version after a successful locked write', async () => {
    jest.useFakeTimers({ now: CURRENT_VERSION })
    const content = contentRow()
    const { em, transactionalEm } = makeEntityManager(content, { resetVersionOnFlush: true })
    const searchIndexer = { indexRecordById: jest.fn(async () => undefined) }

    const result = await persistDocumentContent(
      em as never,
      DOCUMENT_ID,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      { contentHtml: '<p>Next</p>', contentText: 'Next', yjsState: Buffer.from([2]) },
      {
        searchIndexer,
        expectedUpdatedAt: CURRENT_VERSION,
        expectedCollaborationGeneration: 1,
        requireExpectedVersion: true,
      },
    )

    expect(result).toEqual({
      id: CONTENT_ID,
      updatedAt: new Date('2026-07-10T10:00:01.001Z'),
      collaborationGeneration: 1,
    })
    expect(content.contentHtml).toBe('<p>Next</p>')
    expect(content.contentText).toBe('Next')
    expect(transactionalEm.flush).toHaveBeenCalledTimes(1)
    expect(transactionalEm.nativeUpdate).toHaveBeenCalledWith(
      DocumentContent,
      {
        id: CONTENT_ID,
        documentId: DOCUMENT_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
      },
      { updatedAt: new Date('2026-07-10T10:00:01.001Z') },
    )
    expect(searchIndexer.indexRecordById).toHaveBeenCalledWith({
      entityId: 'documents:document',
      recordId: DOCUMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    })
  })

  it('returns the committed version when the post-commit search projection fails', async () => {
    const content = contentRow()
    const { em } = makeEntityManager(content)
    const indexingError = new Error('search unavailable')
    const searchIndexer = { indexRecordById: jest.fn(async () => { throw indexingError }) }
    await expect(persistDocumentContent(
      em as never,
      DOCUMENT_ID,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      { contentHtml: '<p>Committed</p>', contentText: 'Committed', yjsState: Buffer.from([3]) },
      {
        searchIndexer,
        expectedUpdatedAt: CURRENT_VERSION,
        expectedCollaborationGeneration: 1,
        requireExpectedVersion: true,
      },
    )).resolves.toEqual({
      id: CONTENT_ID,
      updatedAt: expect.any(Date),
      collaborationGeneration: 1,
    })

    expect(content.contentHtml).toBe('<p>Committed</p>')
    expect(searchIndexer.indexRecordById).toHaveBeenCalledTimes(1)
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Content search indexing failed after commit',
      expect.objectContaining({
        documentId: DOCUMENT_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        err: indexingError,
      }),
    )
  })

  it('persists content when the optional search package is not installed', async () => {
    const content = contentRow()
    const { em } = makeEntityManager(content)

    await expect(persistDocumentContent(
      em as never,
      DOCUMENT_ID,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      { contentHtml: '<p>Without search</p>', contentText: 'Without search' },
      {
        expectedUpdatedAt: CURRENT_VERSION,
        expectedCollaborationGeneration: 1,
        requireExpectedVersion: true,
      },
    )).resolves.toEqual({
      id: CONTENT_ID,
      updatedAt: expect.any(Date),
      collaborationGeneration: 1,
    })

    expect(content.contentText).toBe('Without search')
    expect(mockLoggerError).not.toHaveBeenCalled()
  })
})
