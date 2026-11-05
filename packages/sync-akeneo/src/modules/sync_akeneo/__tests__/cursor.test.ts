import { buildListResumeCursor, buildProductResumeCursor, parseCursor } from '../lib/cursor'

describe('akeneo cursor helpers', () => {
  it('round-trips list cursors', () => {
    const raw = buildListResumeCursor('https://example.test/next')
    expect(parseCursor(raw)).toEqual({
      kind: 'list',
      updatedAfter: null,
      maxUpdatedAt: null,
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
      updatedAfter: '2026-03-10 12:00:00',
      nextUrl: 'https://example.test/products',
      maxUpdatedAt: '2026-03-10 12:15:00',
    })
  })

  it('sanitizes malformed product cursors', () => {
    const raw = buildProductResumeCursor({
      updatedAfter: '',
      nextUrl: 'https://example.test/products-uuid?search=%7B%22updated%22%3A%5B%7B%22operator%22%3A%22%3E%22%2C%22value%22%3A%22%22%7D%5D%7D',
      maxUpdatedAt: '2026-03-10T12:15:00Z',
    })
    expect(parseCursor(raw)).toEqual({
      kind: 'products',
      updatedAfter: null,
      nextUrl: 'https://example.test/products-uuid',
      maxUpdatedAt: '2026-03-10 12:15:00',
    })
  })

  it('returns null for invalid cursors', () => {
    expect(parseCursor('nope')).toBeNull()
  })
})
