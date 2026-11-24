import {
  deleteMessageAttachmentRows,
  enqueueMessageAttachmentSectionCleanup,
} from '../attachments'
import { MESSAGE_ATTACHMENT_ENTITY_ID } from '../constants'

const mockPurgeDocumentStructure = jest.fn()
const mockEnqueuePurgedSectionSearchDelete = jest.fn()

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
}))

const { Attachment } = jest.requireMock('@open-mercato/core/modules/attachments/data/entities') as {
  Attachment: new () => unknown
}

jest.mock('@open-mercato/core/modules/attachments/lib/documentStructure/purge', () => ({
  purgeDocumentStructure: (...args: unknown[]) => mockPurgeDocumentStructure(...args),
  enqueuePurgedSectionSearchDelete: (...args: unknown[]) => mockEnqueuePurgedSectionSearchDelete(...args),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const MESSAGE_ID = '33333333-3333-4333-8333-333333333333'

type Row = { id: string; tenant_id: string | null; organization_id: string | null }
type Where = [string, string, unknown]

function createEm(rows: Row[], options: { inTransaction?: boolean } = {}) {
  const wheres: Where[] = []
  const builder = {
    select: jest.fn(() => builder),
    where: jest.fn((column: string, operator: string, value: unknown) => {
      wheres.push([column, operator, value])
      return builder
    }),
    execute: jest.fn(async () => rows),
  }
  const em = {
    wheres,
    getKysely: jest.fn(() => ({ selectFrom: jest.fn(() => builder) })),
    nativeDelete: jest.fn(async () => rows.length),
    isInTransaction: jest.fn(() => options.inTransaction ?? false),
    transactional: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(em)),
  }
  return em
}

describe('deleteMessageAttachmentRows', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPurgeDocumentStructure.mockResolvedValue({ extractionCount: 1, sectionCount: 2, indexedSectionIds: [] })
  })

  it('purges the document structure of every removed attachment before deleting the rows', async () => {
    const em = createEm([
      { id: 'att-1', tenant_id: TENANT_ID, organization_id: ORG_ID },
      { id: 'att-2', tenant_id: TENANT_ID, organization_id: ORG_ID },
    ], { inTransaction: true })
    mockPurgeDocumentStructure
      .mockResolvedValueOnce({ extractionCount: 1, sectionCount: 2, indexedSectionIds: ['sec-1', 'sec-2'] })
      .mockResolvedValueOnce({ extractionCount: 0, sectionCount: 0, indexedSectionIds: [] })

    const result = await deleteMessageAttachmentRows(em as never, {
      messageId: MESSAGE_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      excludeIds: ['att-keep'],
    })

    expect(em.transactional).not.toHaveBeenCalled()
    expect(em.wheres).toEqual(expect.arrayContaining([
      ['entity_id', '=', MESSAGE_ATTACHMENT_ENTITY_ID],
      ['record_id', '=', MESSAGE_ID],
      ['tenant_id', '=', TENANT_ID],
      ['organization_id', '=', ORG_ID],
      ['id', 'not in', ['att-keep']],
    ]))
    expect(mockPurgeDocumentStructure).toHaveBeenCalledTimes(2)
    expect(mockPurgeDocumentStructure).toHaveBeenCalledWith(
      em,
      { attachmentId: 'att-1', tenantId: TENANT_ID, organizationId: ORG_ID },
      { flush: false },
    )
    expect(em.nativeDelete).toHaveBeenCalledWith(Attachment, {
      id: { $in: ['att-1', 'att-2'] },
      entityId: MESSAGE_ATTACHMENT_ENTITY_ID,
      recordId: MESSAGE_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
    expect(mockPurgeDocumentStructure.mock.invocationCallOrder[1])
      .toBeLessThan(em.nativeDelete.mock.invocationCallOrder[0])
    expect(result).toEqual({
      deletedCount: 2,
      purgedSections: [{ scope: { tenantId: TENANT_ID, organizationId: ORG_ID }, sectionIds: ['sec-1', 'sec-2'] }],
    })
    expect(mockEnqueuePurgedSectionSearchDelete).not.toHaveBeenCalled()
  })

  it('opens its own transaction when the caller has none', async () => {
    const em = createEm([{ id: 'att-1', tenant_id: TENANT_ID, organization_id: ORG_ID }])

    await deleteMessageAttachmentRows(em as never, {
      messageId: MESSAGE_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      includeIds: ['att-1'],
    })

    expect(em.transactional).toHaveBeenCalledTimes(1)
    expect(em.wheres).toEqual(expect.arrayContaining([['id', 'in', ['att-1']]]))
    expect(mockPurgeDocumentStructure).toHaveBeenCalledTimes(1)
    expect(em.nativeDelete).toHaveBeenCalledTimes(1)
  })

  it('matches only unscoped-organization rows when the message has no organization', async () => {
    const em = createEm([], { inTransaction: true })

    const result = await deleteMessageAttachmentRows(em as never, {
      messageId: MESSAGE_ID,
      tenantId: TENANT_ID,
      organizationId: null,
    })

    expect(em.wheres).toEqual(expect.arrayContaining([['organization_id', 'is', null]]))
    expect(mockPurgeDocumentStructure).not.toHaveBeenCalled()
    expect(em.nativeDelete).not.toHaveBeenCalled()
    expect(result).toEqual({ deletedCount: 0, purgedSections: [] })
  })

  it('skips the purge for rows that violate the attachment scope invariant but still deletes them', async () => {
    const em = createEm([{ id: 'att-legacy', tenant_id: TENANT_ID, organization_id: null }], { inTransaction: true })

    await deleteMessageAttachmentRows(em as never, {
      messageId: MESSAGE_ID,
      tenantId: TENANT_ID,
      organizationId: null,
    })

    expect(mockPurgeDocumentStructure).not.toHaveBeenCalled()
    expect(em.nativeDelete).toHaveBeenCalledTimes(1)
  })

  it('deletes nothing when an explicit id list is empty', async () => {
    const em = createEm([{ id: 'att-1', tenant_id: TENANT_ID, organization_id: ORG_ID }], { inTransaction: true })

    await deleteMessageAttachmentRows(em as never, {
      messageId: MESSAGE_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      includeIds: [],
    })

    expect(em.getKysely).not.toHaveBeenCalled()
    expect(em.nativeDelete).not.toHaveBeenCalled()
  })
})

describe('enqueueMessageAttachmentSectionCleanup', () => {
  beforeEach(() => jest.clearAllMocks())

  it('queues section search deletes for every purged scope', async () => {
    const scope = { tenantId: TENANT_ID, organizationId: ORG_ID }
    await enqueueMessageAttachmentSectionCleanup({
      deletedCount: 2,
      purgedSections: [
        { scope, sectionIds: ['sec-1'] },
        { scope, sectionIds: ['sec-2', 'sec-3'] },
      ],
    })

    expect(mockEnqueuePurgedSectionSearchDelete).toHaveBeenCalledTimes(2)
    expect(mockEnqueuePurgedSectionSearchDelete).toHaveBeenNthCalledWith(1, scope, ['sec-1'])
    expect(mockEnqueuePurgedSectionSearchDelete).toHaveBeenNthCalledWith(2, scope, ['sec-2', 'sec-3'])
  })

  it('does nothing when no indexed section was purged', async () => {
    await enqueueMessageAttachmentSectionCleanup({ deletedCount: 1, purgedSections: [] })
    expect(mockEnqueuePurgedSectionSearchDelete).not.toHaveBeenCalled()
  })
})
