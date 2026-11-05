import {
  normalizeDocuments,
  readCreatedId,
} from '../backend/documents/documentsListTypes'

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'

describe('documents list response compatibility', () => {
  it('preserves legacy owner and share-count response aliases', () => {
    expect(normalizeDocuments({
      items: [{
        id: DOCUMENT_ID,
        title: 'Legacy response',
        owner_email: 'ada@example.com',
        share_count: 3,
      }],
    }, [], 'Unknown owner')).toEqual([
      expect.objectContaining({
        id: DOCUMENT_ID,
        ownerLabel: 'ada@example.com',
        sharedWithCount: 3,
      }),
    ])
  })

  it('accepts the legacy nested item shape after document creation', () => {
    expect(readCreatedId({ item: { id: DOCUMENT_ID } })).toBe(DOCUMENT_ID)
  })

  it('never renders an owner UUID supplied by a malformed or stale response', () => {
    expect(normalizeDocuments({
      items: [{ id: DOCUMENT_ID, title: 'Safe fallback', ownerLabel: DOCUMENT_ID }],
    }, [], 'Unknown owner')).toEqual([
      expect.objectContaining({ ownerLabel: 'Unknown owner' }),
    ])
  })
})
