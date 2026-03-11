import { buildListResumeCursor, buildProductResumeCursor, parseCursor } from '../lib/cursor'

describe('akeneo cursor helpers', () => {
  it('round-trips list cursors', () => {
    const raw = buildListResumeCursor('https://example.test/next')
    expect(parseCursor(raw)).toEqual({
      kind: 'list',
      nextUrl: 'https://example.test/next',
    })
  })

  it('round-trips product cursors', () => {
    const raw = buildProductResumeCursor({
      updatedAfter: '2026-03-10T12:00:00Z',
      nextUrl: 'https://example.test/products',
      maxUpdatedAt: '2026-03-10T12:15:00Z',
    })
    expect(parseCursor(raw)).toEqual({
      kind: 'products',
      updatedAfter: '2026-03-10T12:00:00Z',
      nextUrl: 'https://example.test/products',
      maxUpdatedAt: '2026-03-10T12:15:00Z',
    })
  })

  it('returns null for invalid cursors', () => {
    expect(parseCursor('nope')).toBeNull()
  })
})
