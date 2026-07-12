import { normalizeRelatedRecord } from '../backend/documents/[id]/relatedRecordModel'

const LINK_ID = '11111111-1111-4111-8111-111111111111'
const TARGET_ID = '22222222-2222-4222-8222-222222222222'

describe('related-record client labels', () => {
  it('replaces a UUID-bearing server label with the localized restricted fallback', () => {
    expect(normalizeRelatedRecord({
      id: LINK_ID,
      entityType: 'product',
      label: `Product ${TARGET_ID}`,
      href: `/backend/catalog/products/${TARGET_ID}`,
      canOpen: true,
      source: 'related-panel',
      updatedAt: '2026-07-11T00:00:00.000Z',
    }, 'Restricted record')).toEqual(expect.objectContaining({
      id: LINK_ID,
      label: 'Restricted record',
    }))
  })
})
