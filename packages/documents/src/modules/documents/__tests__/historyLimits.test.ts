import type { EntityManager } from '@mikro-orm/postgresql'
import { DocumentComment, DocumentVersion } from '../data/entities'
import {
  assertDocumentCommentCapacity,
  documentVersionStorageBytes,
  DOCUMENTS_MAX_COMMENTS_PER_DOCUMENT,
  DOCUMENTS_MAX_VERSION_STORAGE_BYTES,
  DOCUMENTS_MAX_VERSIONS_PER_DOCUMENT,
  enforceDocumentVersionRetention,
  planDocumentVersionRetention,
} from '../lib/historyLimits'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const documentId = '33333333-3333-4333-8333-333333333333'
const scope = { tenantId, organizationId, documentId }

function row(index: number, storageBytes = 10) {
  return {
    id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
    storageBytes,
  }
}

describe('document history limits', () => {
  it('counts binary and UTF-8 HTML bytes rather than JavaScript characters', () => {
    expect(documentVersionStorageBytes({
      yjsSnapshot: Buffer.from([1, 2, 3]),
      contentHtml: 'Zażółć',
    })).toBe(3 + Buffer.byteLength('Zażółć', 'utf8'))
  })

  it('prunes the oldest unprotected rows deterministically to enforce count and storage', () => {
    const stored = [row(0, 60), row(1, 50), row(2, 40)]
    expect(planDocumentVersionRetention({
      stored,
      incomingStorageBytes: 30,
      protectedIds: [stored[0]!.id],
      maxCount: 3,
      maxStorageBytes: 130,
    })).toEqual([stored[1]!.id])
  })

  it('allows exactly the snapshot count cap and prunes on the next append', () => {
    const belowCap = Array.from(
      { length: DOCUMENTS_MAX_VERSIONS_PER_DOCUMENT - 1 },
      (_, index) => row(index),
    )
    expect(planDocumentVersionRetention({
      stored: belowCap,
      incomingStorageBytes: 10,
    })).toEqual([])

    const atCap = [...belowCap, row(DOCUMENTS_MAX_VERSIONS_PER_DOCUMENT - 1)]
    expect(planDocumentVersionRetention({
      stored: atCap,
      incomingStorageBytes: 10,
    })).toEqual([atCap[0]!.id])
  })

  it('counts protected restore targets inside both hard caps', () => {
    const protectedTarget = row(0, DOCUMENTS_MAX_VERSION_STORAGE_BYTES - 20)
    const evictable = row(1, 10)
    expect(planDocumentVersionRetention({
      stored: [protectedTarget, evictable],
      incomingStorageBytes: 20,
      protectedIds: [protectedTarget.id],
    })).toEqual([evictable.id])

    expect(() => planDocumentVersionRetention({
      stored: [protectedTarget],
      incomingStorageBytes: 21,
      protectedIds: [protectedTarget.id],
    })).toThrow(expect.objectContaining({
      status: 413,
      body: { error: 'documents.versions.quotaExceeded' },
    }))
  })

  it('fails at the count cap when every stored snapshot is protected', () => {
    const stored = Array.from(
      { length: DOCUMENTS_MAX_VERSIONS_PER_DOCUMENT },
      (_, index) => row(index),
    )
    expect(() => planDocumentVersionRetention({
      stored,
      incomingStorageBytes: 1,
      protectedIds: stored.map((item) => item.id),
    })).toThrow(expect.objectContaining({
      status: 413,
      body: { error: 'documents.versions.quotaExceeded' },
    }))
  })

  it('fails closed when protected versions and the incoming snapshot cannot fit', () => {
    const protectedVersion = row(0, 90)
    expect(() => planDocumentVersionRetention({
      stored: [protectedVersion],
      incomingStorageBytes: 20,
      protectedIds: [protectedVersion.id],
      maxCount: 2,
      maxStorageBytes: 100,
    })).toThrow(expect.objectContaining({
      status: 413,
      body: { error: 'documents.versions.quotaExceeded' },
    }))
  })

  it('reads metadata only and deletes scoped retention victims', async () => {
    const rows = Array.from({ length: DOCUMENTS_MAX_VERSIONS_PER_DOCUMENT }, (_, index) => ({
      id: row(index).id,
      created_at: row(index).createdAt,
      storage_bytes: '10',
    }))
    const builder = {
      select: jest.fn(),
      where: jest.fn(),
      orderBy: jest.fn(),
      execute: jest.fn(async () => rows),
    }
    builder.select.mockReturnValue(builder)
    builder.where.mockReturnValue(builder)
    builder.orderBy.mockReturnValue(builder)
    const db = { selectFrom: jest.fn(() => builder) }
    const em = {
      getKysely: jest.fn(() => db),
      nativeDelete: jest.fn(async () => 1),
    } as unknown as EntityManager

    const pruned = await enforceDocumentVersionRetention(
      em,
      scope,
      { yjsSnapshot: Buffer.from('new'), contentHtml: '<p>New</p>' },
    )

    expect(pruned).toEqual([rows[0]!.id])
    expect(db.selectFrom).toHaveBeenCalledWith('document_versions')
    expect(builder.select).toHaveBeenNthCalledWith(1, ['id', 'created_at'])
    expect(builder.where.mock.calls).toEqual(expect.arrayContaining([
      ['tenant_id', '=', tenantId],
      ['organization_id', '=', organizationId],
      ['document_id', '=', documentId],
    ]))
    expect(em.nativeDelete).toHaveBeenCalledWith(DocumentVersion, {
      id: { $in: [rows[0]!.id] },
      tenantId,
      organizationId,
      documentId,
    })
  })

  it('checks the active comment count in the exact document scope', async () => {
    const em = {
      count: jest.fn(async () => DOCUMENTS_MAX_COMMENTS_PER_DOCUMENT),
    } as unknown as EntityManager

    await expect(assertDocumentCommentCapacity(em, scope)).rejects.toMatchObject({
      status: 413,
      body: { error: 'documents.comments.limitExceeded' },
    })
    expect(em.count).toHaveBeenCalledWith(DocumentComment, {
      tenantId,
      organizationId,
      documentId,
      deletedAt: null,
    })
  })
})
