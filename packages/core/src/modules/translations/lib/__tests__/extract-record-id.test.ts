import { extractRecordId } from '../extract-record-id'

describe('extractRecordId', () => {
  describe('explicit id param', () => {
    it('returns string id directly', () => {
      expect(extractRecordId({ id: 'abc-123-def-456-ghi' })).toBe('abc-123-def-456-ghi')
    })

    it('returns first element when id is an array', () => {
      expect(extractRecordId({ id: ['first-id-value-abcdef', 'second'] })).toBe('first-id-value-abcdef')
    })

    it('returns numeric id as string', () => {
      expect(extractRecordId({ id: '42' })).toBe('42')
    })
  })

  describe('UUID-like detection from other params', () => {
    it('finds UUID in non-id param', () => {
      expect(extractRecordId({ slug: 'short', recordId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }))
        .toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    })

    it('finds UUID-like value with at least 20 hex chars', () => {
      expect(extractRecordId({ key: '0123456789abcdef01234' }))
        .toBe('0123456789abcdef01234')
    })

    it('finds UUID in array param', () => {
      expect(extractRecordId({ parts: ['short', 'a1b2c3d4e5f6789012345678'] }))
        .toBe('a1b2c3d4e5f6789012345678')
    })

    it('returns undefined when no param matches UUID pattern', () => {
      expect(extractRecordId({ slug: 'my-product', page: '3' })).toBeUndefined()
    })

    it('requires at least 20 chars for UUID-like match', () => {
      expect(extractRecordId({ key: 'abcdef1234567890123' })).toBeUndefined() // 19 chars
    })

    it('matches case-insensitively', () => {
      expect(extractRecordId({ key: 'ABCDEF1234567890ABCDEF' }))
        .toBe('ABCDEF1234567890ABCDEF')
    })

    it('allows hyphens in UUID pattern', () => {
      expect(extractRecordId({ key: 'a1b2c3d4-e5f6-7890-abcd' }))
        .toBe('a1b2c3d4-e5f6-7890-abcd')
    })
  })

  describe('priority', () => {
    it('prefers explicit id over UUID-like params', () => {
      expect(extractRecordId({
        id: 'explicit-id',
        other: 'a1b2c3d4e5f6789012345678',
      })).toBe('explicit-id')
    })
  })

  describe('edge cases', () => {
    it('returns undefined for empty params', () => {
      expect(extractRecordId({})).toBeUndefined()
    })

    it('skips empty string values', () => {
      expect(extractRecordId({ key: '' })).toBeUndefined()
    })

    it('rejects strings with non-hex characters', () => {
      expect(extractRecordId({ key: 'this-is-not-a-valid-uuid-at-all' })).toBeUndefined()
    })
  })
})
