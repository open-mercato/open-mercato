import {
  rewriteDuplicateAttachmentSrcUrl,
  rewriteDuplicateAttachmentUrls,
} from '../lib/duplicateContent'
import {
  DOCUMENTS_DUPLICATE_MAX_ATTACHMENTS,
  DOCUMENTS_DUPLICATE_MAX_LINKS,
  duplicateDocumentCommandSchema,
} from '../commands/duplicate'

const sourceDocumentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const copyDocumentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const oldAttachmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const newAttachmentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const rewriteInput = {
  sourceDocumentId,
  copyDocumentId,
  attachmentIds: new Map([[oldAttachmentId, newAttachmentId]]),
}

describe('M9 duplicate attachment URL rewriting', () => {
  it('rewrites a source attachment src to the copy ids', () => {
    expect(
      rewriteDuplicateAttachmentSrcUrl(
        `/api/documents/${sourceDocumentId}/attachments/${oldAttachmentId}`,
        rewriteInput,
      ),
    ).toBe(`/api/documents/${copyDocumentId}/attachments/${newAttachmentId}`)
  })

  it('leaves foreign, unmapped, and non-attachment URLs untouched', () => {
    const foreignDocument = `/api/documents/${copyDocumentId}/attachments/${oldAttachmentId}`
    const unmapped = `/api/documents/${sourceDocumentId}/attachments/${newAttachmentId}`
    for (const src of [foreignDocument, unmapped, 'https://example.com/image.png', '/backend/documents/x']) {
      expect(rewriteDuplicateAttachmentSrcUrl(src, rewriteInput)).toBe(src)
    }
  })

  it('rewrites every mapped src attribute inside HTML and preserves the rest', () => {
    const html = [
      `<p>before</p><img src="/api/documents/${sourceDocumentId}/attachments/${oldAttachmentId}">`,
      `<img src="https://example.com/logo.png">`,
      `<img src='/api/documents/${sourceDocumentId}/attachments/${oldAttachmentId}?download=1'>`,
    ].join('')
    const rewritten = rewriteDuplicateAttachmentUrls(html, rewriteInput)
    expect(rewritten).toContain(`/api/documents/${copyDocumentId}/attachments/${newAttachmentId}`)
    expect(rewritten).toContain(`/api/documents/${copyDocumentId}/attachments/${newAttachmentId}?download=1`)
    expect(rewritten).toContain('https://example.com/logo.png')
    expect(rewritten).not.toContain(sourceDocumentId)
  })
})

describe('M9 duplicate command input contract', () => {
  const baseInput = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    sourceDocumentId,
    newDocumentId: copyDocumentId,
    newContentId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    actorUserId: '33333333-3333-4333-8333-333333333333',
    localizedCopyTitle: '{title} (copy)',
    verifiedLinks: [],
  }

  it('documents the fanout bounds', () => {
    expect(DOCUMENTS_DUPLICATE_MAX_ATTACHMENTS).toBe(50)
    expect(DOCUMENTS_DUPLICATE_MAX_LINKS).toBe(100)
  })

  it('accepts an optional custom title and rejects over-long titles', () => {
    expect(duplicateDocumentCommandSchema.parse({ ...baseInput, title: 'My copy' }).title).toBe('My copy')
    expect(() =>
      duplicateDocumentCommandSchema.parse({ ...baseInput, title: 'x'.repeat(513) }),
    ).toThrow()
  })

  it('bounds verifiedLinks at the documented link fanout limit', () => {
    const link = {
      entityType: 'document' as const,
      entityId: sourceDocumentId,
      labelSnapshot: 'Linked doc',
      hrefSnapshot: `/backend/documents/${sourceDocumentId}`,
      source: 'related-panel' as const,
    }
    expect(() =>
      duplicateDocumentCommandSchema.parse({
        ...baseInput,
        verifiedLinks: Array.from({ length: DOCUMENTS_DUPLICATE_MAX_LINKS + 1 }, () => link),
      }),
    ).toThrow()
  })
})
